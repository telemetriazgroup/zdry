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
import { AuthUser, isSuperadmin } from "../auth/auth.types";
import { StorageService } from "../storage/storage.service";
import { YardLockService } from "../redis/yard-lock.service";
import { inspectIntakeIso } from "../domain/intake-iso";
import { ACTIVE_MASTER } from "../domain/masters";
import { MANUFACTURERS } from "../domain/purchase-extras";
import { CONDITION_GRADES, parseCondition } from "../domain/odoo-purchase";
import { YEAR_MIN } from "../domain/year";
import {
  DEFAULT_DOCUMENT_CONCEPTS,
  mergeCatalogOptions,
  normalizeDocumentConcept,
  normalizeOptionLabel,
} from "../domain/catalog-options";
import { canApplyGateIn, GATE_IN_KEY, presentDepotCost } from "../domain/depot-costs";
import { visitPhotoStatus } from "../domain/gate-visit";
import { EvaluationService } from "../evaluation/evaluation.service";
import {
  needsPatioChoice,
  warehouseFromLocation,
  warehouseLabel,
  zgrouPatioCodes,
} from "../domain/odoo-warehouse";
import { ensureOperationalDepots } from "../odoo-import/depot-map.store";
import {
  extForInspectionMime,
  MAX_INSPECTION_PHOTO_BYTES,
  MAX_INSPECTION_VIDEO_BYTES,
  sniffInspectionPhotoMime,
  sniffInspectionVideoMime,
} from "../domain/inspection-media";
import { stripVideoAudio } from "../domain/video-process";
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
import { limaDayRange, listOdooLotNotes } from "../odoo/odoo-lot-photos";
import { listOrCacheOdooPhotos, openOrCacheOdooPhoto } from "../odoo-import/odoo-photo-cache.store";
import { ExpedienteStore } from "../odoo-events/expediente.store";
import { ODOO_LOT_SELECT_FALLBACK, receptionOwnedPatch } from "../domain/odoo-lot-map";
import { OdooImportService } from "../odoo-import/odoo-import.service";
import { toOdooRefJpeg } from "../domain/odoo-ref-jpeg";
import {
  ZDRY_REF_DESC,
  ZDRY_SYNC_CONTEXT,
  canPublishOdooRef,
  isZdryRefNoteBody,
  pickZdryRefIdsToUnlink,
  plainChatterBody,
  zdryRefAttachmentName,
  zdryRefMessageBody,
  zdryRefMessagePostKw,
  zdryRefSearchDomain,
} from "../domain/odoo-ref-photo";

const CAMPO_ODOO_LOCKED = [
  "tareKg",
  "mgwKg",
  "color",
  "year",
  "manufacturer",
  "odooDua",
  "originCountry",
  "material",
  "odooDescription",
  "zgroupCode",
  "internalRef",
  "lotCategory",
  "classification",
  "lotCode",
  "numberingDate",
  "manufactureMonth",
  "productTitle",
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
    private readonly evaluation: EvaluationService,
    private readonly odooImport: OdooImportService,
  ) {
    this.expediente = new ExpedienteStore(prisma);
  }

  private readonly expediente: ExpedienteStore;

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
    const [types, categories, depots, customers, rules, colorRow, mfrRow, docRow, concepts, evalCatalog] = await Promise.all([
      this.prisma.containerType.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.category.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.depot.findMany({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }),
      this.prisma.customer.findMany({ where: await this.prisma.hideDemo(), orderBy: { companyName: "asc" } }),
      this.getLayoutRules(),
      this.prisma.appSetting.findUnique({ where: { key: COLORS_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: MANUFACTURERS_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: DOCUMENTS_KEY } }),
      this.prisma.depotCostConcept.findMany({ where: { active: true }, orderBy: [{ system: "desc" }, { label: "asc" }] }),
      this.evaluation.presentCatalog(),
    ]);
    const maxY = new Date().getFullYear();
    const years: number[] = [];
    for (let y = maxY; y >= YEAR_MIN; y--) years.push(y);
    const hideRates = user ? hideRatesFor(user.role) : false;
    const zgrouPatios = depots
      .filter((d) => zgrouPatioCodes().includes((d.code || "") as "principal" | "gambeta_1" | "gambeta_2"))
      .map((d) => ({ id: d.id, code: d.code, name: d.name, city: d.city }));
    return {
      types,
      categories,
      depots: depots.map((d) => ({
        ...d,
        pending: d.code === "callao_pendiente",
        zgrouChoice: zgrouPatioCodes().includes((d.code || "") as "principal" | "gambeta_1" | "gambeta_2"),
      })),
      zgrouPatios,
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
      ...evalCatalog,
      odooSelects: await this.odooImport.lotSelects().catch(() => ({ ...ODOO_LOT_SELECT_FALLBACK })),
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

  async rentalReturns() {
    const rows = await this.prisma.quote.findMany({
      where: {
        kind: "alquiler",
        dealStatus: { notIn: ["perdida", "expirada"] },
        odooPickingState: "done",
        OR: [{ odooPickingInState: null }, { odooPickingInState: { not: "done" } }],
      },
      include: {
        lines: true,
        customer: { select: { companyName: true, rucDni: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((q) => ({
      id: q.id,
      number: q.number,
      odooSaleName: q.odooSaleName,
      customer: q.customer.companyName,
      pickingName: q.odooPickingName,
      pickingInName: q.odooPickingInName,
      pickingInState: q.odooPickingInState,
      isos: q.lines.map((l) => l.iso),
    }));
  }

  pending(user?: AuthUser) {
    return this.receptionRows(user, false);
  }

  /** Unidades ya enviadas a campo. La ficha es la misma: el coordinador puede corregir. */
  validated(user?: AuthUser) {
    return this.receptionRows(user, true);
  }

  private async receptionRows(user: AuthUser | undefined, sent: boolean) {
    const live = await this.prisma.liveContainers();
    const seeArchived = isSuperadmin(user?.role);
    const [types, categories, rows] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.container.findMany({
        where: {
          status: { not: "Vendido" },
          ...(seeArchived ? (live.demo === false ? { demo: false as const } : {}) : live),
        },
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
        if (sent ? waitingCampo : !waitingCampo) return null;
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
          odooLocation: user?.role === "admin" || user?.role === "superadmin" || user?.role === "coordinador" ? c.odooLocation : null,
          odooWarehouse: c.odooWarehouse || warehouseFromLocation(c.odooLocation),
          odooWarehouseLabel: warehouseLabel(c.odooWarehouse || warehouseFromLocation(c.odooLocation)),
          needsPatioChoice: needsPatioChoice(c.odooWarehouse || warehouseFromLocation(c.odooLocation), c.depot.code),
          depotCode: c.depot.code,
          status: c.status,
          registeredByName: c.registeredByName || "—",
          createdAt: c.createdAt,
          campoEnabledAt: c.campoEnabledAt,
          campoEnabledByName: c.campoEnabledByName || "",
          waitingCampo,
          archived: !!c.archivedAt,
          archiveReason: c.archiveReason || "",
          archivedByName: c.archivedByName || "",
          archivedAt: c.archivedAt,
          missing: c.archivedAt
            ? [`Archivada${c.archiveReason ? `: ${c.archiveReason}` : ""}`]
            : sent
            ? (missing.length ? missing : [`En campo${c.campoEnabledByName ? ` · ${c.campoEnabledByName}` : ""}`])
            : waitingCampo && !missing.length ? ["Pendiente de enviar a campo"] : missing,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  async getUnit(iso: string, opts: { hideOdoo?: boolean; hideOdooIds?: boolean; hideRates?: boolean; includeArchive?: boolean } = {}) {
    await this.odooImport.hydrateReceptionFicha(iso).catch(() => undefined);
    const c = await this.loadUnit(iso, !!opts.includeArchive);
    await this.evaluation.importLegacyForUnit(c.iso, c);
    const [types, categories, rules, extras] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.getLayoutRules(),
      this.loadUnitExtras(c.iso, !!opts.hideRates, !!opts.includeArchive),
    ]);
    const occupants = (await this.prisma.container.findMany({ where: { depotId: c.depotId, lado: { not: null } } })).map(
      toYardUnit,
    );
    const suggested = bestSlotFor(occupants, c.depotId, c.type, c.cat, DEFAULT_YARD_CONFIG, rules);
    return { ...this.presentUnit(c, types, categories, suggested, opts.hideOdoo, opts.hideOdooIds), ...extras };
  }

  async setUnitRating(
    iso: string,
    body: { conceptId?: string; levelId?: string; reason?: string; note?: string; source?: "patio" | "recepcion" | "catalogo" },
    user: AuthUser,
    ip?: string,
  ) {
    await this.loadUnit(iso);
    await this.evaluation.setRating(iso, body, user, ip);
    return this.presentFor(iso, user);
  }

  private presentFor(iso: string, user: AuthUser) {
    return this.getUnit(iso, {
      hideOdoo: hideOdooFor(user.role),
      hideOdooIds: hideOdooIdsFor(user.role),
      hideRates: hideRatesFor(user.role),
      includeArchive: user.role === "superadmin",
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
      year?: number | string | null;
      manufacturer?: string;
      inspectionNotes?: string;
      odooDua?: string;
      originCountry?: string;
      material?: string;
      odooDescription?: string;
      zgroupCode?: string;
      internalRef?: string;
      lotCategory?: string;
      classification?: string;
      lotCode?: string;
      numberingDate?: string;
      manufactureMonth?: string;
      productTitle?: string;
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
      const raw = body.year == null ? "" : String(body.year).trim();
      if (!raw) data.year = null;
      else if (/^\d{4}$/.test(raw)) {
        const year = Number(raw);
        const max = new Date().getFullYear() + 1;
        if (year < 1960 || year > max) throw new BadRequestException(`El año debe estar entre 1960 y ${max}.`);
        data.year = year;
      }
    }
    if (body.manufacturer !== undefined) data.manufacturer = body.manufacturer || "—";
    if (body.inspectionNotes !== undefined) data.inspectionNotes = String(body.inspectionNotes || "");
    if (body.odooDua !== undefined) data.odooDua = String(body.odooDua || "").trim() || null;
    if (body.originCountry !== undefined) data.originCountry = String(body.originCountry || "").trim() || null;
    if (body.material !== undefined) data.material = String(body.material || "").trim() || null;
    if (body.odooDescription !== undefined) data.odooDescription = String(body.odooDescription || "");
    const lotKeys = ["zgroupCode", "internalRef", "lotCategory", "classification", "lotCode", "numberingDate", "manufactureMonth", "productTitle"] as const;
    if (body.year !== undefined || lotKeys.some((key) => body[key] !== undefined) || body.color !== undefined) {
      const prev = c.odooSource && typeof c.odooSource === "object" && !Array.isArray(c.odooSource)
        ? { ...(c.odooSource as Record<string, unknown>) }
        : {};
      if (body.year !== undefined) prev.yearToken = body.year == null || body.year === "" ? null : String(body.year).trim();
      if (body.color !== undefined) prev.color = body.color || null;
      for (const key of lotKeys) {
        if (body[key] !== undefined) prev[key] = String(body[key] || "").trim() || null;
      }
      data.odooSource = prev as Prisma.InputJsonValue;
    }
    for (const key of ["conditionFloor", "conditionRoof", "conditionDoors", "conditionPaint", "conditionWalls"] as const) {
      if (body[key] !== undefined) data[key] = parseCondition(body[key]) || null;
    }
    if (body.roofHole !== undefined) data.roofHole = body.roofHole == null || body.roofHole === ("" as never) ? null : !!body.roofHole;
    await this.prisma.container.update({ where: { iso: c.iso }, data });
    await this.evaluation.syncLegacyFields(
      c.iso,
      {
        conditionFloor: body.conditionFloor,
        conditionRoof: body.conditionRoof,
        conditionDoors: body.conditionDoors,
        conditionPaint: body.conditionPaint,
        conditionWalls: body.conditionWalls,
      },
      user,
      ip,
      "patio",
    );
    await this.audit.log({
      user,
      action: "update",
      entity: "Container",
      entityId: c.iso,
      after: data as object,
      ip,
    });
    const owned = receptionOwnedPatch(body);
    let writeback: { ok: boolean; flushed?: number; skipped?: boolean; message?: string } | null = null;
    if (c.odooLotId && Object.keys(owned).length) {
      writeback = await this.odooImport.writebackFromUnit(c.iso, owned, "recepcion_save");
    }
    const unit = await this.presentFor(c.iso, user);
    return {
      ...unit,
      writeback,
      saveMessage:
        !c.odooLotId || !Object.keys(owned).length
          ? undefined
          : writeback?.skipped
            ? undefined
            : writeback?.ok
              ? "Guardado en ZDRY y actualizado en Odoo."
              : `Guardado en ZDRY. Odoo no aceptó el cambio: ${writeback?.message || "error"}`,
    };
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
      const processed = await stripVideoAudio(file.buffer, ext);
      if (!processed.stripped) {
        throw new BadRequestException("No se pudo quitar el audio del video. Sube un MP4 válido.");
      }
      const storageKey = `warehouse/${c.iso}/video360.mp4`;
      await this.storage.put(storageKey, processed.buffer, processed.mime);
      await this.prisma.container.update({
        where: { iso: c.iso },
        data: {
          video360Key: storageKey,
          video360Mime: processed.mime,
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
    return listOrCacheOdooPhotos(this.prisma, this.storage, this.odoo, {
      odooLotId: c.odooLotId,
      containerIso: c.iso,
    });
  }

  async listOdooNotes(iso: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) return [];
    await this.scrubZdryRefNotes(c.odooLotId);
    const notes = await listOdooLotNotes(this.odoo, c.odooLotId);
    await this.expediente.importOdooNotes(c.iso, notes, { containerIso: c.iso });
    return notes;
  }

  async openOdooPhoto(iso: string, attId: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) throw new NotFoundException("Esta unidad no tiene lote Odoo.");
    return openOrCacheOdooPhoto(this.prisma, this.storage, this.odoo, {
      odooLotId: c.odooLotId,
      containerIso: c.iso,
    }, attId);
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
    const obj = await openOrCacheOdooPhoto(this.prisma, this.storage, this.odoo, {
      odooLotId: c.odooLotId,
      containerIso: c.iso,
    }, attId);
    await this.storeInspectionPhoto(
      c,
      slot,
      obj.buffer,
      obj.name,
      obj.buffer.length,
      user,
      ip,
      "Reemplazada por foto de Odoo",
      "odoo",
    );
    return this.presentFor(c.iso, user);
  }

  async setOdooRef(iso: string, slotRaw: string | number, user: AuthUser, ip?: string) {
    const c = await this.loadUnit(iso);
    if (!c.odooLotId) {
      throw new BadRequestException("Esta unidad no está amarrada a un lote Odoo.");
    }
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    const photo = c.photos.find((p) => p.slot === slot && p.status === PHOTO_STATUS_ACTIVE);
    const gate = canPublishOdooRef(photo);
    if (!gate.ok) throw new BadRequestException(gate.message);
    const raw = await this.storage.getBuffer(photo!.storageKey);
    const jpeg = await toOdooRefJpeg(raw.buffer);
    const existing = await this.odoo.searchRead(
      "ir.attachment",
      zdryRefSearchDomain(c.odooLotId, c.iso),
      ["id", "name", "description"],
      { limit: 20 },
    );
    const created = await this.odoo.create(
      "ir.attachment",
      {
        name: zdryRefAttachmentName(c.iso),
        description: ZDRY_REF_DESC,
        res_model: "stock.lot",
        res_id: c.odooLotId,
        type: "binary",
        mimetype: "image/jpeg",
        datas: jpeg.toString("base64"),
      },
      { context: { ...ZDRY_SYNC_CONTEXT } },
    );
    const newId = Number(created);
    if (!newId) throw new BadRequestException("Odoo no devolvió el adjunto de referencia.");
    const stored = await this.odoo.read("ir.attachment", [newId], ["file_size", "mimetype", "name"]);
    if (!Number(stored?.[0]?.file_size)) {
      throw new BadRequestException("Odoo guardó el adjunto vacío. Revisa permisos de ir.attachment del usuario API.");
    }
    const label = PHOTO_LABELS[slot] || `Casilla ${slot + 1}`;
    await this.odoo.callKw(
      "stock.lot",
      "message_post",
      [[c.odooLotId]],
      {
        ...zdryRefMessagePostKw(zdryRefMessageBody(c.iso, slot, label), newId),
        context: { ...ZDRY_SYNC_CONTEXT },
      },
    );
    const stale = pickZdryRefIdsToUnlink(
      existing.map((a) => ({ id: Number(a.id), name: String(a.name || ""), description: String(a.description || "") })),
      newId,
    );
    if (stale.length) {
      await this.odoo.unlink("ir.attachment", stale, { context: { ...ZDRY_SYNC_CONTEXT } });
    }
    await this.scrubZdryRefNotes(c.odooLotId);
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { odooRefAttachmentId: newId, odooRefSlot: slot, odooRefPushedAt: new Date() },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "OdooRefPhoto",
      entityId: c.iso,
      after: { slot, odooRefAttachmentId: newId, unlinked: stale },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  private async scrubZdryRefNotes(lotId: number) {
    const rows = await this.odoo.searchRead(
      "mail.message",
      [
        ["model", "=", "stock.lot"],
        ["res_id", "=", lotId],
      ],
      ["id", "body"],
      { limit: 40, order: "id desc" },
    );
    for (const row of rows) {
      const raw = String(row.body || "");
      if (!isZdryRefNoteBody(raw) || !/<\/?p|&lt;\/?p/i.test(raw)) continue;
      const plain = plainChatterBody(raw);
      if (!plain) continue;
      await this.odoo.write("mail.message", [Number(row.id)], { body: plain }, { context: { ...ZDRY_SYNC_CONTEXT } });
    }
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

  async archive(iso: string, input: { kind?: string; comment?: string }, user: AuthUser, ip?: string) {
    const why = archiveMotive(input.kind, input.comment);
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

  async unarchive(iso: string, user: AuthUser, ip?: string) {
    if (!isSuperadmin(user.role)) throw new ForbiddenException("Solo el superusuario desarchiva.");
    const c = await this.loadUnit(iso, true);
    if (!c.archivedAt) throw new BadRequestException("Esta unidad no está archivada.");
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { archivedAt: null, archiveReason: null, archivedById: null, archivedByName: null },
    });
    await this.prisma.containerHistory.create({
      data: { iso: c.iso, type: "Archivo", detail: `Unidad desarchivada por ${user.name}.` },
    });
    await this.audit.log({ user, action: "unarchive", entity: "Container", entityId: c.iso, ip });
    return this.presentFor(c.iso, user);
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

  async migrateDepot(iso: string, depotId: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("Solo el coordinador o el administrador migran el almacén.");
    }
    const c = await this.loadUnit(iso);
    const depot = await this.prisma.depot.findUnique({ where: { id: depotId || "" } });
    if (!depot || depot.archivedAt) throw new BadRequestException("Elige un almacén disponible.");
    if (depot.id === c.depotId) throw new BadRequestException("La unidad ya está en ese almacén.");
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: { depotId: depot.id, lado: null, ruma: null, columna: null, nivel: null },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Almacén",
        detail: `Almacén migrado de ${c.depot.name} a ${depot.name} por ${user.name}. La posición de patio queda libre.`,
      },
    });
    await this.audit.log({
      user,
      action: "migrate_depot",
      entity: "Container",
      entityId: c.iso,
      before: { depotId: c.depotId, depotName: c.depot.name },
      after: { depotId: depot.id, depotName: depot.name },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async enableCampo(iso: string, user: AuthUser, ip?: string, depotId?: string) {
    if (user.role === "almacen") {
      throw new ForbiddenException("Solo el coordinador o el administrador envían unidades a campo.");
    }
    return this.applyCampoEnable(iso, user, ip, false, depotId);
  }

  private async applyCampoEnable(iso: string, user: AuthUser, ip?: string, emergency = false, depotId?: string) {
    const c = await this.loadUnit(iso);
    if (c.campoEnabledAt) return this.presentFor(c.iso, user);
    await ensureOperationalDepots(this.prisma);
    const warehouse = c.odooWarehouse || warehouseFromLocation(c.odooLocation);
    let nextDepotId = c.depotId;
    if (depotId) {
      const chosen = await this.prisma.depot.findUnique({ where: { id: depotId } });
      if (!chosen || chosen.archivedAt) throw new BadRequestException("Elige un almacén disponible.");
      nextDepotId = chosen.id;
    } else if (needsPatioChoice(warehouse, c.depot.code)) {
      throw new BadRequestException("Elige el almacén antes de enviar a campo.");
    }
    const nextStatus = c.status === "Pendiente de ingreso" ? "Disponible" : c.status;
    await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        depotId: nextDepotId,
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
      after: { campoEnabledAt: true, emergency, depotId: nextDepotId },
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
    let payload = file.buffer;
    let storedMime = mime;
    let storedExt = ext;
    let storedSize = file.size;
    if (kind === "video") {
      const processed = await stripVideoAudio(file.buffer, ext);
      if (!processed.stripped) {
        throw new BadRequestException("No se pudo quitar el audio del video. Sube un MP4 válido.");
      }
      payload = processed.buffer;
      storedMime = processed.mime;
      storedExt = "mp4";
      storedSize = processed.buffer.length;
    }
    const storageKey = `warehouse/${c.iso}/captures/${id}.${storedExt}`;
    await this.storage.put(storageKey, payload, storedMime);
    const row = await this.prisma.fieldCapture.create({
      data: {
        iso: c.iso,
        kind,
        storageKey,
        mimeType: storedMime,
        originalName: file.originalname || `${kind}.${storedExt}`,
        sizeBytes: storedSize,
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

  async openCapture(iso: string, id: string, user?: AuthUser) {
    const row = await this.prisma.fieldCapture.findFirst({ where: { id, iso } });
    if (!row) throw new NotFoundException("Toma no encontrada.");
    if (row.archivedAt && user?.role !== "superadmin") {
      throw new ForbiddenException("Solo el superusuario ve las tomas archivadas.");
    }
    const obj = await this.storage.get(row.storageKey);
    return { ...obj, contentType: row.mimeType || obj.contentType, name: row.originalName };
  }

  async openPhotoHistory(iso: string, id: string) {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id, iso, status: PHOTO_STATUS_REJECTED },
    });
    if (!photo) throw new NotFoundException("Foto archivada no encontrada.");
    const obj = await this.storage.get(photo.storageKey);
    return { ...obj, contentType: photo.mimeType || obj.contentType };
  }

  async archiveCapture(iso: string, id: string, user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no archiva tomas.");
    const c = await this.loadUnit(iso);
    const cap = await this.prisma.fieldCapture.findFirst({ where: { id, iso: c.iso, archivedAt: null } });
    if (!cap) throw new NotFoundException("Toma no encontrada.");
    await this.prisma.fieldCapture.update({
      where: { id: cap.id },
      data: { archivedAt: new Date(), archivedById: user.id, archivedByName: user.name },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Foto",
        detail: `${user.name} archivó una toma de campo${cap.originalName ? ` (${cap.originalName})` : ""}.`,
      },
    });
    await this.audit.log({
      user,
      action: "archive_capture",
      entity: "FieldCapture",
      entityId: cap.id,
      after: { iso: c.iso },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  async restoreCapture(iso: string, id: string, user: AuthUser, ip?: string) {
    if (!isSuperadmin(user.role)) throw new ForbiddenException("Solo el superusuario desarchiva imágenes.");
    const c = await this.loadUnit(iso, true);
    const cap = await this.prisma.fieldCapture.findFirst({ where: { id, iso: c.iso, archivedAt: { not: null } } });
    if (!cap) throw new NotFoundException("Toma archivada no encontrada.");
    await this.prisma.fieldCapture.update({
      where: { id: cap.id },
      data: { archivedAt: null, archivedById: null, archivedByName: null, assignedSlot: null },
    });
    await this.prisma.containerHistory.create({
      data: { iso: c.iso, type: "Foto", detail: `${user.name} desarchivó una toma de campo.` },
    });
    await this.audit.log({ user, action: "restore_capture", entity: "FieldCapture", entityId: cap.id, after: { iso: c.iso }, ip });
    return this.presentFor(c.iso, user);
  }

  async restoreArchivedPhoto(iso: string, id: string, user: AuthUser, ip?: string) {
    if (!isSuperadmin(user.role)) throw new ForbiddenException("Solo el superusuario desarchiva imágenes.");
    const c = await this.loadUnit(iso, true);
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id, iso: c.iso, status: PHOTO_STATUS_REJECTED },
    });
    if (!photo) throw new NotFoundException("Foto archivada no encontrada.");
    const occupied = await this.prisma.inspectionPhoto.findFirst({
      where: { iso: c.iso, slot: photo.slot, status: PHOTO_STATUS_ACTIVE },
    });
    if (occupied) {
      throw new BadRequestException(`La casilla ${photo.slot + 1} ya tiene una foto. Quítala antes de desarchivar esta.`);
    }
    await this.prisma.inspectionPhoto.update({
      where: { id: photo.id },
      data: { status: PHOTO_STATUS_ACTIVE, rejectedAt: null, rejectedById: null, rejectedByName: null, rejectNote: null },
    });
    await this.prisma.containerHistory.create({
      data: { iso: c.iso, type: "Foto", detail: `${user.name} desarchivó la foto de la casilla ${photo.slot + 1}.` },
    });
    await this.audit.log({ user, action: "restore_photo", entity: "InspectionPhoto", entityId: photo.id, after: { iso: c.iso, slot: photo.slot }, ip });
    return this.presentFor(c.iso, user);
  }

  async clearSlot(iso: string, slotRaw: string, to: "campo" | "archive", user: AuthUser, ip?: string) {
    if (user.role === "almacen") throw new ForbiddenException("El personal de campo no quita casillas del catálogo.");
    const c = await this.loadUnit(iso);
    const isVideo = slotRaw === "video" || slotRaw === "9";
    const slot = isVideo ? 9 : Number(slotRaw);
    if (!isVideo && (!Number.isInteger(slot) || slot < 0 || slot > 8)) {
      throw new BadRequestException("Slot de foto inválido (0–8).");
    }
    const photo = isVideo ? null : c.photos.find((p) => p.slot === slot && p.status === PHOTO_STATUS_ACTIVE);
    if (isVideo ? !c.video360Key : !photo) throw new BadRequestException("Esa casilla está vacía.");
    const linked = await this.prisma.fieldCapture.findFirst({
      where: { iso: c.iso, assignedSlot: slot, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (to === "campo") {
      if (linked) {
        await this.prisma.fieldCapture.update({ where: { id: linked.id }, data: { assignedSlot: null } });
      } else if (isVideo && c.video360Key) {
        await this.captureFromStored(c.iso, c.video360Key, c.video360Mime || "video/mp4", "video", "Video 360", user, false);
      } else if (photo) {
        await this.captureFromStored(c.iso, photo.storageKey, photo.mimeType, "photo", photo.originalName, user, false);
      }
    } else if (linked) {
      await this.prisma.fieldCapture.update({
        where: { id: linked.id },
        data: { archivedAt: new Date(), archivedById: user.id, archivedByName: user.name },
      });
    } else if (isVideo && c.video360Key) {
      await this.captureFromStored(c.iso, c.video360Key, c.video360Mime || "video/mp4", "video", "Video 360", user, true);
    }
    if (isVideo) {
      await this.prisma.container.update({
        where: { iso: c.iso },
        data: { video360Key: null, video360Mime: null },
      });
    } else if (photo) {
      await this.archivePhoto(photo, user, to === "campo" ? "Devuelta a tomas de campo" : "Quitada de la casilla");
      if (c.odooRefSlot === slot) {
        await this.prisma.container.update({
          where: { iso: c.iso },
          data: { odooRefSlot: null, odooRefAttachmentId: null, odooRefPushedAt: null },
        });
      }
    }
    const label = isVideo ? "Video 360" : PHOTO_LABELS[slot] || `Casilla ${slot + 1}`;
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Foto",
        detail: to === "campo"
          ? `${user.name} sacó ${label} de la casilla y la devolvió a tomas de campo.`
          : `${user.name} quitó ${label} de la casilla. Quedó archivada.`,
      },
    });
    await this.audit.log({
      user,
      action: "clear_slot",
      entity: "InspectionPhoto",
      entityId: c.iso,
      after: { slot, to },
      ip,
    });
    return this.presentFor(c.iso, user);
  }

  private async captureFromStored(
    iso: string,
    storageKey: string,
    mimeType: string,
    kind: "photo" | "video",
    originalName: string,
    user: AuthUser,
    archived: boolean,
  ) {
    const buf = await this.storage.getBuffer(storageKey);
    const ext = storageKey.split(".").pop() || (kind === "video" ? "mp4" : "jpg");
    const id = randomUUID();
    const nextKey = `warehouse/${iso}/captures/${id}.${ext}`;
    await this.storage.put(nextKey, buf.buffer, mimeType || buf.contentType || "application/octet-stream");
    await this.prisma.fieldCapture.create({
      data: {
        iso,
        kind,
        storageKey: nextKey,
        mimeType: mimeType || buf.contentType || "application/octet-stream",
        originalName: originalName || `${kind}.${ext}`,
        sizeBytes: buf.buffer.length,
        note: "",
        createdById: user.id,
        createdByName: user.name,
        archivedAt: archived ? new Date() : null,
        archivedById: archived ? user.id : null,
        archivedByName: archived ? user.name : null,
      },
    });
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
      await this.prisma.fieldCapture.updateMany({
        where: { iso: c.iso, assignedSlot: 9, archivedAt: null, id: { not: cap.id } },
        data: { assignedSlot: null },
      });
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
      await this.prisma.fieldCapture.updateMany({
        where: { iso: c.iso, assignedSlot: slot, archivedAt: null, id: { not: cap.id } },
        data: { assignedSlot: null },
      });
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

  private async loadUnitExtras(iso: string, hideRates: boolean, includeArchive = false) {
    const [captures, archivedCaptures, archivedPhotos, costs, documents, visit, evalData] = await Promise.all([
      this.prisma.fieldCapture.findMany({ where: { iso, archivedAt: null }, orderBy: { createdAt: "desc" } }),
      includeArchive
        ? this.prisma.fieldCapture.findMany({ where: { iso, archivedAt: { not: null } }, orderBy: { archivedAt: "desc" } })
        : Promise.resolve([]),
      includeArchive
        ? this.prisma.inspectionPhoto.findMany({ where: { iso, status: PHOTO_STATUS_REJECTED }, orderBy: { rejectedAt: "desc" } })
        : Promise.resolve([]),
      this.prisma.depotCostEntry.findMany({ where: { iso }, orderBy: { createdAt: "desc" } }),
      this.prisma.containerDocument.findMany({ where: { iso }, orderBy: { createdAt: "desc" } }),
      this.prisma.gateVisit.findFirst({ where: { containerIso: iso, archivedAt: null }, orderBy: { linkedAt: "desc" } }),
      this.evaluation.forUnit(iso),
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
      archivedCaptures: archivedCaptures.map((r) => ({
        id: r.id,
        kind: r.kind,
        note: r.note,
        assignedSlot: r.assignedSlot,
        originalName: r.originalName,
        createdByName: r.createdByName,
        createdAt: r.createdAt,
        archivedAt: r.archivedAt,
        archivedByName: r.archivedByName,
      })),
      archivedPhotos: archivedPhotos.map((p) => ({
        id: p.id,
        slot: p.slot,
        label: PHOTO_LABELS[p.slot] || `Casilla ${p.slot + 1}`,
        originalName: p.originalName,
        rejectedAt: p.rejectedAt,
        rejectedByName: p.rejectedByName,
        rejectNote: p.rejectNote,
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
            publicToken: visit.publicToken,
          }
        : null,
      ratings: evalData.ratings,
      ratingHistory: evalData.ratingHistory,
    };
  }

  private async loadUnit(iso: string, allowArchived = false): Promise<ContainerRow> {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: {
        depot: true,
        photos: ACTIVE_PHOTOS,
        ownerCustomer: { select: { id: true, companyName: true, rucDni: true } },
      },
    });
    if (!c) throw new NotFoundException("Contenedor no encontrado.");
    if (c.archivedAt && !allowArchived) throw new BadRequestException("Esta unidad está archivada.");
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
    source = "zdry",
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
        source,
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
      depotCode: c.depot.code,
      odooWarehouse: hideOdoo ? null : c.odooWarehouse || warehouseFromLocation(c.odooLocation),
      odooWarehouseLabel: hideOdoo ? null : warehouseLabel(c.odooWarehouse || warehouseFromLocation(c.odooLocation)),
      needsPatioChoice: needsPatioChoice(c.odooWarehouse || warehouseFromLocation(c.odooLocation), c.depot.code),
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
      archiveReason: c.archiveReason,
      ownerCustomer: c.ownerCustomer,
      storageDiscountPct: Number(c.storageDiscountPct),
      photos: photoSlots,
      photoOrigins: Array.from({ length: 9 }, (_, i) => {
        const p = c.photos.find((x) => x.slot === i && x.status !== PHOTO_STATUS_REJECTED);
        return p ? p.source || "zdry" : null;
      }),
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
      odooDescription: hideOdoo ? "" : c.odooDescription,
      conditionWalls: c.conditionWalls,
      roofHole: c.roofHole,
      odooLotId: hideOdooIds ? null : c.odooLotId,
      hasOdooChatter: !!c.odooLotId,
      canPushOdooRef: !!c.odooLotId,
      odooRefSlot: c.odooRefSlot,
      odooRefPushedAt: c.odooRefPushedAt,
      odooRefAttachmentId: hideOdooIds ? null : c.odooRefAttachmentId,
      odooLocation: hideOdooIds ? null : c.odooLocation,
      odooDua: hideOdoo ? null : c.odooDua,
      originCountry: hideOdoo ? null : c.originCountry,
      odooSource: hideOdooIds ? null : c.odooSource,
      lotFicha: hideOdoo ? null : lotFichaOf(c),
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

function lotText(value: unknown) {
  if (value == null || value === "—") return "";
  return String(value);
}

function lotFichaOf(c: { year: number | null; color: string; odooSource: unknown }) {
  const src = c.odooSource && typeof c.odooSource === "object" && !Array.isArray(c.odooSource)
    ? (c.odooSource as Record<string, unknown>)
    : {};
  const date = lotText(src.numberingDate);
  const isoDate = date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    || (() => {
      const dmy = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : "";
    })();
  return {
    zgroupCode: lotText(src.zgroupCode),
    internalRef: lotText(src.internalRef),
    lotCategory: lotText(src.lotCategory),
    classification: lotText(src.classification),
    lotCode: lotText(src.lotCode),
    numberingDate: isoDate,
    manufactureMonth: lotText(src.manufactureMonth),
    productTitle: lotText(src.productTitle),
    yearToken: lotText(src.yearToken) || (c.year ? String(c.year) : ""),
    color: c.color && c.color !== "—" ? c.color : lotText(src.color),
  };
}

function archiveMotive(kind?: string, comment?: string): string {
  const key = String(kind || "").trim().toLowerCase();
  if (key === "activo") return "Activo";
  if (key === "otro") {
    const note = String(comment || "").trim();
    if (note.length < 4) throw new BadRequestException("Si el motivo es Otro, el comentario es obligatorio.");
    return `Otro: ${note}`;
  }
  throw new BadRequestException("Elige el motivo: Activo u Otro.");
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
