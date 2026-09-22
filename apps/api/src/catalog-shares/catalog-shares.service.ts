import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser, COMMERCIAL_ROLES } from "../auth/auth.types";
import { CATALOG_COMMERCE_KEY, normalizeCatalogCommerce, whatsappDigits } from "../domain/catalog-commerce";
import {
  newShareToken,
  normalizeShareDraft,
  normalizeShareEvent,
  shareExpiresAt,
  shareIsLive,
} from "../domain/catalog-share";

@Injectable()
export class CatalogSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async commerce() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CATALOG_COMMERCE_KEY } });
    return normalizeCatalogCommerce(row?.value);
  }

  async saveCommerce(body: Record<string, unknown>, user: AuthUser, ip?: string) {
    const value = normalizeCatalogCommerce(body);
    await this.prisma.appSetting.upsert({
      where: { key: CATALOG_COMMERCE_KEY },
      update: { value: value as object },
      create: { key: CATALOG_COMMERCE_KEY, value: value as object },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "AppSetting",
      entityId: CATALOG_COMMERCE_KEY,
      after: value as object,
      ip,
    });
    return value;
  }

  private canSeeAll(user: AuthUser) {
    return user.role === "superadmin" || user.role === "admin" || user.role === "gerente";
  }

  private present(row: {
    id: string;
    token: string;
    vendorId: string;
    vendorName: string;
    vendorWhatsapp: string;
    clientName: string;
    clientCompany: string;
    clientPhone: string;
    clientNote: string;
    hours: number;
    expiresAt: Date;
    createdAt: Date;
    events?: Array<{ id: string; kind: string; iso: string | null; createdAt: Date; detail: Prisma.JsonValue | null }>;
  }) {
    const live = shareIsLive(row.expiresAt);
    return {
      id: row.id,
      token: row.token,
      path: `/c/${row.token}`,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      vendorWhatsapp: row.vendorWhatsapp,
      clientName: row.clientName,
      clientCompany: row.clientCompany,
      clientPhone: row.clientPhone,
      clientNote: row.clientNote,
      hours: row.hours,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      live,
      events: (row.events || []).map((e) => ({
        id: e.id,
        kind: e.kind,
        iso: e.iso,
        at: e.createdAt,
        detail: e.detail,
      })),
    };
  }

  async list(user: AuthUser) {
    const where = this.canSeeAll(user) ? {} : { vendorId: user.id };
    const rows = await this.prisma.catalogShare.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { events: { orderBy: { createdAt: "desc" }, take: 8 } },
    });
    return rows.map((r) => this.present(r));
  }

  async getOne(id: string, user: AuthUser) {
    const row = await this.prisma.catalogShare.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: "desc" }, take: 200 } },
    });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (!this.canSeeAll(user) && row.vendorId !== user.id) throw new ForbiddenException("Ese enlace no es tuyo.");
    return this.present(row);
  }

  async create(body: Record<string, unknown>, user: AuthUser, ip?: string) {
    if (!COMMERCIAL_ROLES.includes(user.role)) {
      throw new ForbiddenException("Solo un comercial puede generar el enlace del catálogo.");
    }
    let draft;
    try {
      draft = normalizeShareDraft({
        ...body,
        vendorWhatsapp: body.vendorWhatsapp || user.whatsapp,
      });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const now = new Date();
    const row = await this.prisma.catalogShare.create({
      data: {
        token: newShareToken(),
        vendorId: user.id,
        vendorName: user.name,
        vendorWhatsapp: draft.vendorWhatsapp,
        clientName: draft.clientName,
        clientCompany: draft.clientCompany,
        clientPhone: draft.clientPhone,
        clientNote: draft.clientNote,
        hours: draft.hours,
        expiresAt: shareExpiresAt(now, draft.hours),
      },
    });
    if (draft.vendorWhatsapp && draft.vendorWhatsapp !== user.whatsapp) {
      await this.prisma.user.update({ where: { id: user.id }, data: { whatsapp: draft.vendorWhatsapp } });
    }
    await this.audit.log({
      user,
      action: "create",
      entity: "CatalogShare",
      entityId: row.id,
      after: { clientName: row.clientName, hours: row.hours },
      ip,
    });
    return this.present({ ...row, events: [] });
  }

  async publicByToken(token: string) {
    const row = await this.prisma.catalogShare.findUnique({ where: { token: String(token || "").trim() } });
    if (!row) throw new NotFoundException("Ese enlace no existe.");
    if (!shareIsLive(row.expiresAt)) {
      throw new BadRequestException("Este enlace del catálogo ya venció. Pide uno nuevo a tu comercial.");
    }
    return {
      token: row.token,
      clientName: row.clientName,
      vendorName: row.vendorName,
      vendorWhatsapp: row.vendorWhatsapp,
      hours: row.hours,
      expiresAt: row.expiresAt,
      live: true,
    };
  }

  async recordEvent(token: string, body: Record<string, unknown>) {
    const row = await this.prisma.catalogShare.findUnique({ where: { token: String(token || "").trim() } });
    if (!row || !shareIsLive(row.expiresAt)) return { ok: false };
    const ev = normalizeShareEvent(body);
    await this.prisma.catalogShareEvent.create({
      data: {
        shareId: row.id,
        kind: ev.kind,
        iso: ev.iso,
        detail: ev.detail as Prisma.InputJsonValue,
      },
    });
    return { ok: true };
  }

  async effectiveWhatsapp(shareToken?: string) {
    const commerce = await this.commerce();
    if (shareToken) {
      try {
        const share = await this.publicByToken(shareToken);
        return {
          commerce,
          share,
          whatsapp: share.vendorWhatsapp || commerce.whatsapp,
          coordinatorName: share.vendorName || commerce.coordinatorName,
        };
      } catch {
        /* fall through */
      }
    }
    return { commerce, share: null, whatsapp: commerce.whatsapp, coordinatorName: commerce.coordinatorName };
  }
}

export function digitsOrEmpty(value: unknown): string {
  return whatsappDigits(value);
}
