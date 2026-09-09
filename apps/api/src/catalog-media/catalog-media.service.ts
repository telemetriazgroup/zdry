import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Readable } from "stream";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { WarehouseService } from "../warehouse/warehouse.service";
import { StorageService } from "../storage/storage.service";
import { AuthUser } from "../auth/auth.types";
import { PHOTO_LABELS } from "../domain/yard";
import { applyCatalogWatermark, loadDefaultWatermark } from "../domain/watermark";
import { CONDITION_GRADES, parseCondition } from "../domain/odoo-purchase";
import {
  MEDIA_APPROVER_ROLES,
  PHOTO_STATUS_ACTIVE,
  PHOTO_STATUS_REJECTED,
  isMediaApproved,
} from "../domain/catalog-media";
import {
  ACQUISITION_REFS_KEY,
  DEFAULT_PRICING_RULES,
  computeListPrices,
  describeOffer,
  normalizeAcquisitionRefs,
  overrideFromVisibilityMode,
  parseMoneyAmount,
  type AcquisitionRef,
  type OfferVisibilityMode,
  type PricingRule,
} from "../domain/pricing";
import { EvaluationService } from "../evaluation/evaluation.service";
import { DEFAULT_VISIBILITY_RULES, type VisibilityRule } from "../domain/visibility";

const ACTIVE_PHOTOS = { where: { status: PHOTO_STATUS_ACTIVE } };
export const WATERMARK_KEY = "catalog_watermark";

@Injectable()
export class CatalogMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouse: WarehouseService,
    private readonly storage: StorageService,
    private readonly evaluation: EvaluationService,
  ) {}

  async meta() {
    const [custom, evalCatalog] = await Promise.all([this.customWatermarkKey(), this.evaluation.presentCatalog()]);
    return {
      photoLabels: PHOTO_LABELS,
      approverRoles: MEDIA_APPROVER_ROLES,
      conditionGrades: CONDITION_GRADES,
      watermarkReady: true,
      watermarkSource: custom ? "custom" : "default",
      watermarkName: custom ? custom.name : "zg_marca.png",
      ...evalCatalog,
    };
  }

  async list() {
    const rows = await this.prisma.container.findMany({
      where: {
        ...(await this.prisma.liveContainers()),
        intakeType: { in: ["compra", "pendiente_factura"] },
        status: { in: ["Disponible", "Reservado", "Pendiente de ingreso"] },
        OR: [{ physicallyReceived: true }, { lado: { not: null } }],
      },
      include: { depot: true, photos: { select: { slot: true, status: true } } },
      orderBy: { iso: "asc" },
    });
    return rows.map((c) => {
      const active = c.photos.filter((p) => p.status === PHOTO_STATUS_ACTIVE);
      const rejected = c.photos.filter((p) => p.status === PHOTO_STATUS_REJECTED);
      return {
        iso: c.iso,
        type: c.type,
        cat: c.cat,
        status: c.status,
        depotName: c.depot.name,
        manufacturer: c.manufacturer,
        year: c.year,
        photoCount: active.length,
        historyCount: rejected.length,
        hasVideo: !!c.video360Key,
        inspectionNotes: c.inspectionNotes,
        mediaStatus: c.mediaStatus,
        mediaReviewNote: c.mediaReviewNote,
        mediaApprovedAt: c.mediaApprovedAt,
        invoicePending: c.invoicePending,
        intakeType: c.intakeType,
        conditionFloor: c.conditionFloor,
        conditionRoof: c.conditionRoof,
        conditionDoors: c.conditionDoors,
        conditionPaint: c.conditionPaint,
        conditionWalls: c.conditionWalls,
        roofHole: c.roofHole,
        demo: c.demo,
        registeredByName: c.registeredByName || "—",
        createdAt: c.createdAt,
      };
    });
  }

  async get(iso: string) {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: { depot: true, photos: true },
    });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    if (c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    await this.evaluation.importLegacyForUnit(c.iso, c);
    const evalData = await this.evaluation.forUnit(c.iso);
    const active = c.photos.filter((p) => p.status === PHOTO_STATUS_ACTIVE);
    const history = c.photos
      .filter((p) => p.status === PHOTO_STATUS_REJECTED)
      .sort((a, b) => (b.rejectedAt || b.createdAt).getTime() - (a.rejectedAt || a.createdAt).getTime());
    return {
      iso: c.iso,
      type: c.type,
      cat: c.cat,
      status: c.status,
      depotName: c.depot.name,
      manufacturer: c.manufacturer,
      year: c.year,
      color: c.color,
      inspectionNotes: c.inspectionNotes,
      photoSlots: Array.from({ length: 9 }, (_, i) => !!active.find((p) => p.slot === i)),
      photos: [...active.map((p) => p.slot)].sort((a, b) => a - b),
      history: history.map((p) => ({
        id: p.id,
        slot: p.slot,
        label: PHOTO_LABELS[p.slot] || `Foto ${p.slot + 1}`,
        originalName: p.originalName,
        rejectedAt: p.rejectedAt,
        rejectedByName: p.rejectedByName,
        rejectNote: p.rejectNote,
        createdAt: p.createdAt,
      })),
      hasVideo: !!c.video360Key,
      mediaStatus: c.mediaStatus,
      mediaReviewNote: c.mediaReviewNote,
      mediaApprovedAt: c.mediaApprovedAt,
      mediaApprovedBy: c.mediaApprovedBy,
      updatedAt: c.updatedAt,
      photoLabels: PHOTO_LABELS,
      registeredByName: c.registeredByName || "—",
      createdAt: c.createdAt,
      conditionFloor: c.conditionFloor,
      conditionRoof: c.conditionRoof,
      conditionDoors: c.conditionDoors,
      conditionPaint: c.conditionPaint,
      conditionWalls: c.conditionWalls,
      roofHole: c.roofHole,
      ratings: evalData.ratings,
      ratingHistory: evalData.ratingHistory,
    };
  }

  async patchUnit(
    iso: string,
    body: {
      inspectionNotes?: string;
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
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    if (c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    const data: Prisma.ContainerUpdateInput = {};
    if (body.inspectionNotes !== undefined) data.inspectionNotes = body.inspectionNotes || "";
    for (const key of ["conditionFloor", "conditionRoof", "conditionDoors", "conditionPaint", "conditionWalls"] as const) {
      if (body[key] !== undefined) data[key] = parseCondition(body[key]) || null;
    }
    if (body.roofHole !== undefined) data.roofHole = body.roofHole == null ? null : !!body.roofHole;
    await this.prisma.container.update({ where: { iso }, data });
    await this.evaluation.syncLegacyFields(
      iso,
      {
        conditionFloor: body.conditionFloor,
        conditionRoof: body.conditionRoof,
        conditionDoors: body.conditionDoors,
        conditionPaint: body.conditionPaint,
        conditionWalls: body.conditionWalls,
      },
      user,
      ip,
      "catalogo",
    );
    await this.audit.log({
      user,
      action: "update",
      entity: "CatalogMedia",
      entityId: iso,
      after: data as object,
      ip,
    });
    return this.get(iso);
  }

  async setRating(
    iso: string,
    body: { conceptId?: string; levelId?: string; reason?: string; note?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c || c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    await this.evaluation.setRating(iso, { ...body, source: "catalogo" }, user, ip);
    return this.get(iso);
  }

  async putWatermark(file: { buffer: Buffer; originalname?: string } | undefined, user: AuthUser, ip?: string) {
    this.assertApprover(user);
    if (!file?.buffer?.length) throw new BadRequestException("Sube una imagen PNG o JPG para la marca de agua.");
    const key = "catalog/watermark.png";
    await this.storage.put(key, file.buffer, "image/png");
    await this.prisma.appSetting.upsert({
      where: { key: WATERMARK_KEY },
      update: { value: { storageKey: key, name: file.originalname || "watermark" } },
      create: { key: WATERMARK_KEY, value: { storageKey: key, name: file.originalname || "watermark" } },
    });
    const applied = await this.reapplyPublished();
    await this.audit.log({ user, action: "update", entity: "AppSetting", entityId: WATERMARK_KEY, after: { applied }, ip });
    return { ok: true, watermarkReady: true, watermarkSource: "custom", applied };
  }

  async resetWatermark(user: AuthUser, ip?: string) {
    this.assertApprover(user);
    await this.prisma.appSetting.deleteMany({ where: { key: WATERMARK_KEY } });
    const applied = await this.reapplyPublished();
    await this.audit.log({ user, action: "update", entity: "AppSetting", entityId: WATERMARK_KEY, after: { reset: true, applied }, ip });
    return { ok: true, watermarkReady: true, watermarkSource: "default", applied };
  }

  async openWatermark() {
    const custom = await this.customWatermarkKey();
    if (custom?.storageKey) {
      try {
        const obj = await this.storage.get(custom.storageKey);
        return { stream: obj.stream, contentType: obj.contentType || "image/png", contentLength: obj.contentLength };
      } catch {
        /* cae al predeterminado */
      }
    }
    const buf = await loadDefaultWatermark();
    if (!buf?.length) throw new NotFoundException("No hay marca de agua predeterminada.");
    return { stream: Readable.from(buf), contentType: "image/png", contentLength: buf.length };
  }

  async patchNotes(iso: string, inspectionNotes: string, user: AuthUser, ip?: string) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    if (c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    await this.prisma.container.update({
      where: { iso },
      data: { inspectionNotes: inspectionNotes || "" },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "CatalogMedia",
      entityId: iso,
      after: { inspectionNotes: inspectionNotes || "" },
      ip,
    });
    return this.get(iso);
  }

  async upload(iso: string, slot: string, file: Express.Multer.File | undefined, user: AuthUser, ip?: string) {
    await this.warehouse.uploadMedia(iso, slot, file, user, ip);
    return this.get(iso);
  }

  async openPhoto(iso: string, slot: string) {
    return this.warehouse.openPhoto(iso, slot);
  }

  async openHistoryPhoto(iso: string, id: string) {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id, iso, status: PHOTO_STATUS_REJECTED },
    });
    if (!photo) throw new NotFoundException("Foto de historial no encontrada.");
    return this.warehouse.openStoredPhoto(photo.storageKey, photo.mimeType);
  }

  async approve(iso: string, user: AuthUser, ip?: string) {
    this.assertApprover(user);
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: { photos: ACTIVE_PHOTOS },
    });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    if (c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    if (c.photos.length < 1) {
      throw new BadRequestException("Publica al menos una foto de inspección para el catálogo.");
    }
    await this.watermarkPublicCopies(c.iso, c.photos);
    await this.prisma.container.update({
      where: { iso },
      data: {
        mediaStatus: "aprobado",
        mediaApprovedBy: user.id,
        mediaApprovedAt: new Date(),
        mediaReviewNote: null,
      },
    });
    await this.prisma.containerHistory.create({
      data: { iso, type: "Catálogo", detail: `Ficha publicada en el catálogo por ${user.name}. Marca de agua aplicada a copias públicas.` },
    });
    await this.audit.log({ user, action: "approve_media", entity: "Container", entityId: iso, ip });
    return this.get(iso);
  }

  async hide(iso: string, user: AuthUser, ip?: string) {
    this.assertApprover(user);
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    if (c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    await this.prisma.container.update({
      where: { iso },
      data: {
        mediaStatus: "oculto",
        mediaApprovedAt: null,
        mediaApprovedBy: user.id,
        mediaReviewNote: null,
      },
    });
    await this.prisma.containerHistory.create({
      data: { iso, type: "Catálogo", detail: `Ficha oculta del catálogo por ${user.name}.` },
    });
    await this.audit.log({ user, action: "hide_media", entity: "Container", entityId: iso, ip });
    return this.get(iso);
  }

  async rejectPhoto(iso: string, slot: number, note: string, user: AuthUser, ip?: string) {
    this.assertApprover(user);
    if (!(note || "").trim()) throw new BadRequestException("Indica el motivo del rechazo de esta foto.");
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { iso, slot, status: PHOTO_STATUS_ACTIVE },
    });
    if (!photo) throw new NotFoundException("No hay foto activa en ese hueco.");
    await this.warehouse.archivePhoto(photo, user, note.trim());
    const remaining = await this.prisma.inspectionPhoto.count({
      where: { iso, status: PHOTO_STATUS_ACTIVE },
    });
    if (remaining < 1) {
      await this.prisma.container.update({
        where: { iso },
        data: { mediaStatus: "oculto", mediaApprovedAt: null, mediaApprovedBy: user.id },
      });
    }
    await this.prisma.containerHistory.create({
      data: {
        iso,
        type: "Catálogo",
        detail: `Foto ${slot + 1} (${PHOTO_LABELS[slot] || "slot"}) rechazada: ${note.trim()}`,
      },
    });
    await this.audit.log({
      user,
      action: "reject_photo",
      entity: "InspectionPhoto",
      entityId: photo.id,
      after: { iso, slot, note: note.trim() },
      ip,
    });
    return this.get(iso);
  }

  async restorePhoto(iso: string, id: string, user: AuthUser, ip?: string) {
    this.assertApprover(user);
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id, iso, status: PHOTO_STATUS_REJECTED },
    });
    if (!photo) throw new NotFoundException("Foto de historial no encontrada.");
    const occupied = await this.prisma.inspectionPhoto.findFirst({
      where: { iso, slot: photo.slot, status: PHOTO_STATUS_ACTIVE },
    });
    if (occupied) {
      throw new BadRequestException(
        `El hueco ${photo.slot + 1} ya tiene una foto activa. Recházala o cámbiala antes de restaurar.`,
      );
    }
    await this.prisma.inspectionPhoto.update({
      where: { id: photo.id },
      data: {
        status: PHOTO_STATUS_ACTIVE,
        rejectedAt: null,
        rejectedById: null,
        rejectedByName: null,
        rejectNote: null,
      },
    });
    await this.prisma.containerHistory.create({
      data: { iso, type: "Catálogo", detail: `Foto ${photo.slot + 1} restaurada desde el historial por ${user.name}.` },
    });
    await this.audit.log({ user, action: "restore_photo", entity: "InspectionPhoto", entityId: photo.id, after: { iso, slot: photo.slot }, ip });
    return this.get(iso);
  }

  private async customWatermarkKey() {
    const wm = await this.prisma.appSetting.findUnique({ where: { key: WATERMARK_KEY } });
    const value = wm?.value && typeof wm.value === "object" ? (wm.value as { storageKey?: string; name?: string }) : null;
    if (!value?.storageKey) return null;
    return { storageKey: value.storageKey, name: value.name || "watermark" };
  }

  private async getMarkBuffer() {
    const custom = await this.customWatermarkKey();
    if (custom?.storageKey) {
      try {
        const buf = await this.storage.getBuffer(custom.storageKey);
        if (buf.buffer?.length) return buf.buffer;
      } catch {
        /* usa zg_marca.png */
      }
    }
    return loadDefaultWatermark();
  }

  private async reapplyPublished() {
    const units = await this.prisma.container.findMany({
      where: { mediaStatus: "aprobado", archivedAt: null },
      include: { photos: ACTIVE_PHOTOS },
    });
    let applied = 0;
    for (const c of units) {
      if (!c.photos.length) continue;
      await this.watermarkPublicCopies(c.iso, c.photos);
      await this.prisma.container.update({
        where: { iso: c.iso },
        data: { mediaApprovedAt: new Date() },
      });
      applied += 1;
    }
    return applied;
  }

  private async watermarkPublicCopies(
    iso: string,
    photos: { id: string; slot: number; storageKey: string; mimeType: string }[],
  ) {
    const mark = await this.getMarkBuffer();
    for (const photo of photos) {
      try {
        const src = await this.storage.getBuffer(photo.storageKey);
        const out = await applyCatalogWatermark(src.buffer, mark);
        const publicKey = `public/${iso}/photos/${photo.slot}.jpg`;
        await this.storage.put(publicKey, out.buffer, out.mime);
        await this.prisma.inspectionPhoto.update({ where: { id: photo.id }, data: { publicKey } });
      } catch {
        /* si falla una foto, el resto sigue; el original no se toca */
      }
    }
  }

  async getOffer(iso: string, user: AuthUser) {
    this.assertApprover(user);
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c || c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    const [pricing, vis, refs] = await Promise.all([this.loadPricing(), this.loadVisibility(), this.loadAcquisitionRefs()]);
    let priceList = c.priceList != null ? Number(c.priceList) : null;
    let priceMin = c.priceMin != null ? Number(c.priceMin) : null;
    if (priceList == null || priceMin == null) {
      const computed = computeListPrices(
        { iso: c.iso, type: c.type, cat: c.cat, manufacturer: c.manufacturer, fobCif: Number(c.fobCif) },
        pricing,
        refs,
      );
      priceList = computed.priceList;
      priceMin = computed.priceMin;
      await this.prisma.container.update({
        where: { iso },
        data: { priceList, priceMin, priceSource: c.priceSource || "rule" },
      });
    }
    const offer = describeOffer(
      { iso: c.iso, type: c.type, cat: c.cat, manufacturer: c.manufacturer, fobCif: Number(c.fobCif), depotId: c.depotId, status: c.status },
      pricing,
      vis,
      {
        priceList,
        priceMin,
        priceSource: c.priceSource,
        showPriceOverride: c.showPriceOverride,
        adjustedByName: c.priceAdjustedByName,
        adjustedAt: c.priceAdjustedAt,
      },
      refs,
    );
    const history = await this.prisma.containerPriceChange.findMany({
      where: { iso },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return {
      ...offer,
      fobCif: Number(c.fobCif) || 0,
      history: history.map((h) => ({
        id: h.id,
        priceList: Number(h.priceList),
        priceMin: Number(h.priceMin),
        showPrice: h.showPrice,
        source: h.source,
        note: h.note,
        changedByName: h.changedByName,
        createdAt: h.createdAt,
      })),
    };
  }

  async setOffer(
    iso: string,
    body: {
      priceNet?: number | string;
      priceGross?: number | string;
      visibility?: OfferVisibilityMode | string;
      note?: string;
      recompute?: boolean;
    },
    user: AuthUser,
    ip?: string,
  ) {
    this.assertApprover(user);
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c || c.archivedAt) throw new NotFoundException("Unidad no encontrada.");
    const [pricing, vis, refs] = await Promise.all([this.loadPricing(), this.loadVisibility(), this.loadAcquisitionRefs()]);
    const unit = { iso: c.iso, type: c.type, cat: c.cat, manufacturer: c.manufacturer, fobCif: Number(c.fobCif) };
    const computed = computeListPrices(unit, pricing, refs);
    let priceList = computed.priceList;
    let priceMin = computed.priceMin;
    let source = "rule";
    if (!body.recompute) {
      const net = parseMoneyAmount(body.priceNet);
      if (net == null) throw new BadRequestException("Indica el precio neto de oferta (USD).");
      priceList = net;
      priceMin = Math.round(net * (1 - (computed.maxDiscountPct || 10) / 100));
      source = "manual";
    }
    const showPriceOverride = overrideFromVisibilityMode(body.visibility);
    const now = new Date();
    await this.prisma.container.update({
      where: { iso },
      data: {
        priceList,
        priceMin,
        priceSource: source,
        showPriceOverride,
        priceAdjustedAt: now,
        priceAdjustedByName: user.name,
      },
    });
    const described = describeOffer(
      { ...unit, depotId: c.depotId, status: c.status },
      pricing,
      vis,
      {
        priceList,
        priceMin,
        priceSource: source,
        showPriceOverride,
        adjustedByName: user.name,
        adjustedAt: now,
      },
      refs,
    );
    const note = (body.note || "").trim().slice(0, 240);
    await this.prisma.containerPriceChange.create({
      data: {
        iso,
        priceList,
        priceMin,
        showPrice: described.showPrice,
        source,
        note,
        changedById: user.id,
        changedByName: user.name,
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso,
        type: "Precio",
        detail: `${described.title}: neto $${priceList} / con IGV $${described.gross}. ${described.visibilityLabel}${note ? ` ${note}` : ""}`,
      },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "ContainerPrice",
      entityId: iso,
      after: { priceList, showPriceOverride, source, note },
      ip,
    });
    return this.getOffer(iso, user);
  }

  private async loadPricing(): Promise<PricingRule[]> {
    const rows = await this.prisma.pricingRule.findMany();
    if (!rows.length) return DEFAULT_PRICING_RULES;
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      target: r.target,
      marginPct: Number(r.marginPct),
      maxDiscountPct: Number(r.maxDiscountPct),
    }));
  }

  private async loadVisibility(): Promise<VisibilityRule[]> {
    const rows = await this.prisma.visibilityRule.findMany();
    if (!rows.length) return DEFAULT_VISIBILITY_RULES;
    return rows.map((r) => ({ id: r.id, scope: r.scope, target: r.target, show: r.show }));
  }

  private async loadAcquisitionRefs(): Promise<AcquisitionRef[]> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ACQUISITION_REFS_KEY } });
    return normalizeAcquisitionRefs(row?.value);
  }

  private assertApprover(user: AuthUser) {
    if (!MEDIA_APPROVER_ROLES.includes(user.role as (typeof MEDIA_APPROVER_ROLES)[number])) {
      throw new ForbiddenException("Solo Administrador o Gerencia pueden publicar, ocultar, rechazar fotos o fijar el precio de oferta.");
    }
  }
}

export function catalogMediaPublished(status: string | null | undefined) {
  return isMediaApproved(status);
}
