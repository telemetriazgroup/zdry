import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import type Redis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { StorageService } from "../storage/storage.service";
import { limaDayRange } from "../odoo/odoo-lot-photos";
import { REDIS } from "../redis/redis.constants";
import { PUBLIC_VISIT_LIMITS, type ClientOrigin, type PublicVisitAction } from "../domain/client-origin";
import {
  canPublicEditVisit,
  normalizePlate,
  parseMotive,
  visitIsLocked,
  visitPhotoStatus,
} from "../domain/gate-visit";
import {
  extForInspectionMime,
  MAX_INSPECTION_PHOTO_BYTES,
  sniffInspectionPhotoMime,
} from "../domain/inspection-media";

function staffManagesVisits(role: string) {
  return role === "admin" || role === "superadmin" || role === "coordinador";
}

type VisitRow = Prisma.GateVisitGetPayload<object>;

@Injectable()
export class GateVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  present(row: VisitRow, staff = false) {
    const photoStatus = visitPhotoStatus(row);
    return {
      id: row.id,
      publicToken: row.publicToken,
      tractorPlate: row.tractorPlate,
      company: row.company,
      ruc: row.ruc,
      driverName: row.driverName,
      visitAt: row.visitAt,
      license: row.license,
      motive: row.motive,
      trailerPlate: row.trailerPlate,
      phone: row.phone,
      equipmentCode: row.equipmentCode,
      containerIso: row.containerIso,
      linkedAt: row.linkedAt,
      linkedByName: row.linkedByName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      locked: visitIsLocked(row.linkedAt),
      hasPhoto: photoStatus !== "none",
      photoStatus,
      photoName: row.unitPhotoName || null,
      photoApprovedBy: row.unitPhotoApprovedBy,
      archived: !!row.archivedAt,
      archivedAt: row.archivedAt,
      archiveReason: row.archiveReason,
      archivedByName: row.archivedByName,
      origin: staff
        ? {
            ip: row.clientIp,
            userAgent: row.userAgent,
            referer: row.referer,
            originHost: row.originHost,
            acceptLanguage: row.acceptLanguage,
            forwardedFor: row.forwardedFor,
          }
        : undefined,
    };
  }

  private visitFields(body: {
    tractorPlate?: string;
    company?: string;
    ruc?: string;
    driverName?: string;
    visitAt?: string;
    license?: string;
    motive?: string;
    trailerPlate?: string;
    phone?: string;
    equipmentCode?: string;
  }) {
    const tractorPlate = normalizePlate(body.tractorPlate || "");
    if (tractorPlate.length < 3) throw new BadRequestException("Indica la placa del tracto.");
    const motive = parseMotive(body.motive) || "descargar";
    return {
      tractorPlate,
      company: String(body.company || "").trim(),
      ruc: String(body.ruc || "").trim(),
      driverName: String(body.driverName || "").trim(),
      visitAt: body.visitAt ? new Date(body.visitAt) : new Date(),
      license: String(body.license || "").trim(),
      motive,
      trailerPlate: normalizePlate(body.trailerPlate || ""),
      phone: String(body.phone || "").trim(),
      equipmentCode: String(body.equipmentCode || "").trim().toUpperCase() || null,
    };
  }

  async byPlate(raw: string, origin?: ClientOrigin) {
    if (origin) await this.guardPublic("lookup", origin, { tractorPlate: normalizePlate(raw) });
    const tractorPlate = normalizePlate(raw);
    if (tractorPlate.length < 3) throw new BadRequestException("Indica la placa del tracto.");
    const row = await this.prisma.gateVisit.findFirst({
      where: { tractorPlate, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) return { found: false, tractorPlate, locked: false, visit: null };
    return { found: true, tractorPlate, locked: visitIsLocked(row.linkedAt), visit: this.present(row) };
  }

  async byToken(token: string) {
    const publicToken = String(token || "").trim();
    if (publicToken.length < 8) throw new BadRequestException("Código de visita inválido.");
    const row = await this.prisma.gateVisit.findUnique({ where: { publicToken } });
    if (!row) throw new NotFoundException("Visita no encontrada.");
    return {
      found: true,
      locked: visitIsLocked(row.linkedAt),
      editable: canPublicEditVisit(row.linkedAt),
      visit: this.present(row),
    };
  }

  async upsertPublic(
    body: {
      tractorPlate?: string;
      company?: string;
      ruc?: string;
      driverName?: string;
      visitAt?: string;
      license?: string;
      motive?: string;
      trailerPlate?: string;
      phone?: string;
      equipmentCode?: string;
    },
    origin?: ClientOrigin,
  ) {
    const data = this.visitFields(body);
    if (origin) await this.guardPublic("submit", origin, { tractorPlate: data.tractorPlate });
    const existing = await this.prisma.gateVisit.findFirst({
      where: { tractorPlate: data.tractorPlate, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    if (existing && !canPublicEditVisit(existing.linkedAt)) {
      throw new ForbiddenException("Esta placa ya está vinculada a un contenedor. Solo el coordinador o el administrador pueden desvincular.");
    }
    const originData = origin
      ? {
          clientIp: existing?.clientIp || origin.ip,
          userAgent: origin.userAgent,
          referer: origin.referer,
          originHost: origin.originHost,
          acceptLanguage: origin.acceptLanguage,
          forwardedFor: origin.forwardedFor,
          originMeta: {
            first: existing?.originMeta || origin,
            last: origin,
          } as Prisma.InputJsonValue,
        }
      : {};
    const row = existing
      ? await this.prisma.gateVisit.update({ where: { id: existing.id }, data: { ...data, ...originData } })
      : await this.prisma.gateVisit.create({ data: { ...data, ...originData } });
    if (origin) {
      await this.logAccess({
        action: "submit",
        tractorPlate: data.tractorPlate,
        visitId: row.id,
        origin,
        blocked: false,
      });
    }
    return { ok: true, visit: this.present(row), saved: true, editable: !visitIsLocked(row.linkedAt) };
  }

  async list(filter: "pending" | "linked" | "all" | "archived" = "pending") {
    const where: Prisma.GateVisitWhereInput =
      filter === "archived"
        ? { archivedAt: { not: null } }
        : filter === "pending"
          ? { linkedAt: null, archivedAt: null }
          : filter === "linked"
            ? { linkedAt: { not: null }, archivedAt: null }
            : { archivedAt: null };
    const rows = await this.prisma.gateVisit.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map((r) => this.present(r, true));
  }

  async arrivals() {
    const { start } = limaDayRange();
    const rows = await this.prisma.gateVisit.findMany({
      where: {
        OR: [{ linkedAt: null }, { linkedAt: { gte: start } }],
        archivedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map((r) => this.present(r));
  }

  async lookup(q: string) {
    const raw = String(q || "").trim();
    if (raw.length < 3) throw new BadRequestException("Escribe al menos 3 caracteres (placa o ISO).");
    const plate = normalizePlate(raw);
    const isoNeedle = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const visitWhere =
      plate.length >= 3
        ? {
            OR: [
              { tractorPlate: { contains: plate, mode: "insensitive" as const } },
              { trailerPlate: { contains: plate, mode: "insensitive" as const } },
              { driverName: { contains: raw, mode: "insensitive" as const } },
              { containerIso: { contains: isoNeedle, mode: "insensitive" as const } },
              { equipmentCode: { contains: isoNeedle, mode: "insensitive" as const } },
            ],
          }
        : {
            OR: [
              { containerIso: { contains: isoNeedle, mode: "insensitive" as const } },
              { equipmentCode: { contains: isoNeedle, mode: "insensitive" as const } },
            ],
          };
    const visits = await this.prisma.gateVisit.findMany({
      where: { AND: [visitWhere, { archivedAt: null }] },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    const live = await this.prisma.liveContainers();
    const units = isoNeedle.length >= 3
      ? await this.prisma.container.findMany({
          where: {
            ...live,
            status: { not: "Vendido" },
            iso: { contains: isoNeedle, mode: "insensitive" },
          },
          include: { depot: { select: { name: true } } },
          take: 20,
        })
      : [];
    const visitByIso = new Map(visits.filter((v) => v.containerIso).map((v) => [v.containerIso as string, v]));
    for (const u of units) {
      if (visitByIso.has(u.iso)) continue;
      const extra = await this.prisma.gateVisit.findFirst({
        where: { containerIso: u.iso },
        orderBy: { linkedAt: "desc" },
      });
      if (extra) visitByIso.set(u.iso, extra);
    }
    return {
      query: raw,
      found: visits.length > 0 || units.length > 0,
      visits: visits.map((v) => this.present(v)),
      units: units.map((u) => {
        const visit = visitByIso.get(u.iso);
        return {
          iso: u.iso,
          depotName: u.depot.name,
          campoEnabledAt: u.campoEnabledAt,
          intakeOrigin: u.intakeOrigin,
          visit: visit
            ? {
                id: visit.id,
                tractorPlate: visit.tractorPlate,
                driverName: visit.driverName,
                motive: visit.motive,
                company: visit.company,
                photoStatus: visitPhotoStatus(visit),
              }
            : null,
        };
      }),
    };
  }

  async createStaff(
    body: {
      tractorPlate?: string;
      company?: string;
      ruc?: string;
      driverName?: string;
      visitAt?: string;
      license?: string;
      motive?: string;
      trailerPlate?: string;
      phone?: string;
      equipmentCode?: string;
      iso?: string;
    },
    user: AuthUser,
    ip?: string,
  ) {
    if (!staffManagesVisits(user.role)) throw new ForbiddenException("Sin acceso.");
    const data = this.visitFields(body);
    const row = await this.prisma.gateVisit.create({ data });
    await this.audit.log({
      user,
      action: "create",
      entity: "GateVisit",
      entityId: row.id,
      after: { tractorPlate: row.tractorPlate },
      ip,
    });
    if (body.iso) return this.link(row.id, body.iso, user, ip);
    return this.present(row);
  }

  async updateStaff(
    id: string,
    body: {
      tractorPlate?: string;
      company?: string;
      ruc?: string;
      driverName?: string;
      visitAt?: string;
      license?: string;
      motive?: string;
      trailerPlate?: string;
      phone?: string;
      equipmentCode?: string;
      iso?: string;
    },
    user: AuthUser,
    ip?: string,
  ) {
    if (!staffManagesVisits(user.role)) throw new ForbiddenException("Sin acceso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Visita no encontrada.");
    const data = this.visitFields({
      tractorPlate: body.tractorPlate ?? visit.tractorPlate,
      company: body.company ?? visit.company,
      ruc: body.ruc ?? visit.ruc,
      driverName: body.driverName ?? visit.driverName,
      visitAt: body.visitAt ?? (visit.visitAt ? visit.visitAt.toISOString() : undefined),
      license: body.license ?? visit.license,
      motive: body.motive ?? visit.motive,
      trailerPlate: body.trailerPlate ?? visit.trailerPlate,
      phone: body.phone ?? visit.phone,
      equipmentCode: body.equipmentCode ?? visit.equipmentCode ?? "",
    });
    const row = await this.prisma.gateVisit.update({ where: { id }, data });
    await this.audit.log({
      user,
      action: "update",
      entity: "GateVisit",
      entityId: id,
      after: { tractorPlate: row.tractorPlate },
      ip,
    });
    if (body.iso) return this.link(id, body.iso, user, ip);
    return this.present(row);
  }

  async remove(id: string, user: AuthUser, ip?: string, reason = "Archivada por el coordinador") {
    return this.archive(id, reason, user, ip);
  }

  async archive(id: string, reason: string, user: AuthUser, ip?: string) {
    if (!staffManagesVisits(user.role)) throw new ForbiddenException("Sin acceso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Visita no encontrada.");
    if (visit.archivedAt) return this.present(visit, true);
    const row = await this.prisma.gateVisit.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        archiveReason: String(reason || "Archivada para auditoría").trim() || "Archivada para auditoría",
        archivedById: user.id,
        archivedByName: user.name,
        containerIso: visit.containerIso,
        linkedAt: visit.linkedAt,
      },
    });
    await this.audit.log({
      user,
      action: "archive",
      entity: "GateVisit",
      entityId: id,
      after: { tractorPlate: visit.tractorPlate, iso: visit.containerIso, reason: row.archiveReason },
      ip,
    });
    return this.present(row, true);
  }

  async restore(id: string, user: AuthUser, ip?: string) {
    if (!staffManagesVisits(user.role)) throw new ForbiddenException("Sin acceso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Visita no encontrada.");
    const row = await this.prisma.gateVisit.update({
      where: { id },
      data: { archivedAt: null, archiveReason: null, archivedById: null, archivedByName: null },
    });
    await this.audit.log({
      user,
      action: "restore",
      entity: "GateVisit",
      entityId: id,
      after: { tractorPlate: visit.tractorPlate },
      ip,
    });
    return this.present(row, true);
  }

  async link(id: string, isoRaw: string, user: AuthUser, ip?: string) {
    if (!staffManagesVisits(user.role)) throw new ForbiddenException("Sin acceso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Visita no encontrada.");
    const iso = String(isoRaw || "").trim().toUpperCase();
    if (!iso) throw new BadRequestException("Indica el ISO a vincular.");
    const unit = await this.prisma.container.findUnique({ where: { iso } });
    if (!unit || unit.archivedAt) throw new BadRequestException("Contenedor no encontrado.");
    await this.prisma.gateVisit.updateMany({
      where: { containerIso: iso, id: { not: id } },
      data: { containerIso: null, linkedAt: null, linkedByName: null },
    });
    const row = await this.prisma.gateVisit.update({
      where: { id },
      data: {
        containerIso: iso,
        equipmentCode: iso,
        linkedAt: new Date(),
        linkedByName: user.name,
      },
    });
    await this.audit.log({
      user,
      action: "link_visit",
      entity: "GateVisit",
      entityId: id,
      after: { iso, tractorPlate: visit.tractorPlate },
      ip,
    });
    return this.present(row);
  }

  async unlink(id: string, user: AuthUser, ip?: string) {
    if (!staffManagesVisits(user.role)) {
      throw new ForbiddenException("Solo el coordinador o el administrador pueden desvincular una visita.");
    }
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Visita no encontrada.");
    const row = await this.prisma.gateVisit.update({
      where: { id },
      data: { containerIso: null, linkedAt: null, linkedByName: null },
    });
    await this.audit.log({
      user,
      action: "unlink_visit",
      entity: "GateVisit",
      entityId: id,
      ip,
    });
    return this.present(row);
  }

  async uploadPublicPhoto(
    plateRaw: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    origin?: ClientOrigin,
  ) {
    const tractorPlate = normalizePlate(plateRaw);
    if (origin) await this.guardPublic("photo", origin, { tractorPlate });
    if (tractorPlate.length < 3) throw new BadRequestException("Indica la placa del tracto.");
    const visit = await this.prisma.gateVisit.findFirst({
      where: { tractorPlate, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    if (!visit) throw new BadRequestException("Primero envía la ficha de visita y luego adjunta la foto.");
    if (!canPublicEditVisit(visit.linkedAt)) {
      throw new ForbiddenException("Esta placa ya está vinculada. El coordinador revisa la foto.");
    }
    const row = await this.storePhoto(visit, file);
    if (origin) {
      await this.logAccess({
        action: "photo",
        tractorPlate,
        visitId: visit.id,
        origin,
        blocked: false,
      });
    }
    return row;
  }

  async uploadStaffPhoto(
    id: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    user: AuthUser,
    ip?: string,
  ) {
    if (!staffManagesVisits(user.role)) throw new ForbiddenException("Sin acceso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Visita no encontrada.");
    const row = await this.storePhoto(visit, file);
    await this.audit.log({
      user,
      action: "upload",
      entity: "GateVisitPhoto",
      entityId: id,
      ip,
    });
    return row;
  }

  async reviewPhoto(id: string, approve: boolean, user: AuthUser, ip?: string) {
    if (!staffManagesVisits(user.role)) throw new ForbiddenException("Sin acceso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Visita no encontrada.");
    if (!visit.unitPhotoKey) throw new BadRequestException("Esta visita no tiene foto de unidad.");
    const row = await this.prisma.gateVisit.update({
      where: { id },
      data: approve
        ? { unitPhotoApprovedAt: new Date(), unitPhotoApprovedBy: user.name, unitPhotoRejectedAt: null }
        : { unitPhotoRejectedAt: new Date(), unitPhotoApprovedAt: null, unitPhotoApprovedBy: null },
    });
    await this.audit.log({
      user,
      action: approve ? "approve_visit_photo" : "reject_visit_photo",
      entity: "GateVisitPhoto",
      entityId: id,
      ip,
    });
    return this.present(row);
  }

  async openPhoto(id: string, user?: AuthUser, publicAccess = false) {
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit?.unitPhotoKey) throw new NotFoundException("Foto no encontrada.");
    const status = visitPhotoStatus(visit);
    const role = user?.role || "";
    const staff = staffManagesVisits(role);
    if (!publicAccess && !staff && status !== "approved") {
      throw new ForbiddenException("La foto de la visita aún no está aprobada.");
    }
    const obj = await this.storage.get(visit.unitPhotoKey);
    return { ...obj, contentType: visit.unitPhotoMime || obj.contentType, name: visit.unitPhotoName || "unidad.jpg" };
  }

  async openPublicPhoto(plateRaw: string) {
    const tractorPlate = normalizePlate(plateRaw);
    const visit = await this.prisma.gateVisit.findFirst({
      where: { tractorPlate, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    if (!visit) throw new NotFoundException("Foto no encontrada.");
    return this.openPhoto(visit.id, undefined, true);
  }

  async openTokenPhoto(token: string) {
    const publicToken = String(token || "").trim();
    const visit = await this.prisma.gateVisit.findUnique({ where: { publicToken } });
    if (!visit) throw new NotFoundException("Foto no encontrada.");
    return this.openPhoto(visit.id, undefined, true);
  }

  private async storePhoto(
    visit: VisitRow,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona una foto de la unidad (opcional, JPG o PNG).");
    if (file.size > MAX_INSPECTION_PHOTO_BYTES) throw new BadRequestException("La foto supera el máximo de 8 MB.");
    let mime: string;
    try {
      mime = sniffInspectionPhotoMime(file.buffer);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const ext = extForInspectionMime(mime);
    const storageKey = `visits/${visit.id}/unit-${randomUUID()}.${ext}`;
    if (visit.unitPhotoKey) await this.storage.delete(visit.unitPhotoKey).catch(() => undefined);
    await this.storage.put(storageKey, file.buffer, mime);
    const row = await this.prisma.gateVisit.update({
      where: { id: visit.id },
      data: {
        unitPhotoKey: storageKey,
        unitPhotoMime: mime,
        unitPhotoName: file.originalname || `unidad.${ext}`,
        unitPhotoApprovedAt: null,
        unitPhotoApprovedBy: null,
        unitPhotoRejectedAt: null,
      },
    });
    return this.present(row);
  }

  async accessLogs() {
    return this.prisma.gateVisitAccessLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 120,
    });
  }

  private async guardPublic(action: PublicVisitAction, origin: ClientOrigin, extra?: { tractorPlate?: string }) {
    const limits = PUBLIC_VISIT_LIMITS[action];
    const ip = origin.ip || "unknown";
    let blocked = false;
    let blockReason = "";
    try {
      const burstKey = `gv:${action}:${ip}:burst`;
      const winKey = `gv:${action}:${ip}:win`;
      const burst = await this.redis.incr(burstKey);
      if (burst === 1) await this.redis.expire(burstKey, limits.burst.ttl);
      const win = await this.redis.incr(winKey);
      if (win === 1) await this.redis.expire(winKey, limits.window.ttl);
      if (burst > limits.burst.max) {
        blocked = true;
        blockReason = "Ráfaga de envíos";
      } else if (win > limits.window.max) {
        blocked = true;
        blockReason = "Demasiados envíos en poco tiempo";
      }
      if (action === "submit" && extra?.tractorPlate && "plates" in limits) {
        const plateKey = `gv:plates:${ip}`;
        await this.redis.sadd(plateKey, extra.tractorPlate);
        await this.redis.expire(plateKey, limits.plates.ttl);
        const plateCount = await this.redis.scard(plateKey);
        if (plateCount > limits.plates.max) {
          blocked = true;
          blockReason = "Demasiadas placas distintas desde la misma conexión";
        }
      }
    } catch {
      const since = new Date(Date.now() - limits.window.ttl * 1000);
      const count = await this.prisma.gateVisitAccessLog.count({
        where: { ip, action, createdAt: { gte: since } },
      });
      if (count >= limits.window.max) {
        blocked = true;
        blockReason = "Demasiados envíos en poco tiempo";
      }
    }
    if (blocked) {
      await this.logAccess({
        action,
        tractorPlate: extra?.tractorPlate,
        origin,
        blocked: true,
        blockReason,
      });
      throw new HttpException("Demasiados envíos desde esta conexión. Espera unos minutos e inténtalo de nuevo.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async logAccess(input: {
    action: string;
    tractorPlate?: string;
    visitId?: string;
    origin: ClientOrigin;
    blocked: boolean;
    blockReason?: string;
  }) {
    await this.prisma.gateVisitAccessLog.create({
      data: {
        action: input.action,
        tractorPlate: input.tractorPlate || null,
        visitId: input.visitId || null,
        ip: input.origin.ip || "unknown",
        userAgent: input.origin.userAgent,
        referer: input.origin.referer,
        originHost: input.origin.originHost,
        acceptLanguage: input.origin.acceptLanguage,
        forwardedFor: input.origin.forwardedFor,
        extra: input.origin.extra,
        blocked: input.blocked,
        blockReason: input.blockReason || null,
      },
    }).catch(() => undefined);
  }
}
