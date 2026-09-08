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
import { inspectIntakeIso } from "../domain/intake-iso";
import { ACTIVE_MASTER } from "../domain/masters";
import { MANUFACTURERS } from "../domain/purchase-extras";
import { CONDITION_GRADES, parseCondition } from "../domain/odoo-purchase";
import { parseBuildYear, YEAR_MIN } from "../domain/year";
import {
  DEFAULT_DOCUMENT_CONCEPTS,
  mergeCatalogOptions,
  normalizeDocumentConcept,
  normalizeOptionLabel,
} from "../domain/catalog-options";
import { canApplyGateIn, GATE_IN_KEY, presentDepotCost } from "../domain/depot-costs";
import { visitPhotoStatus } from "../domain/gate-visit";
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

const CAMPO_ODOO_LOCKED = [
  "tareKg",
  "mgwKg",
  "color",
  "year",
  "manufacturer",
  "odooDua",
  "originCountry",
  "material",
] as const;

const LAYOUT_RULES_KEY = "layout_rules";
const YARD_CONFIG_KEY = "yard_config";
const COLORS_KEY = "container_colors";
const MANUFACTURERS_KEY = "container_manufacturers";
const DOCUMENTS_KEY = "document_concepts";

export const DOCUMENT_CONCEPTS = [
  { id: "eir", label: "Recibo de intercambio de equipo (EIR)" },
  { id: "constancia_conductor", label: "Constancia de conductor" },
  { id: "otro", label: "Otro" },
] as const;

export function hideOdooFor(role: string) {
  return role === "almacen";
}

export function hideOdooIdsFor(role: string) {
  return role === "almacen" || role === "coordinador";
}

export function hideRatesFor(role: string) {
  return role === "almacen" || role === "coordinador";
}

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

  async meta(user?: AuthUser) {
    const [types, categories, depots, customers, rules, colorRow, mfrRow, docRow, concepts] = await Promise.all([
      this.prisma.containerType.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.category.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.depot.findMany({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }),
      this.prisma.customer.findMany({ where: await this.prisma.hideDemo(), orderBy: { companyName: "asc" } }),
      this.getLayoutRules(),
      this.prisma.appSetting.findUnique({ where: { key: COLORS_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: MANUFACTURERS_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: DOCUMENTS_KEY } }),
      this.prisma.depotCostConcept.findMany({ where: { active: true }, orderBy: [{ system: "desc" }, { label: "asc" }] }),
    ]);
    const maxY = new Date().getFullYear();
    const years: number[] = [];
    for (let y = maxY; y >= YEAR_MIN; y--) years.push(y);
    const hideRates = user ? hideRatesFor(user.role) : false;
    return {
      types,
      categories,
      depots,
      customers,
      manufacturers: mergeCatalogOptions(MANUFACTURERS, mfrRow?.value),
      colors: mergeCatalogOptions(CONTAINER_COLORS, colorRow?.value),
      yearMin: YEAR_MIN,
      yearMax: maxY,
      photoLabels: PHOTO_LABELS,
      conditionGrades: CONDITION_GRADES,
      yardConfig: DEFAULT_YARD_CONFIG,
      layoutRules: rules,
      years,
      serviceRates: hideRates ? null : DEPOT_SERVICE_RATES,
      costConcepts: concepts.map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        amount: hideRates ? null : Number(c.amount),
      })),
      documentConcepts: mergeCatalogOptions(DEFAULT_DOCUMENT_CONCEPTS, docRow?.value).map((label) => ({
        id: label,
        label,
      })),
      documentConceptLabels: mergeCatalogOptions(DEFAULT_DOCUMENT_CONCEPTS, docRow?.value),
      maxPhotoBytes: MAX_INSPECTION_PHOTO_BYTES,
      maxVideoBytes: MAX_INSPECTION_VIDEO_BYTES,
    };
  }

  async validateIso(raw: string) {
    const inspected = inspectIntakeIso(raw);
    if (!inspected.ok) {
      return { valid: false, checkOk: false, duplicate: false, reason: inspected.message, isoException: true };
    }
    const existing = await this.prisma.container.findUnique({
      where: { iso: inspected.isoNormalized },
      select: { iso: true, status: true },
    });
    return {
      ...inspected.check,
      code: inspected.isoNormalized,
      duplicate: !!existing,
      existingStatus: existing?.status || null,
      isoException: inspected.isoException,
      isoExceptionReason: inspected.isoExceptionReason,
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
        const waitingCampo = !c.campoEnabledAt;
        if (!missing.length && !waitingCampo) return null;
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
          odooLocation: user?.role === "admin" ? c.odooLocation : null,
          status: c.status,
          registeredByName: c.registeredByName || "—",
          createdAt: c.createdAt,
          campoEnabledAt: c.campoEnabledAt,
          waitingCampo,
          missing: waitingCampo && !missing.length ? ["Pendiente de enviar a campo"] : missing,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  async getUnit(iso: string, opts: { hideOdoo?: boolean; hideOdooIds?: boolean; hideRates?: boolean } = {}) {
    const c = await this.loadUnit(iso);
    const [types, categories, rules, extras] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.getLayoutRules(),
      this.loadUnitExtras(c.iso, !!opts.hideRates),
    ]);
    const occupants = (await this.prisma.container.findMany({ where: { depotId: c.depotId, lado: { not: null } } })).map(
      toYardUnit,
    );
    const suggested = bestSlotFor(occupants, c.depotId, c.type, c.cat, DEFAULT_YARD_CONFIG, rules);
    return { ...this.presentUnit(c, types, categories, suggested, opts.hideOdoo, opts.hideOdooIds), ...extras };
  }

  private presentFor(iso: string, user: AuthUser) {
    return this.getUnit(iso, {
      hideOdoo: hideOdooFor(user.role),
      hideOdooIds: hideOdooIdsFor(user.role),
      hideRates: hideRatesFor(user.role),
    });
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
      enableCampo?: boolean;
    },
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") {
      throw new ForbiddenException("El personal de campo no registra ingresos. El coordinador habilita las unidades.");
    }
    const category = input.category === "almacenaje_cliente" ? "almacenaje_cliente" : "pendiente_factura";
    const inspected = inspectIntakeIso(input.iso || "");
    if (!inspected.ok) throw new BadRequestException(inspected.message);
    const iso = inspected.isoNormalized;
    const existing = await this.prisma.container.findUnique({ where: { iso } });
    if (existing) throw new ConflictException("Ya existe un contenedor con ese código.");
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
            isoException: inspected.isoException,
            isoExceptionReason: inspected.isoExceptionReason,
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
            detail: `Unidad registrada en Recepción por ${user.name} — intake: ${category === "almacenaje_cliente" ? "almacenaje de cliente" : "pendiente de factura"}${inspected.isoException ? " · ISO 6346 en excepción (no bloqueó el alta)." : ""}.`,
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
      after: { iso, intakeType: category, depotId: depot.id, isoException: inspected.isoException },
      ip,
    });
    if (input.enableCampo) {
      return this.enableCampo(iso, user, ip);
    }
    return this.presentFor(iso, user);
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
      odooDua?: string;
      originCountry?: string;
      material?: string;
      conditionFloor?: string | null;
      conditionRoof?: string | null;
      conditionDoors?: string | null;
      conditionPaint?: string | null;
      conditionWalls?: string | null;
      roofHole?: boolean | null;
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
    if (body.year !== undefined) {
      const parsed = parseBuildYear(body.year);
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      data.year = parsed.year;
    }
    if (body.manufacturer !== undefined) data.manufacturer = body.manufacturer || "—";
    if (body.inspectionNotes !== undefined) data.inspectionNotes = String(body.inspectionNotes || "");
    if (body.odooDua !== undefined) data.odooDua = String(body.odooDua || "").trim() || null;
    if (body.originCountry !== undefined) data.originCountry = String(body.originCountry || "").trim() || null;
    if (body.material !== undefined) data.material = String(body.material || "").trim() || null;
    for (const key of ["conditionFloor", "conditionRoof", "conditionDoors", "conditionPaint", "conditionWalls"] as const) {
      if (body[key] !== undefined) data[key] = parseCondition(body[key]) || null;
    }
    if (body.roofHole !== undefined) data.roofHole = body.roofHole == null || body.roofHole === ("" as never) ? null : !!body.roofHole;
    await this.prisma.container.update({ where: { iso: c.iso }, data });
    await this.audit.log({
      user,
      action: "update",
      entity: "Container",
      entityId: c.iso,
      after: data as object,
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async acceptIsoReview(iso: string, note: string, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    if (!c.isoException) return this.presentFor(iso, user);
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
    return this.presentFor(c.iso, user);
  }

  async uploadMedia(
    iso: string,
    slotRaw: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.loadUnit(iso);
    if (user.role === "almacen") {
      throw new ForbiddenException("El personal de campo sube tomas a la bandeja, no a las casillas del catálogo.");
    }
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
      return this.presentFor(c.iso, user);
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    await this.storeInspectionPhoto(c, slot, file.buffer, file.originalname, file.size, user, ip, "Reemplazada por una foto nueva");
    return this.presentFor(c.iso, user);
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
          campoEnabledAt: { not: null },
          ...(needle ? { iso: { contains: needle, mode: "insensitive" } } : {}),
        },
        include: {
          depot: { select: { name: true } },
          photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { slot: true } },
          _count: { select: { fieldCaptures: true } },
        },
        orderBy: [{ fieldRegularizedAt: "asc" }, { updatedAt: "desc" }],
      }),
    ]);
    const visits = rows.length
      ? await this.prisma.gateVisit.findMany({
          where: { containerIso: { in: rows.map((r) => r.iso) } },
          orderBy: { linkedAt: "desc" },
        })
      : [];
    const visitByIso = new Map<string, (typeof visits)[number]>();
    for (const v of visits) {
      if (v.containerIso && !visitByIso.has(v.containerIso)) visitByIso.set(v.containerIso, v);
    }
    const typeMap = Object.fromEntries(types.map((t) => [t.code, t]));
    const catMap = Object.fromEntries(categories.map((c) => [c.code, c]));
    return rows.map((c) => {
      const visit = visitByIso.get(c.iso);
      return {
        iso: c.iso,
        type: c.type,
        typeLabel: typeMap[c.type]?.label || c.type,
        cat: c.cat,
        catLabel: catMap[c.cat]?.label || c.cat,
        depotName: c.depot.name,
        intakeOrigin: c.intakeOrigin,
        isoException: c.isoException,
        campoEnabledAt: c.campoEnabledAt,
        captureCount: c._count.fieldCaptures,
        photoCount: c.photos.length,
        hasVideo: !!c.video360Key,
        mediaStatus: c.mediaStatus,
        fieldRegularizedAt: c.fieldRegularizedAt,
        fieldRegularizedByName: c.fieldRegularizedByName,
        mediaApprovedAt: c.mediaApprovedAt,
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
    });
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
    return this.presentFor(c.iso, user);
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
    return this.presentFor(c.iso, user);
  }

  async registerService(iso: string, key: string, user: AuthUser, ip?: string) {
    return this.registerActivity(iso, { conceptKey: key, note: "" }, user, ip);
  }

  async enableCampo(iso: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("Solo el coordinador o el administrador envían unidades a campo.");
    }
    return this.applyCampoEnable(iso, user, ip);
  }

  private async applyCampoEnable(iso: string, user: AuthUser, ip?: string, emergency = false) {
    const c = await this.loadUnit(iso);
    if (c.campoEnabledAt) return this.presentFor(c.iso, user);
    const nextStatus = c.status === "Pendiente de ingreso" ? "Disponible" : c.status;
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        campoEnabledAt: new Date(),
        campoEnabledByName: user.name,
        physicallyReceived: true,
        physicalStatus: "en_patio",
        status: nextStatus,
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: emergency ? "Emergencia" : "Campo",
        detail: emergency
          ? `Registro de emergencia en campo por ${user.name}.`
          : `Habilitada para personal de campo por ${user.name}. Año y fotos no son requisito.`,
      },
    });
    await this.audit.log({
      user,
      action: emergency ? "emergency_campo" : "enable_campo",
      entity: "Container",
      entityId: c.iso,
      after: { campoEnabledAt: true, emergency },
      ip,
    });
    await this.applyGateInOnce(c.iso, user);
    return this.presentFor(c.iso, user);
  }

  async addCatalogOption(kind: "color" | "manufacturer" | "document", raw: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("Sin acceso.");
    const label = kind === "document" ? normalizeDocumentConcept(raw) : normalizeOptionLabel(raw);
    if (label.length < 2) throw new BadRequestException("El valor es demasiado corto.");
    const key = kind === "color" ? COLORS_KEY : kind === "manufacturer" ? MANUFACTURERS_KEY : DOCUMENTS_KEY;
    const defaults = kind === "color" ? CONTAINER_COLORS : kind === "manufacturer" ? MANUFACTURERS : DEFAULT_DOCUMENT_CONCEPTS;
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const merged = mergeCatalogOptions(defaults, row?.value);
    const next = mergeCatalogOptions(merged, [label]);
    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value: next.filter((x) => !defaults.includes(x)) },
      create: { key, value: next.filter((x) => !defaults.includes(x)) },
    });
    await this.audit.log({
      user,
      action: "create",
      entity: kind === "color" ? "ContainerColor" : kind === "manufacturer" ? "Manufacturer" : "DocumentConcept",
      entityId: label,
      after: { label },
      ip,
    });
    return this.meta(user);
  }

  async uploadCapture(
    iso: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    note: string,
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.loadUnit(iso);
    if (!c.campoEnabledAt && user.role === "almacen") {
      throw new BadRequestException("Esta unidad aún no está habilitada para campo.");
    }
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona un archivo.");
    let kind: "photo" | "video" = "photo";
    let mime: string;
    try {
      mime = sniffInspectionPhotoMime(file.buffer);
    } catch {
      try {
        mime = sniffInspectionVideoMime(file.buffer);
        kind = "video";
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
    if (kind === "photo" && file.size > MAX_INSPECTION_PHOTO_BYTES) {
      throw new BadRequestException("La foto supera el máximo de 8 MB.");
    }
    if (kind === "video" && file.size > MAX_INSPECTION_VIDEO_BYTES) {
      throw new BadRequestException("El video supera el máximo de 40 MB.");
    }
    const ext = extForInspectionMime(mime);
    const id = randomUUID();
    const storageKey = `warehouse/${c.iso}/captures/${id}.${ext}`;
    await this.storage.put(storageKey, file.buffer, mime);
    const row = await this.prisma.fieldCapture.create({
      data: {
        iso: c.iso,
        kind,
        storageKey,
        mimeType: mime,
        originalName: file.originalname || `${kind}.${ext}`,
        sizeBytes: file.size,
        note: String(note || "").trim(),
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.audit.log({
      user,
      action: "upload",
      entity: "FieldCapture",
      entityId: row.id,
      after: { iso: c.iso, kind },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async openCapture(iso: string, id: string) {
    const row = await this.prisma.fieldCapture.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Toma no encontrada.");
    const obj = await this.storage.get(row.storageKey);
    return { ...obj, contentType: row.mimeType || obj.contentType, name: row.originalName };
  }

  async assignCapture(iso: string, id: string, slotRaw: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("El personal de campo no asigna casillas de catálogo.");
    }
    const c = await this.loadUnit(iso);
    const cap = await this.prisma.fieldCapture.findFirst({ where: { id, iso: c.iso } });
    if (!cap) throw new NotFoundException("Toma no encontrada.");
    const buf = await this.storage.getBuffer(cap.storageKey);
    const isVideo = slotRaw === "video" || slotRaw === "9" || cap.kind === "video";
    let portrait = false;
    if (isVideo) {
      await this.uploadMedia(c.iso, "video", { buffer: buf.buffer, originalname: cap.originalName, size: buf.buffer.length }, user, ip);
      await this.prisma.fieldCapture.update({ where: { id: cap.id }, data: { assignedSlot: 9 } });
    } else {
      const slot = Number(slotRaw);
      if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
        throw new BadRequestException("Slot de foto inválido (0–8).");
      }
      try {
        const Jimp = (await import("jimp")).default;
        const img = await Jimp.read(buf.buffer);
        portrait = img.getHeight() > img.getWidth();
      } catch {
        portrait = false;
      }
      await this.storeInspectionPhoto(c, slot, buf.buffer, cap.originalName, buf.buffer.length, user, ip, "Asignada desde toma de campo");
      await this.prisma.fieldCapture.update({ where: { id: cap.id }, data: { assignedSlot: slot } });
    }
    await this.audit.log({
      user,
      action: "assign_capture",
      entity: "FieldCapture",
      entityId: cap.id,
      after: { iso: c.iso, slot: slotRaw },
      ip,
    });
    const unit = await this.presentFor(c.iso, user);
    return { ...unit, assignWarning: portrait ? "Esta toma es vertical: al publicar quedará con bandas a los lados." : null };
  }

  async registerActivity(
    iso: string,
    input: { conceptKey?: string; conceptId?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no registra costos.");
    const c = await this.loadUnit(iso);
    const concept = input.conceptId
      ? await this.prisma.depotCostConcept.findUnique({ where: { id: input.conceptId } })
      : await this.prisma.depotCostConcept.findUnique({ where: { key: input.conceptKey || "" } });
    if (!concept || !concept.active) throw new BadRequestException("Concepto de patio inválido.");
    if (concept.key === GATE_IN_KEY) {
      const existing = await this.prisma.depotCostEntry.findMany({
        where: { iso: c.iso, conceptKey: GATE_IN_KEY },
        select: { conceptKey: true },
      });
      if (!canApplyGateIn(existing.map((e) => e.conceptKey))) {
        throw new BadRequestException("Gate-In ya está aplicado en esta unidad.");
      }
    }
    const hide = hideRatesFor(user.role);
    const entry = await this.prisma.depotCostEntry.create({
      data: {
        iso: c.iso,
        conceptId: concept.id,
        conceptKey: concept.key,
        conceptLabel: concept.label,
        amount: concept.amount,
        note: String(input.note || "").trim(),
        auto: false,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: concept.label,
        detail: hide
          ? `${concept.label} registrado por ${user.name}${entry.note ? ` — ${entry.note}` : ""}.`
          : `${concept.label} registrado ($${Number(concept.amount)})${entry.note ? ` — ${entry.note}` : ""}.`,
      },
    });
    await this.audit.log({
      user,
      action: "depot_cost",
      entity: "DepotCostEntry",
      entityId: entry.id,
      after: { iso: c.iso, conceptKey: concept.key },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async uploadDocument(
    iso: string,
    file: { buffer: Buffer; originalname: string; size: number; mimetype?: string } | undefined,
    concept: string,
    note: string,
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no adjunta documentos de unidad.");
    const c = await this.loadUnit(iso);
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona un archivo.");
    const conceptLabel = normalizeDocumentConcept(concept);
    if (conceptLabel.length < 2) throw new BadRequestException("Indica el concepto del documento.");
    await this.rememberDocumentConcept(conceptLabel);
    const mime = file.mimetype || "application/octet-stream";
    if (!/^image\//.test(mime) && mime !== "application/pdf") {
      throw new BadRequestException("Solo se aceptan PDF o imágenes.");
    }
    const id = randomUUID();
    const ext = mime === "application/pdf" ? "pdf" : extForInspectionMime(mime) || "bin";
    const storageKey = `warehouse/${c.iso}/docs/${id}.${ext}`;
    await this.storage.put(storageKey, file.buffer, mime);
    const row = await this.prisma.containerDocument.create({
      data: {
        iso: c.iso,
        concept: conceptLabel,
        note: String(note || "").trim(),
        originalName: file.originalname || `documento.${ext}`,
        mimeType: mime,
        sizeBytes: file.size,
        storageKey,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.audit.log({
      user,
      action: "upload",
      entity: "ContainerDocument",
      entityId: row.id,
      after: { iso: c.iso, concept: conceptLabel },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async updateDocument(
    iso: string,
    id: string,
    input: { concept?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no edita documentos de unidad.");
    await this.loadUnit(iso);
    const row = await this.prisma.containerDocument.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Documento no encontrado.");
    const data: { concept?: string; note?: string } = {};
    if (input.concept !== undefined) {
      const conceptLabel = normalizeDocumentConcept(input.concept);
      if (conceptLabel.length < 2) throw new BadRequestException("Indica el concepto del documento.");
      await this.rememberDocumentConcept(conceptLabel);
      data.concept = conceptLabel;
    }
    if (input.note !== undefined) data.note = String(input.note || "").trim();
    await this.prisma.containerDocument.update({ where: { id }, data });
    await this.audit.log({
      user,
      action: "update",
      entity: "ContainerDocument",
      entityId: id,
      after: { iso, ...data },
      ip,
    });
    return this.presentFor(iso, user);
  }

  async deleteDocument(iso: string, id: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no elimina documentos de unidad.");
    await this.loadUnit(iso);
    const row = await this.prisma.containerDocument.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Documento no encontrado.");
    await this.storage.delete(row.storageKey).catch(() => undefined);
    await this.prisma.containerDocument.delete({ where: { id } });
    await this.audit.log({
      user,
      action: "delete",
      entity: "ContainerDocument",
      entityId: id,
      after: { iso, concept: row.concept },
      ip,
    });
    return this.presentFor(iso, user);
  }

  async emergencyIntake(
    input: { iso?: string; depotId?: string; type?: string; cat?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const inspected = inspectIntakeIso(input.iso || "");
    if (!inspected.ok) throw new BadRequestException(inspected.message);
    const iso = inspected.isoNormalized;
    const existing = await this.prisma.container.findUnique({ where: { iso } });
    if (existing?.archivedAt) throw new BadRequestException("Esta unidad está archivada.");
    if (existing) {
      return this.applyCampoEnable(existing.iso, user, ip, true);
    }
    const depot =
      (input.depotId
        ? await this.prisma.depot.findUnique({ where: { id: input.depotId } })
        : await this.prisma.depot.findFirst({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }));
    if (!depot || depot.archivedAt) throw new BadRequestException("No hay depósito disponible para el registro de emergencia.");
    const typeRow =
      (input.type ? await this.prisma.containerType.findUnique({ where: { code: input.type } }) : null) ||
      (await this.prisma.containerType.findFirst({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }));
    const catRow =
      (input.cat ? await this.prisma.category.findUnique({ where: { code: input.cat } }) : null) ||
      (await this.prisma.category.findFirst({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }));
    if (!typeRow || typeRow.archivedAt) throw new BadRequestException("Tipo inválido.");
    if (!catRow || catRow.archivedAt) throw new BadRequestException("Condición inválida.");
    await this.prisma.$transaction(async (tx) => {
      await tx.container.create({
        data: {
          iso,
          type: typeRow.code,
          cat: catRow.code,
          status: "Pendiente de ingreso",
          year: null,
          manufacturer: "—",
          depotId: depot.id,
          intakeType: "pendiente_factura",
          intakeOrigin: "emergencia",
          invoicePending: true,
          physicallyReceived: false,
          isoException: inspected.isoException,
          isoExceptionReason: inspected.isoExceptionReason,
          fobCif: 0,
          cbm: defaultCbm(typeRow.code),
          inspectionNotes: String(input.note || "").trim(),
          registeredById: user.id,
          registeredByName: user.name,
        },
      });
      await tx.containerHistory.create({
        data: {
          iso,
          type: "Emergencia",
          detail: `Registro de emergencia en campo por ${user.name}${input.note ? ` — ${input.note}` : ""}.`,
        },
      });
    });
    await this.audit.log({
      user,
      action: "emergency_intake",
      entity: "Container",
      entityId: iso,
      after: { iso, intakeOrigin: "emergencia" },
      ip,
    });
    return this.applyCampoEnable(iso, user, ip, true);
  }

  async openDocument(iso: string, id: string) {
    const row = await this.prisma.containerDocument.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Documento no encontrado.");
    const obj = await this.storage.get(row.storageKey);
    return { ...obj, contentType: row.mimeType || obj.contentType, name: row.originalName };
  }

  private async applyGateInOnce(iso: string, user: AuthUser) {
    const existing = await this.prisma.depotCostEntry.findMany({
      where: { iso, conceptKey: GATE_IN_KEY },
      select: { conceptKey: true },
    });
    if (!canApplyGateIn(existing.map((e) => e.conceptKey))) return;
    const concept = await this.prisma.depotCostConcept.findUnique({ where: { key: GATE_IN_KEY } });
    if (!concept) return;
    await this.prisma.depotCostEntry.create({
      data: {
        iso,
        conceptId: concept.id,
        conceptKey: concept.key,
        conceptLabel: concept.label,
        amount: concept.amount,
        note: "Gate-In automático al habilitar para campo",
        auto: true,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await this.prisma.container.update({ where: { iso }, data: { gateIn: true } });
    await this.prisma.containerHistory.create({
      data: {
        iso,
        type: "Gate-In",
        detail: `Gate-In aplicado automáticamente al enviar a campo.`,
      },
    });
  }

  private async rememberDocumentConcept(label: string) {
    if (DEFAULT_DOCUMENT_CONCEPTS.some((d) => d.toLowerCase() === label.toLowerCase())) return;
    const row = await this.prisma.appSetting.findUnique({ where: { key: DOCUMENTS_KEY } });
    const next = mergeCatalogOptions(DEFAULT_DOCUMENT_CONCEPTS, [...(Array.isArray(row?.value) ? row.value : []), label]);
    await this.prisma.appSetting.upsert({
      where: { key: DOCUMENTS_KEY },
      update: { value: next.filter((x) => !DEFAULT_DOCUMENT_CONCEPTS.includes(x)) },
      create: { key: DOCUMENTS_KEY, value: next.filter((x) => !DEFAULT_DOCUMENT_CONCEPTS.includes(x)) },
    });
  }

  private documentLabel(concept: string) {
    return normalizeDocumentConcept(concept);
  }

  private async loadUnitExtras(iso: string, hideRates: boolean) {
    const [captures, costs, documents, visit] = await Promise.all([
      this.prisma.fieldCapture.findMany({ where: { iso }, orderBy: { createdAt: "desc" } }),
      this.prisma.depotCostEntry.findMany({ where: { iso }, orderBy: { createdAt: "desc" } }),
      this.prisma.containerDocument.findMany({ where: { iso }, orderBy: { createdAt: "desc" } }),
      this.prisma.gateVisit.findFirst({ where: { containerIso: iso }, orderBy: { linkedAt: "desc" } }),
    ]);
    return {
      captures: captures.map((r) => ({
        id: r.id,
        kind: r.kind,
        note: r.note,
        assignedSlot: r.assignedSlot,
        originalName: r.originalName,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
      })),
      depotCosts: costs.map((r) => presentDepotCost(r, hideRates)),
      documents: documents.map((r) => ({
        id: r.id,
        concept: this.documentLabel(r.concept),
        conceptLabel: this.documentLabel(r.concept),
        note: r.note,
        originalName: r.originalName,
        mimeType: r.mimeType,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
      })),
      visit: visit
        ? {
            id: visit.id,
            tractorPlate: visit.tractorPlate,
            company: visit.company,
            ruc: visit.ruc,
            driverName: visit.driverName,
            visitAt: visit.visitAt,
            license: visit.license,
            motive: visit.motive,
            trailerPlate: visit.trailerPlate,
            phone: visit.phone,
            equipmentCode: visit.equipmentCode,
            containerIso: visit.containerIso,
            linkedAt: visit.linkedAt,
            linkedByName: visit.linkedByName,
            locked: !!visit.linkedAt,
            hasPhoto: visitPhotoStatus(visit) !== "none",
            photoStatus: visitPhotoStatus(visit),
            photoName: visit.unitPhotoName || null,
          }
        : null,
    };
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

  private presentUnit(
    c: ContainerRow,
    types: { code: string; label: string; color: string }[],
    categories: { code: string; label: string; color: string }[],
    suggested: ReturnType<typeof bestSlotFor>,
    hideOdoo = false,
    hideOdooIds = hideOdoo,
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
      campoEnabledAt: c.campoEnabledAt,
      campoEnabledByName: c.campoEnabledByName,
      material: hideOdoo ? null : c.material,
      conditionWalls: c.conditionWalls,
      roofHole: c.roofHole,
      odooLotId: hideOdooIds ? null : c.odooLotId,
      hasOdooChatter: !!c.odooLotId,
      odooLocation: hideOdooIds ? null : c.odooLocation,
      odooDua: hideOdoo ? null : c.odooDua,
      originCountry: hideOdoo ? null : c.originCountry,
      odooSource: hideOdooIds ? null : c.odooSource,
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
