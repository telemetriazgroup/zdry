import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { WarehouseService } from "../warehouse/warehouse.service";
import { AuthUser } from "../auth/auth.types";
import { PHOTO_LABELS } from "../domain/yard";
import {
  MEDIA_APPROVER_ROLES,
  PHOTO_STATUS_ACTIVE,
  PHOTO_STATUS_REJECTED,
  isMediaApproved,
} from "../domain/catalog-media";

const ACTIVE_PHOTOS = { where: { status: PHOTO_STATUS_ACTIVE } };

@Injectable()
export class CatalogMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouse: WarehouseService,
  ) {}

  meta() {
    return { photoLabels: PHOTO_LABELS, approverRoles: MEDIA_APPROVER_ROLES };
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
    };
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
      data: { iso, type: "Catálogo", detail: `Ficha publicada en el catálogo por ${user.name}.` },
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

  private assertApprover(user: AuthUser) {
    if (!MEDIA_APPROVER_ROLES.includes(user.role as (typeof MEDIA_APPROVER_ROLES)[number])) {
      throw new ForbiddenException("Solo Administrador o Gerencia pueden publicar, ocultar o rechazar fotos.");
    }
  }
}

export function catalogMediaPublished(status: string | null | undefined) {
  return isMediaApproved(status);
}
