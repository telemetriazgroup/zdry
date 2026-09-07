import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { StorageService } from "../storage/storage.service";
import { YardLockService } from "../redis/yard-lock.service";
import { parseIso6346 } from "../domain/iso6346";
import { ACTIVE_MASTER } from "../domain/masters";
import { MANUFACTURERS } from "../domain/purchase-extras";
import { CONDITION_GRADES, parseCondition } from "../domain/odoo-purchase";
import {
  extForInspectionMime,
  MAX_INSPECTION_PHOTO_BYTES,
  MAX_INSPECTION_VIDEO_BYTES,
  sniffInspectionPhotoMime,
  sniffInspectionVideoMime,
} from "../domain/inspection-media";
import {
  CONTAINER_COLORS,
  DEFAULT_YARD_CONFIG,
  DEPOT_SERVICE_RATES,
  LayoutRules,
  PHOTO_LABELS,
  YardUnit,
  bestSlotFor,
  compactYardGravity,
  containerCommitted,
  defaultCbm,
  inspectDataMissing,
  inspectMissing,
  intakeTypeLabel,
  movesToRetrieve,
  needsYardPlacement,
  normalizeLayoutRules,
  placeSuccessMessage,
  posLabel,
  validateMove,
} from "../domain/yard";
import { PHOTO_STATUS_ACTIVE, PHOTO_STATUS_REJECTED } from "../domain/catalog-media";
import { OdooClient } from "../odoo/odoo.client";
import { limaDayRange, listOdooLotPhotos, openOdooLotPhoto } from "../odoo/odoo-lot-photos";

const CAMPO_ODOO_LOCKED = ["tareKg", "mgwKg", "color", "year", "manufacturer"] as const;

const LAYOUT_RULES_KEY = "layout_rules";
const YARD_CONFIG_KEY = "yard_config";

type ContainerRow = Prisma.ContainerGetPayload<{
  include: { depot: true; photos: true; ownerCustomer: { select: { id: true; companyName: true; rucDni: true } } };
}>;

const ACTIVE_PHOTOS = { where: { status: PHOTO_STATUS_ACTIVE } };

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly locks: YardLockService,
    private readonly odoo: OdooClient,
  ) {}

  async getLayoutRules(): Promise<LayoutRules> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: LAYOUT_RULES_KEY } });
    return normalizeLayoutRules(row?.value);
  }

  async putLayoutRules(input: Partial<LayoutRules>, user: AuthUser, ip?: string) {
    const value = normalizeLayoutRules({ ...(await this.getLayoutRules()), ...input });
    await this.prisma.appSetting.upsert({
      where: { key: LAYOUT_RULES_KEY },
      update: { value },
      create: { key: LAYOUT_RULES_KEY, value },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "AppSetting",
      entityId: LAYOUT_RULES_KEY,
      after: value as object,
      ip,
    });
    return value;
  }

  async meta() {
    const [types, categories, depots, customers, rules] = await Promise.all([
      this.prisma.containerType.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.category.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.depot.findMany({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }),
      this.prisma.customer.findMany({ where: await this.prisma.hideDemo(), orderBy: { companyName: "asc" } }),
      this.getLayoutRules(),
    ]);
    const maxY = new Date().getFullYear();
    const years: number[] = [];
    for (let y = maxY; y >= 1975; y--) years.push(y);
    return {
      types,
      categories,
      depots,
      customers,
      manufacturers: MANUFACTURERS,
      colors: CONTAINER_COLORS,
      photoLabels: PHOTO_LABELS,
      conditionGrades: CONDITION_GRADES,
      yardConfig: DEFAULT_YARD_CONFIG,
      layoutRules: rules,
      years,
      serviceRates: DEPOT_SERVICE_RATES,
      maxPhotoBytes: MAX_INSPECTION_PHOTO_BYTES,
      maxVideoBytes: MAX_INSPECTION_VIDEO_BYTES,
    };
  }

  async validateIso(raw: string) {
    const check = parseIso6346(raw);
    if (!check.valid || !check.code) return { ...check, duplicate: false };
    const existing = await this.prisma.container.findUnique({
      where: { iso: check.code },
      select: { iso: true, status: true },
    });
    return {
      ...check,
      duplicate: !!existing,
      existingStatus: existing?.status || null,
    };
  }

  async pending(user?: AuthUser) {
    const [types, categories, rows] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.container.findMany({
        where: { status: { not: "Vendido" }, ...(await this.prisma.liveContainers()) },
        include: { depot: true, photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { id: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    return rows
      .map((c) => {
        const missing = inspectMissing({
          ...c,
          photoCount: c.intakeOrigin === "odoo" ? c.photos.length : undefined,
        });
        if (!missing.length) return null;
        if (user?.role === "almacen" && c.intakeOrigin === "odoo") return null;
        return {
          iso: c.iso,
          type: c.type,
          typeLabel: typeMap[c.type]?.label || c.type,
          cat: c.cat,
          catLabel: catMap[c.cat]?.label || c.cat,
          catColor: catMap[c.cat]?.color || "#495057",
          depotId: c.depotId,
          depotName: c.depot.name,
          intakeType: c.intakeType,
          intakeLabel: intakeTypeLabel(c.intakeType),
          intakeOrigin: c.intakeOrigin,
          isoException: c.isoException,
          odooLocation: c.odooLocation,
          status: c.status,
          registeredByName: c.registeredByName || "—",
          createdAt: c.createdAt,
          missing,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  async getUnit(iso: string, opts: { hideOdoo?: boolean } = {}) {
    const c = await this.loadUnit(iso);
    const [types, categories, rules] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.getLayoutRules(),
    ]);
    const occupants = (await this.prisma.container.findMany({ where: { depotId: c.depotId, lado: { not: null } } })).map(
      toYardUnit,
    );
    const suggested = bestSlotFor(occupants, c.depotId, c.type, c.cat, DEFAULT_YARD_CONFIG, rules);
    return this.presentUnit(c, types, categories, suggested, opts.hideOdoo);
  }

  async intake(
    input: {
      category?: string;
      iso?: string;
      type?: string;
      cat?: string;
      depotId?: string;
      customerId?: string;
      discount?: number;
    },
    user: AuthUser,
    ip?: string,
  ) {
    const category = input.category === "almacenaje_cliente" ? "almacenaje_cliente" : "pendiente_factura";
    const isoRaw = (input.iso || "").trim().toUpperCase();
    if (!isoRaw) throw new BadRequestException("Ingresa el código ISO.");
    const check = parseIso6346(isoRaw);
    if (!check.valid) throw new BadRequestException(`Código inválido: ${check.reason}`);
    const existing = await this.prisma.container.findUnique({ where: { iso: check.code } });
    if (existing) throw new ConflictException("Ya existe un contenedor con ese código.");
    if (!check.checkOk) {
      throw new UnprocessableEntityException(
        `"${check.code}" no pasa el dígito de control ISO 6346 (esperado ${check.expectedCheckDigit}). Verifica el código antes de continuar.`,
      );
    }
    if (category === "almacenaje_cliente" && !input.customerId) {
      throw new BadRequestException("Selecciona el cliente dueño de la unidad.");
    }
    const depot = await this.prisma.depot.findUnique({ where: { id: input.depotId || "" } });
    if (!depot || depot.archivedAt) throw new BadRequestException("Depósito de ingreso inválido.");
    const typeRow = await this.prisma.containerType.findUnique({ where: { code: input.type || "" } });
    const catRow = await this.prisma.category.findUnique({ where: { code: input.cat || "" } });
    if (!typeRow || typeRow.archivedAt) throw new BadRequestException("Tipo inválido.");
    if (!catRow || catRow.archivedAt) throw new BadRequestException("Condición inválida.");
    if (category === "almacenaje_cliente") {
      const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw new BadRequestException("Cliente inválido.");
    }
    const discount = Math.max(0, Math.min(100, Number(input.discount) || 0));
    const iso = check.code!;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.container.create({
          data: {
            iso,
            type: typeRow.code,
            cat: catRow.code,
            status: category === "almacenaje_cliente" ? "En custodia" : "Pendiente de ingreso",
            year: null,
            manufacturer: "—",
            depotId: depot.id,
            intakeType: category,
            invoicePending: category === "pendiente_factura",
            physicallyReceived: false,
            fobCif: 0,
            ownerCustomerId: category === "almacenaje_cliente" ? input.customerId : null,
            storageDiscountPct: category === "almacenaje_cliente" ? discount : 0,
            cbm: defaultCbm(typeRow.code),
            registeredById: user.id,
            registeredByName: user.name,
          },
        });
        await tx.containerHistory.create({
          data: {
            iso,
            type: "Ingreso",
            detail: `Unidad registrada en Recepción por ${user.name} — intake: ${category === "almacenaje_cliente" ? "almacenaje de cliente" : "pendiente de factura"}. Continúa de inmediato con la inspección física.`,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Ya existe un contenedor con ese código.");
      }
      throw e;
    }
    await this.audit.log({
      user,
      action: "create",
      entity: "Container",
      entityId: iso,
      after: { iso, intakeType: category, depotId: depot.id },
      ip,
    });
    return this.getUnit(iso, { hideOdoo: user.role === "almacen" });
  }

  async patchUnit(
    iso: string,
    body: {
      tareKg?: number;
      mgwKg?: number;
      color?: string;
      cat?: string;
      year?: number | null;
      manufacturer?: string;
      inspectionNotes?: string;
      conditionFloor?: string | null;
      conditionRoof?: string | null;
      conditionDoors?: string | null;
      conditionPaint?: string | null;
    },
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.loadUnit(iso);
    if (user.role === "almacen" && c.intakeOrigin === "odoo") {
      const locked = CAMPO_ODOO_LOCKED.filter((k) => body[k] !== undefined);
      if (locked.length) {
        throw new ForbiddenException("El operario de patio no modifica datos de Odoo. Solo fotos y notas de campo.");
      }
    }
    const data: Prisma.ContainerUpdateInput = {};
    if (body.tareKg !== undefined || body.mgwKg !== undefined) {
      const tareKg = body.tareKg !== undefined ? Math.max(0, Math.round(Number(body.tareKg) || 0)) : c.tareKg;
      const mgwKg = body.mgwKg !== undefined ? Math.max(0, Math.round(Number(body.mgwKg) || 0)) : c.mgwKg;
      data.tareKg = tareKg;
      data.mgwKg = mgwKg;
      data.payloadKg = Math.max(0, mgwKg - tareKg);
    }
    if (body.color !== undefined) data.color = body.color || "—";
    if (body.cat !== undefined) {
      const catRow = await this.prisma.category.findUnique({ where: { code: body.cat } });
      if (!catRow) throw new BadRequestException("Condición inválida.");
      data.cat = body.cat;
    }
    if (body.year !== undefined) data.year = body.year ? Number(body.year) : null;
    if (body.manufacturer !== undefined) data.manufacturer = body.manufacturer || "—";
    if (body.inspectionNotes !== undefined) data.inspectionNotes = String(body.inspectionNotes || "");
    for (const key of ["conditionFloor", "conditionRoof", "conditionDoors", "conditionPaint"] as const) {
      if (body[key] !== undefined) data[key] = parseCondition(body[key]) || null;
    }
    await this.prisma.container.update({ where: { iso: c.iso }, data });
    await this.audit.log({
      user,
      action: "update",
      entity: "Container",
      entityId: c.iso,
      after: data as object,
      ip,
    });
    return this.getUnit(c.iso, { hideOdoo: user.role === "almacen" });
  }

  async acceptIsoReview(iso: string, note: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    if (!c.isoException) return this.getUnit(iso, { hideOdoo: user.role === "almacen" });
    const reason = [c.isoExceptionReason, note.trim() || `Revisado por ${user.name}`].filter(Boolean).join(" · ");
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { isoException: false, isoExceptionReason: reason },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "ISO 6346",
        detail: `Excepción ISO marcada como revisada por ${user.name}. ${note.trim() || "Serial Odoo aceptado para operación."}`,
      },
    });
    await this.audit.log({
      user,
      action: "iso_review",
      entity: "Container",
      entityId: c.iso,
      after: { isoException: false },
      ip,
    });
    return this.getUnit(c.iso, { hideOdoo: user.role === "almacen" });
  }

  async uploadMedia(
    iso: string,
    slotRaw: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.loadUnit(iso);
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona un archivo.");
    const isVideo = slotRaw === "video" || slotRaw === "9";
    if (isVideo) {
      if (file.size > MAX_INSPECTION_VIDEO_BYTES) {
        throw new BadRequestException("El video supera el máximo de 40 MB.");
      }
      let mime: string;
      try {
        mime = sniffInspectionVideoMime(file.buffer);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const ext = extForInspectionMime(mime);
      const storageKey = `warehouse/${c.iso}/video360.${ext}`;
      await this.storage.put(storageKey, file.buffer, mime);
      await this.prisma.container.update({
        where: { iso: c.iso },
        data: {
          video360Key: storageKey,
          video360Mime: mime,
        },
      });
      await this.audit.log({
        user,
        action: "upload",
        entity: "InspectionVideo",
        entityId: c.iso,
        after: { storageKey, mime },
        ip,
      });
      return this.getUnit(c.iso, { hideOdoo: user.role === "almacen" });
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    await this.storeInspectionPhoto(c, slot, file.buffer, file.originalname, file.size, user, ip, "Reemplazada por una foto nueva");
    return this.getUnit(c.iso, { hideOdoo: user.role === "almacen" });
  }

  async listOdooPhotos(iso: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) return [];
    return listOdooLotPhotos(this.odoo, c.odooLotId);
  }

  async openOdooPhoto(iso: string, attId: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) throw new NotFoundException("Esta unidad no tiene lote Odoo.");
    return openOdooLotPhoto(this.odoo, c.odooLotId, attId);
  }

  async assignOdooPhoto(iso: string, attId: string, slotRaw: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    if (c.intakeOrigin !== "odoo" || !c.odooLotId) {
      throw new BadRequestException("Solo las unidades asimiladas de Odoo tienen fotos de chatter.");
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    const obj = await openOdooLotPhoto(this.odoo, c.odooLotId, attId);
    await this.storeInspectionPhoto(
      c,
      slot,
      obj.buffer,
      obj.name,
      obj.buffer.length,
      user,
      ip,
      "Reemplazada por foto de Odoo",
    );
    return this.getUnit(c.iso);
  }

  async campoQueue(q = "") {
    const live = await this.prisma.liveContainers();
    const needle = q.trim().toUpperCase();
    const [types, categories, rows] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.container.findMany({
        where: {
          ...live,
          status: { not: "Vendido" },
          physicallyReceived: true,
          ...(needle ? { iso: { contains: needle, mode: "insensitive" } } : {}),
        },
        include: {
          depot: { select: { name: true } },
          photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { slot: true } },
        },
        orderBy: [{ fieldRegularizedAt: "asc" }, { updatedAt: "desc" }],
      }),
    ]);
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    return rows.map((c) => ({
      iso: c.iso,
      type: c.type,
      typeLabel: typeMap[c.type]?.label || c.type,
      cat: c.cat,
      catLabel: catMap[c.cat]?.label || c.cat,
      depotName: c.depot.name,
      intakeOrigin: c.intakeOrigin,
      isoException: c.isoException,
      photoCount: c.photos.length,
      hasVideo: !!c.video360Key,
      mediaStatus: c.mediaStatus,
      fieldRegularizedAt: c.fieldRegularizedAt,
      fieldRegularizedByName: c.fieldRegularizedByName,
      mediaApprovedAt: c.mediaApprovedAt,
    }));
  }

  async regularize(iso: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { fieldRegularizedAt: new Date(), fieldRegularizedByName: user.name },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Campo",
        detail: `Regularización de campo enviada a evaluación por ${user.name}.`,
      },
    });
    await this.audit.log({
      user,
      action: "field_regularize",
      entity: "Container",
      entityId: c.iso,
      ip,
    });
    return this.getUnit(c.iso, { hideOdoo: user.role === "almacen" });
  }

  async dailyActivity(ymd?: string) {
    const { date, start, end } = limaDayRange(ymd);
    const live = await this.prisma.liveContainers();
    const [regularized, published] = await Promise.all([
      this.prisma.container.findMany({
        where: { ...live, fieldRegularizedAt: { gte: start, lte: end } },
        select: {
          iso: true,
          fieldRegularizedAt: true,
          fieldRegularizedByName: true,
          mediaStatus: true,
          depot: { select: { name: true } },
        },
        orderBy: { fieldRegularizedAt: "desc" },
      }),
      this.prisma.container.findMany({
        where: { ...live, mediaStatus: "aprobado", mediaApprovedAt: { gte: start, lte: end } },
        select: {
          iso: true,
          mediaApprovedAt: true,
          mediaApprovedBy: true,
          depot: { select: { name: true } },
        },
        orderBy: { mediaApprovedAt: "desc" },
      }),
    ]);
    return {
      date,
      regularized: regularized.map((c) => ({
        iso: c.iso,
        at: c.fieldRegularizedAt,
        by: c.fieldRegularizedByName,
        depotName: c.depot.name,
        mediaStatus: c.mediaStatus,
      })),
      published: published.map((c) => ({
        iso: c.iso,
        at: c.mediaApprovedAt,
        depotName: c.depot.name,
      })),
    };
  }

  async archivePhoto(
    photo: { id: string; iso: string; storageKey: string; mimeType: string },
    user: AuthUser,
    note: string,
  ) {
    const ext = photo.storageKey.split(".").pop() || "bin";
    const histKey = `warehouse/${photo.iso}/history/${photo.id}.${ext}`;
    let key = photo.storageKey;
    if (photo.storageKey !== histKey) {
      try {
        const buf = await this.storage.getBuffer(photo.storageKey);
        await this.storage.put(histKey, buf.buffer, photo.mimeType || buf.contentType || "application/octet-stream");
        key = histKey;
      } catch {
        key = photo.storageKey;
      }
    }
    await this.prisma.inspectionPhoto.update({
      where: { id: photo.id },
      data: {
        status: PHOTO_STATUS_REJECTED,
        rejectedAt: new Date(),
        rejectedById: user.id,
        rejectedByName: user.name,
        rejectNote: note,
        storageKey: key,
      },
    });
  }

  async openPhoto(iso: string, slotRaw: string) {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: { photos: ACTIVE_PHOTOS },
    });
    if (!c) throw new NotFoundException("Contenedor no encontrado.");
    if (slotRaw === "video" || slotRaw === "9") {
      if (!c.video360Key) throw new NotFoundException("Sin video 360.");
      const obj = await this.storage.get(c.video360Key);
      return { ...obj, contentType: c.video360Mime || obj.contentType };
    }
    const slot = Number(slotRaw);
    const photo = c.photos.find((p) => p.slot === slot);
    if (!photo) throw new NotFoundException("Sin foto en ese slot.");
    const obj = await this.storage.get(photo.storageKey);
    return { ...obj, contentType: photo.mimeType || obj.contentType };
  }

  async openStoredPhoto(storageKey: string, mimeType?: string) {
    const obj = await this.storage.get(storageKey);
    return { ...obj, contentType: mimeType || obj.contentType };
  }

  async archive(iso: string, reason: string, user: AuthUser, ip?: string) {
    const why = (reason || "").trim();
    if (why.length < 4) throw new BadRequestException("Indica el motivo del archivo (mínimo 4 caracteres).");
    const c = await this.loadUnit(iso);
    if (c.archivedAt) throw new BadRequestException("Esta unidad ya está archivada.");
    if (c.status === "Vendido") throw new BadRequestException("No se puede archivar una unidad vendida.");
    const updated = await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        archivedAt: new Date(),
        archiveReason: why,
        archivedById: user.id,
        archivedByName: user.name,
        lado: null,
        ruma: null,
        columna: null,
        nivel: null,
        mediaStatus: c.mediaStatus === "aprobado" ? "oculto" : c.mediaStatus,
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Archivo",
        detail: `Unidad archivada por ${user.name}: ${why}`,
      },
    });
    await this.audit.log({
      user,
      action: "archive",
      entity: "Container",
      entityId: c.iso,
      after: { reason: why },
      ip,
    });
    return {
      iso: updated.iso,
      archivedAt: updated.archivedAt,
      archiveReason: updated.archiveReason,
      archivedByName: updated.archivedByName,
    };
  }

  async confirm(iso: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    const missing = c.intakeOrigin === "odoo" ? [] : inspectDataMissing(c);
    if (missing.length) {
      throw new UnprocessableEntityException("Completa año y fabricante antes de continuar.");
    }
    const nextStatus = c.status === "Pendiente de ingreso" ? "Disponible" : c.status;
    const updated = await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        physicallyReceived: true,
        status: nextStatus,
        mediaStatus: c.mediaStatus === "aprobado" ? c.mediaStatus : "pendiente",
      },
      include: { depot: true },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Recepción física",
        detail: `Recepción e inspección confirmadas en un solo paso en Almacén — ${updated.depot.name}. Año: ${c.year}, fabricante: ${c.manufacturer}, color: ${c.color}.`,
      },
    });
    await this.audit.log({
      user,
      action: "confirm",
      entity: "Container",
      entityId: c.iso,
      after: { physicallyReceived: true, status: nextStatus },
      ip,
    });
    return {
      ok: true,
      iso: c.iso,
      depotId: c.depotId,
      message: `✓ ${c.iso} confirmado — ahora está en la lista de "sin posición asignada" del Layout.`,
    };
  }

  async toggleGate(iso: string, field: string, user: AuthUser, ip?: string) {
    if (field !== "gateIn" && field !== "gateOut") {
      throw new BadRequestException("Campo de gate inválido.");
    }
    const c = await this.loadUnit(iso);
    const next = !c[field];
    await this.prisma.container.update({ where: { iso: c.iso }, data: { [field]: next } });
    const label = field === "gateIn" ? "Gate-In" : "Gate-Out";
    if (next) {
      await this.prisma.containerHistory.create({
        data: {
          iso: c.iso,
          type: label,
          detail: `${label} registrado en patio (el cargo de servicio se aplica en Sprint 8).`,
        },
      });
    }
    await this.audit.log({
      user,
      action: "update",
      entity: "Container",
      entityId: c.iso,
      after: { [field]: next },
      ip,
    });
    return this.getUnit(c.iso, { hideOdoo: user.role === "almacen" });
  }

  async registerService(iso: string, key: string, user: AuthUser, ip?: string) {
    if (key !== "reparacion" && key !== "lavado") {
      throw new BadRequestException("Servicio inválido.");
    }
    const c = await this.loadUnit(iso);
    const label = key === "reparacion" ? "Reparación" : "Lavado";
    const rate = DEPOT_SERVICE_RATES[key];
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: label,
        detail: `${label} registrado ($${rate}) — el cargo se aplica en Sprint 8.`,
      },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "Container",
      entityId: c.iso,
      after: { service: key },
      ip,
    });
    return this.getUnit(c.iso, { hideOdoo: user.role === "almacen" });
  }

  async yardLayout(depotId: string) {
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
    if (!depot) throw new NotFoundException("Depósito no encontrado.");
    const [types, categories, depots, rules, rows] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.depot.findMany({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }),
      this.getLayoutRules(),
      this.prisma.container.findMany({ where: { depotId, ...(await this.prisma.liveContainers()) } }),
    ]);
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    const occupants = rows.filter((c) => c.lado).map(toYardUnit);
    const units = rows.map((c) => {
      const yu = toYardUnit(c);
      return {
        iso: c.iso,
        type: c.type,
        typeLabel: typeMap[c.type]?.label || c.type,
        typeColor: typeMap[c.type]?.color || "#1971c2",
        cat: c.cat,
        catLabel: catMap[c.cat]?.label || c.cat,
        catColor: catMap[c.cat]?.color || "#495057",
        status: c.status,
        intakeType: c.intakeType,
        intakeLabel:
          c.intakeType === "compra"
            ? "Compra"
            : c.intakeType === "almacenaje_cliente"
              ? "Almacenaje cliente"
              : "Pendiente factura",
        manufacturer: c.manufacturer,
        color: c.color,
        lado: c.lado,
        ruma: c.ruma,
        columna: c.columna,
        nivel: c.nivel,
        physicallyReceived: c.physicallyReceived,
        committed: containerCommitted(c),
        needsPlacement: needsYardPlacement(c),
        posLabel: posLabel(c),
        movesToRetrieve: movesToRetrieve(occupants, yu),
        demo: c.demo,
      };
    });
    return {
      depotId,
      depotName: depot.name,
      depots,
      types,
      categories,
      config: DEFAULT_YARD_CONFIG,
      rules,
      units,
      occupants: units.filter((u) => u.lado),
      unassigned: units.filter((u) => u.needsPlacement),
    };
  }

  async suggest(depotId: string, iso: string) {
    const c = await this.loadUnit(iso);
    const rules = await this.getLayoutRules();
    const occupants = (await this.prisma.container.findMany({ where: { depotId, lado: { not: null } } })).map(
      toYardUnit,
    );
    return {
      iso: c.iso,
      slot: bestSlotFor(occupants, depotId, c.type, c.cat, DEFAULT_YARD_CONFIG, rules),
    };
  }

  async place(
    input: { iso?: string; depotId?: string; lado?: string; ruma?: number; columna?: number; nivel?: number },
    user: AuthUser,
    ip?: string,
  ) {
    const iso = (input.iso || "").trim().toUpperCase();
    const depotId = input.depotId || "";
    const lado = input.lado || "";
    const ruma = Number(input.ruma);
    const columna = Number(input.columna);
    const nivel = Number(input.nivel);
    if (!iso || !depotId || !lado || !ruma || !columna || !nivel) {
      throw new BadRequestException("iso, depotId, lado, ruma, columna y nivel son obligatorios.");
    }
    if (!DEFAULT_YARD_CONFIG.lados.includes(lado as (typeof DEFAULT_YARD_CONFIG.lados)[number])) {
      throw new BadRequestException("Lado inválido.");
    }
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
    if (!depot) throw new BadRequestException("Depósito inválido.");
    const rules = await this.getLayoutRules();

    return this.locks.withYardLock(depotId, async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT iso FROM "Container" WHERE "depotId" = ${depotId} FOR UPDATE`;
          const unit = await tx.container.findUnique({ where: { iso } });
          if (!unit) throw new NotFoundException("Contenedor no encontrado.");
          const occupants = (
            await tx.container.findMany({
              where: { depotId, lado: { not: null } },
            })
          ).map(toYardUnit);
          const result = validateMove(
            occupants,
            toYardUnit(unit),
            depotId,
            lado,
            ruma,
            columna,
            nivel,
            DEFAULT_YARD_CONFIG,
            rules,
          );
          if (!result.ok) throw new ConflictException(result.message);
          const fromLabel = unit.lado ? posLabel(unit) : null;
          if (unit.lado) {
            await tx.containerPosition.updateMany({
              where: { iso: unit.iso, closedAt: null },
              data: { closedAt: new Date() },
            });
          }
          await tx.container.update({
            where: { iso: unit.iso },
            data: {
              depotId,
              lado,
              ruma,
              columna,
              nivel,
              physicallyReceived: true,
              ...(unit.status === "Pendiente de ingreso" ? { status: "Disponible" } : {}),
            },
          });
          await tx.containerPosition.create({
            data: { iso: unit.iso, depotId, lado, ruma, columna, nivel },
          });
          await tx.containerHistory.create({
            data: {
              iso: unit.iso,
              type: "Movimiento",
              detail:
                (fromLabel ? `Movida de ${fromLabel} a ` : "Posición asignada: ") +
                `Lado ${lado} · Ruma ${ruma} · Columna ${columna} · Nivel ${nivel}.`,
            },
          });
          return {
            ok: true,
            message: placeSuccessMessage(unit.iso, lado, ruma, columna, nivel),
          };
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ConflictException("Esa posición ya está ocupada.");
        }
        throw e;
      }
    }).then(async (out) => {
      await this.audit.log({
        user,
        action: "place",
        entity: "Container",
        entityId: iso,
        after: { depotId, lado, ruma, columna, nivel },
        ip,
      });
      return out;
    });
  }

  async compact(depotId: string, user: AuthUser, ip?: string) {
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId } });
    if (!depot) throw new NotFoundException("Depósito no encontrado.");
    return this.locks.withYardLock(depotId, async () => {
      return this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT iso FROM "Container" WHERE "depotId" = ${depotId} FOR UPDATE`;
        const rows = await tx.container.findMany({ where: { depotId, lado: { not: null } } });
        const occupants = rows.map(toYardUnit);
        const changes = compactYardGravity(occupants, DEFAULT_YARD_CONFIG);
        for (const ch of changes) {
          await tx.container.update({
            where: { iso: ch.iso },
            data: { nivel: ch.toNivel },
          });
          await tx.containerPosition.updateMany({
            where: { iso: ch.iso, closedAt: null },
            data: { closedAt: new Date() },
          });
          await tx.containerPosition.create({
            data: {
              iso: ch.iso,
              depotId: ch.depotId,
              lado: ch.lado,
              ruma: ch.ruma,
              columna: ch.columna,
              nivel: ch.toNivel,
            },
          });
          await tx.containerHistory.create({
            data: {
              iso: ch.iso,
              type: "Compactación",
              detail: `Compactación por gravedad: Nivel ${ch.fromNivel} → Nivel ${ch.toNivel} en Lado ${ch.lado} · Ruma ${ch.ruma} · Columna ${ch.columna}.`,
            },
          });
        }
        await this.audit.log({
          user,
          action: "compact",
          entity: "Depot",
          entityId: depotId,
          after: { moved: changes.length },
          ip,
        });
        return { ok: true, moved: changes.length, changes };
      });
    });
  }

  private async storeInspectionPhoto(
    c: ContainerRow,
    slot: number,
    buffer: Buffer,
    originalNameRaw: string,
    sizeBytes: number,
    user: AuthUser,
    ip: string | undefined,
    replaceNote: string,
  ) {
    if (sizeBytes > MAX_INSPECTION_PHOTO_BYTES) {
      throw new BadRequestException("La foto supera el máximo de 8 MB.");
    }
    let mime: string;
    try {
      mime = sniffInspectionPhotoMime(buffer);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const ext = extForInspectionMime(mime);
    const photoId = randomUUID();
    const storageKey = `warehouse/${c.iso}/photos/${photoId}.${ext}`;
    await this.storage.put(storageKey, buffer, mime);
    const originalName = String(originalNameRaw || `foto-${slot + 1}.${ext}`)
      .replace(/[/\\]/g, "_")
      .slice(0, 180);
    const previous = await this.prisma.inspectionPhoto.findFirst({
      where: { iso: c.iso, slot, status: PHOTO_STATUS_ACTIVE },
    });
    if (previous) {
      await this.archivePhoto(previous, user, replaceNote);
    }
    await this.prisma.inspectionPhoto.create({
      data: {
        id: photoId,
        iso: c.iso,
        slot,
        storageKey,
        mimeType: mime,
        originalName,
        sizeBytes,
        status: PHOTO_STATUS_ACTIVE,
      },
    });
    await this.audit.log({
      user,
      action: "upload",
      entity: "InspectionPhoto",
      entityId: c.iso,
      after: { slot, storageKey, fromOdoo: replaceNote.includes("Odoo") },
      ip,
    });
  }

  private async loadUnit(iso: string): Promise<ContainerRow> {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: {
        depot: true,
        photos: ACTIVE_PHOTOS,
        ownerCustomer: { select: { id: true, companyName: true, rucDni: true } },
      },
    });
    if (!c) throw new NotFoundException("Contenedor no encontrado.");
    if (c.archivedAt) throw new BadRequestException("Esta unidad está archivada.");
    return c;
  }

  private presentUnit(
    c: ContainerRow,
    types: { code: string; label: string; color: string }[],
    categories: { code: string; label: string; color: string }[],
    suggested: ReturnType<typeof bestSlotFor>,
    hideOdoo = false,
  ) {
    const typeRow = types.find((t) => t.code === c.type);
    const catRow = categories.find((x) => x.code === c.cat);
    const photoSlots = Array.from({ length: 9 }, (_, i) => !!c.photos.find((p) => p.slot === i && p.status !== PHOTO_STATUS_REJECTED));
    return {
      iso: c.iso,
      type: c.type,
      typeLabel: typeRow?.label || c.type,
      cat: c.cat,
      catLabel: catRow?.label || c.cat,
      catColor: catRow?.color || "#495057",
      status: c.status,
      year: c.year,
      manufacturer: c.manufacturer,
      depotId: c.depotId,
      depotName: c.depot.name,
      lado: c.lado,
      ruma: c.ruma,
      columna: c.columna,
      nivel: c.nivel,
      posLabel: posLabel(c),
      tareKg: c.tareKg,
      mgwKg: c.mgwKg,
      payloadKg: c.payloadKg,
      color: c.color,
      inspectionNotes: c.inspectionNotes,
      conditionFloor: c.conditionFloor,
      conditionRoof: c.conditionRoof,
      conditionDoors: c.conditionDoors,
      conditionPaint: c.conditionPaint,
      gateIn: c.gateIn,
      gateOut: c.gateOut,
      intakeType: c.intakeType,
      intakeLabel: intakeTypeLabel(c.intakeType),
      physicallyReceived: c.physicallyReceived,
      registeredByName: c.registeredByName || "—",
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
      ownerCustomer: c.ownerCustomer,
      storageDiscountPct: Number(c.storageDiscountPct),
      photos: photoSlots,
      hasVideo: !!c.video360Key,
      mediaStatus: c.mediaStatus,
      mediaReviewNote: c.mediaReviewNote,
      mediaApprovedAt: c.mediaApprovedAt,
      intakeOrigin: c.intakeOrigin,
      isoException: c.isoException,
      isoExceptionReason: c.isoExceptionReason,
      odooLotId: hideOdoo ? null : c.odooLotId,
      odooLocation: hideOdoo ? null : c.odooLocation,
      odooDua: hideOdoo ? null : c.odooDua,
      originCountry: hideOdoo ? null : c.originCountry,
      odooSource: hideOdoo ? null : c.odooSource,
      fieldRegularizedAt: c.fieldRegularizedAt,
      fieldRegularizedByName: c.fieldRegularizedByName,
      missing: inspectMissing({
        ...c,
        photoCount: c.intakeOrigin === "odoo" ? c.photos.filter((p) => p.status !== PHOTO_STATUS_REJECTED).length : undefined,
      }),
      dataMissing: inspectDataMissing(c),
      suggested,
    };
  }
}

function toYardUnit(c: {
  iso: string;
  type: string;
  cat: string;
  manufacturer: string;
  depotId: string;
  lado: string | null;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
  status: string;
  physicallyReceived: boolean;
}): YardUnit {
  return {
    iso: c.iso,
    type: c.type,
    cat: c.cat,
    manufacturer: c.manufacturer,
    depotId: c.depotId,
    lado: c.lado,
    ruma: c.ruma,
    columna: c.columna,
    nivel: c.nivel,
    status: c.status,
    physicallyReceived: c.physicallyReceived,
  };
}
