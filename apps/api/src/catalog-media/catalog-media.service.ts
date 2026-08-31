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
import { MEDIA_APPROVER_ROLES, isMediaApproved } from "../domain/catalog-media";

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
        intakeType: "compra",
        physicallyReceived: true,
        status: { in: ["Disponible", "Reservado"] },
      },
      include: { depot: true, photos: { select: { slot: true } } },
      orderBy: { iso: "asc" },
    });
    return rows.map((c) => ({
      iso: c.iso,
      type: c.type,
      cat: c.cat,
      status: c.status,
      depotName: c.depot.name,
      manufacturer: c.manufacturer,
      year: c.year,
      photoCount: c.photos.length,
      hasVideo: !!c.video360Key,
      inspectionNotes: c.inspectionNotes,
      mediaStatus: c.mediaStatus,
      mediaReviewNote: c.mediaReviewNote,
      mediaApprovedAt: c.mediaApprovedAt,
    }));
  }

  async get(iso: string) {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: { depot: true, photos: { select: { slot: true } } },
    });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
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
      photoSlots: Array.from({ length: 9 }, (_, i) => !!c.photos.find((p) => p.slot === i)),
      photos: [...c.photos.map((p) => p.slot)].sort((a, b) => a - b),
      hasVideo: !!c.video360Key,
      mediaStatus: c.mediaStatus,
      mediaReviewNote: c.mediaReviewNote,
      mediaApprovedAt: c.mediaApprovedAt,
      mediaApprovedBy: c.mediaApprovedBy,
      updatedAt: c.updatedAt,
      photoLabels: PHOTO_LABELS,
    };
  }

  async patchNotes(iso: string, inspectionNotes: string, user: AuthUser, ip?: string) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    await this.prisma.container.update({
      where: { iso },
      data: {
        inspectionNotes: inspectionNotes || "",
        mediaStatus: "pendiente",
        mediaApprovedAt: null,
        mediaApprovedBy: null,
      },
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

  async approve(iso: string, user: AuthUser, ip?: string) {
    this.assertApprover(user);
    const c = await this.prisma.container.findUnique({ where: { iso }, include: { photos: true } });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
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
      data: { iso, type: "Catálogo", detail: `Ficha multimedia aprobada para el catálogo por ${user.name}.` },
    });
    await this.audit.log({ user, action: "approve_media", entity: "Container", entityId: iso, ip });
    return this.get(iso);
  }

  async reject(iso: string, note: string, user: AuthUser, ip?: string) {
    this.assertApprover(user);
    if (!(note || "").trim()) throw new BadRequestException("Indica el motivo del rechazo.");
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    await this.prisma.container.update({
      where: { iso },
      data: {
        mediaStatus: "rechazado",
        mediaApprovedBy: user.id,
        mediaApprovedAt: new Date(),
        mediaReviewNote: note.trim(),
      },
    });
    await this.prisma.containerHistory.create({
      data: { iso, type: "Catálogo", detail: `Ficha multimedia rechazada: ${note.trim()}` },
    });
    await this.audit.log({ user, action: "reject_media", entity: "Container", entityId: iso, after: { note }, ip });
    return this.get(iso);
  }

  private assertApprover(user: AuthUser) {
    if (!MEDIA_APPROVER_ROLES.includes(user.role as (typeof MEDIA_APPROVER_ROLES)[number])) {
      throw new ForbiddenException("Solo Administrador o Gerencia pueden publicar o rechazar la ficha del catálogo.");
    }
  }
}

export function catalogMediaPublished(status: string | null | undefined) {
  return isMediaApproved(status);
}
