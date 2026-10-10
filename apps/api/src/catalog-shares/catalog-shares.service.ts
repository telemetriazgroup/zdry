import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser, COMMERCIAL_ROLES } from "../auth/auth.types";
import { OdooClient } from "../odoo/odoo.client";
import { CATALOG_COMMERCE_KEY, normalizeCatalogCommerce, whatsappDigits } from "../domain/catalog-commerce";
import {
  clientFromAgent,
  deviceFromAgent,
  grantMatchesSession,
  newShareAccessCode,
  newShareSession,
  newShareToken,
  normalizeShareDraft,
  planShareRenew,
  normalizeShareEvent,
  readShareGrant,
  shareCodeMatches,
  shareExpiresAt,
  shareIsLive,
  shareStatus,
  signShareGrant,
  summarizeShareEvents,
} from "../domain/catalog-share";
import { isValidPeruRuc, mapSunatRuc, normalizeRuc } from "../domain/ruc-sunat";

@Injectable()
export class CatalogSharesService {
  private readonly pinFails = new Map<string, { n: number; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly odoo: OdooClient,
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
    ruc: string;
    clientName: string;
    clientCompany: string;
    clientPhone: string;
    clientEmail: string;
    contactName: string;
    street: string;
    district: string;
    province: string;
    department: string;
    sunatState: string;
    sunatCondition: string;
    clientNote: string;
    accessCode: string;
    hours: number;
    expiresAt: Date;
    suspendedAt: Date | null;
    archivedAt?: Date | null;
    createdAt: Date;
    events?: Array<{ id: string; kind: string; iso: string | null; createdAt: Date; detail: Prisma.JsonValue | null; ip: string; device: string; userAgent?: string }>;
  }) {
    const status = shareStatus(row);
    const events = row.events || [];
    return {
      id: row.id,
      token: row.token,
      path: `/c/${row.token}`,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      vendorWhatsapp: row.vendorWhatsapp,
      ruc: row.ruc,
      clientName: row.clientName,
      clientCompany: row.clientCompany,
      clientPhone: row.clientPhone,
      clientEmail: row.clientEmail,
      contactName: row.contactName || row.clientName,
      street: row.street,
      district: row.district,
      province: row.province,
      department: row.department,
      sunatState: row.sunatState,
      sunatCondition: row.sunatCondition,
      clientNote: row.clientNote,
      accessCode: row.accessCode,
      hours: row.hours,
      expiresAt: row.expiresAt,
      suspendedAt: row.suspendedAt,
      archivedAt: row.archivedAt || null,
      createdAt: row.createdAt,
      live: status === "activo",
      status,
      metrics: summarizeShareEvents(events.map((e) => ({ ...e, createdAt: e.createdAt }))),
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        iso: e.iso,
        at: e.createdAt,
        detail: e.detail,
        ip: e.ip,
        device: e.device,
        client: clientFromAgent(e.userAgent || ""),
      })),
    };
  }

  private async withPrices<T extends { metrics: { units: Array<{ iso: string }> } }>(presented: T) {
    const isos = presented.metrics.units.map((unit) => unit.iso).filter(Boolean);
    if (!isos.length) return presented;
    const priced = await this.prisma.container.findMany({
      where: { iso: { in: isos } },
      select: { iso: true, type: true, cat: true, priceList: true },
    });
    const byIso = new Map(priced.map((row) => [row.iso, row]));
    return {
      ...presented,
      metrics: {
        ...presented.metrics,
        units: presented.metrics.units.map((unit) => {
          const row = byIso.get(unit.iso);
          return {
            ...unit,
            type: row?.type || "",
            cat: row?.cat || "",
            priceList: row?.priceList == null ? null : Number(row.priceList),
          };
        }),
      },
    };
  }

  async list(user: AuthUser, archived = false) {
    const mine = this.canSeeAll(user) ? {} : { vendorId: user.id };
    const where = { ...mine, archivedAt: archived ? { not: null } : null };
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
      include: { events: { orderBy: { createdAt: "desc" }, take: 1500 } },
    });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (!this.canSeeAll(user) && row.vendorId !== user.id) throw new ForbiddenException("Ese enlace no es tuyo.");
    return this.withPrices(this.present(row));
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
    const active = await this.prisma.catalogShare.findFirst({
      where: { ruc: draft.ruc, suspendedAt: null, archivedAt: null, expiresAt: { gt: now } },
    });
    if (active) {
      throw new BadRequestException("Este cliente ya tiene un enlace activo. Suspéndelo para crear otro.");
    }
    const row = await this.prisma.catalogShare.create({
      data: {
        token: newShareToken(),
        vendorId: user.id,
        vendorName: user.name,
        vendorWhatsapp: draft.vendorWhatsapp,
        ruc: draft.ruc,
        clientName: draft.clientName,
        clientCompany: draft.clientCompany,
        clientPhone: draft.clientPhone,
        clientEmail: draft.clientEmail,
        contactName: draft.contactName,
        street: draft.street,
        district: draft.district,
        province: draft.province,
        department: draft.department,
        sunatState: draft.sunatState,
        sunatCondition: draft.sunatCondition,
        customerId: draft.customerId,
        clientNote: draft.clientNote,
        accessCode: newShareAccessCode(),
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
    if (row.archivedAt) throw new BadRequestException("Este enlace fue archivado. Pide uno nuevo a tu comercial.");
    if (row.suspendedAt) {
      throw new BadRequestException("Este enlace fue suspendido. Pide uno nuevo a tu comercial.");
    }
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

  async unlock(token: string, code: unknown, res: Response) {
    const row = await this.prisma.catalogShare.findUnique({ where: { token: String(token || "").trim() } });
    if (!row) throw new NotFoundException("Ese enlace no existe.");
    if (row.archivedAt) throw new BadRequestException("Este enlace fue archivado. Pide uno nuevo a tu comercial.");
    if (row.suspendedAt) throw new BadRequestException("Este enlace fue suspendido. Pide uno nuevo a tu comercial.");
    if (!shareIsLive(row.expiresAt)) throw new BadRequestException("Este enlace del catálogo ya venció. Pide uno nuevo a tu comercial.");
    const fail = this.pinFails.get(row.token);
    if (fail && fail.until > Date.now()) {
      throw new BadRequestException("Demasiados intentos. Espera unos minutos y vuelve a escribir la clave.");
    }
    if (!row.accessCode || !shareCodeMatches(row.accessCode, code)) {
      const n = (fail?.n || 0) + 1;
      this.pinFails.set(row.token, { n, until: n >= 8 ? Date.now() + 15 * 60 * 1000 : 0 });
      throw new BadRequestException("Clave incorrecta.");
    }
    this.pinFails.delete(row.token);
    const sessionId = newShareSession();
    await this.prisma.catalogShare.update({ where: { id: row.id }, data: { activeSession: sessionId } });
    const left = new Date(row.expiresAt).getTime() - Date.now();
    res.cookie("zdry_catalog", signShareGrant(row.token, sessionId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: process.env.COOKIE_PATH || "/zdry",
      maxAge: Math.max(60_000, left),
    });
    return { ok: true, expiresAt: row.expiresAt };
  }

  async catalogGate(raw: unknown): Promise<"ok" | "moved" | "deny"> {
    const grant = readShareGrant(raw);
    if (!grant) return "deny";
    const row = await this.prisma.catalogShare.findUnique({ where: { token: grant.token } });
    if (!row || row.archivedAt || row.suspendedAt || !shareIsLive(row.expiresAt)) return "deny";
    return grantMatchesSession(raw, row.activeSession);
  }

  async cookieAllows(raw: unknown): Promise<boolean> {
    return (await this.catalogGate(raw)) === "ok";
  }

  async recordEvent(token: string, body: Record<string, unknown>, meta?: { ip?: string; userAgent?: string; cookie?: string }) {
    const row = await this.prisma.catalogShare.findUnique({ where: { token: String(token || "").trim() } });
    if (!row || row.archivedAt || row.suspendedAt || !shareIsLive(row.expiresAt)) return { ok: false };
    const gate = grantMatchesSession(meta?.cookie, row.activeSession);
    const ev = normalizeShareEvent(body);
    if (gate === "moved") return { ok: false, displaced: true };
    if (gate !== "ok" && ev.kind !== "open") return { ok: false };
    const userAgent = String(meta?.userAgent || "").slice(0, 400);
    await this.prisma.catalogShareEvent.create({
      data: {
        shareId: row.id,
        kind: ev.kind,
        iso: ev.iso,
        detail: ev.detail as Prisma.InputJsonValue,
        ip: String(meta?.ip || "").slice(0, 64),
        userAgent,
        device: deviceFromAgent(userAgent),
      },
    });
    return { ok: true };
  }

  async lookupRuc(rawRuc: string) {
    const ruc = normalizeRuc(rawRuc);
    if (!ruc || !isValidPeruRuc(ruc)) {
      throw new BadRequestException("Ingresa un RUC peruano de 11 dígitos.");
    }
    let mapped;
    try {
      const raw = (await this.odoo.callKw("res.partner", "zdry_lookup_sunat", [ruc])) as Record<string, unknown>;
      mapped = mapSunatRuc(raw, ruc);
    } catch (e) {
      throw new BadRequestException((e as Error).message || "No se pudo consultar SUNAT en Odoo.");
    }
    if (!mapped?.companyName) {
      throw new BadRequestException("SUNAT no devolvió la razón social de ese RUC.");
    }
    const contacts = await this.partnerContacts(ruc);
    const customer = await this.prisma.customer.findFirst({
      where: { rucDni: ruc },
      select: { id: true, email: true, phone: true, companyName: true },
    });
    const now = new Date();
    const active = await this.prisma.catalogShare.findFirst({
      where: { ruc, suspendedAt: null, archivedAt: null, expiresAt: { gt: now } },
      select: { id: true, clientName: true, expiresAt: true, vendorName: true },
    });
    const person = contacts[0];
    return {
      ruc,
      companyName: mapped.companyName,
      street: mapped.street,
      district: mapped.district,
      province: mapped.province,
      department: mapped.department,
      sunatState: mapped.sunatState,
      sunatCondition: mapped.sunatCondition,
      customerId: customer?.id || null,
      contactName: person?.name || "",
      contactPhone: person?.phone || customer?.phone || "",
      contactEmail: person?.email || customer?.email || "",
      contacts,
      activeShare: active
        ? { id: active.id, clientName: active.clientName, expiresAt: active.expiresAt, vendorName: active.vendorName }
        : null,
    };
  }

  private async partnerContacts(ruc: string) {
    try {
      const partners = await this.odoo.searchRead(
        "res.partner",
        ["|", ["vat", "=", ruc], ["vat", "ilike", ruc]],
        ["id", "name", "email", "phone", "mobile", "is_company"],
        { limit: 5 },
      );
      const company = partners.find((p) => p.is_company) || partners[0];
      if (!company?.id) return [];
      const children = await this.odoo.searchRead(
        "res.partner",
        [["parent_id", "=", Number(company.id)], ["is_company", "=", false]],
        ["id", "name", "email", "phone", "mobile", "function"],
        { limit: 12 },
      );
      const rows = (children.length ? children : [company]).map((row) => ({
        id: Number(row.id),
        name: row.is_company ? "" : String(row.name || ""),
        phone: String(row.mobile || row.phone || ""),
        email: String(row.email || ""),
        role: String(row.function || ""),
      }));
      return rows.filter((row) => row.name || row.phone || row.email);
    } catch {
      return [];
    }
  }

  async edit(id: string, body: Record<string, unknown>, user: AuthUser, ip?: string) {
    const row = await this.prisma.catalogShare.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (!this.canSeeAll(user) && row.vendorId !== user.id) throw new ForbiddenException("Ese enlace no es tuyo.");
    if (row.archivedAt) throw new BadRequestException("Un enlace archivado no se edita.");
    const contactName = String(body.contactName || "").trim().slice(0, 120);
    if (contactName.length < 2) throw new BadRequestException("Indica el nombre de la persona que verá el catálogo.");
    const clientEmail = String(body.clientEmail || "").trim().toLowerCase().slice(0, 160);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw new BadRequestException("Indica el correo de la persona de contacto.");
    const clientPhone = whatsappDigits(body.clientPhone).slice(0, 20);
    if (clientPhone.length < 7) throw new BadRequestException("Indica el teléfono de la persona de contacto.");
    const vendorWhatsapp = whatsappDigits(body.vendorWhatsapp);
    if (vendorWhatsapp.length < 9) throw new BadRequestException("Indica el WhatsApp del comercial (mínimo 9 dígitos).");
    const clientNote = String(body.clientNote || "").trim().slice(0, 300);
    const updated = await this.prisma.catalogShare.update({
      where: { id },
      data: { contactName, clientName: contactName, clientPhone, clientEmail, clientNote, vendorWhatsapp },
    });
    await this.audit.log({
      user,
      action: "edit",
      entity: "CatalogShare",
      entityId: id,
      after: { contactName, clientPhone, clientEmail },
      ip,
    });
    return this.present({ ...updated, events: [] });
  }

  async suspend(id: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.catalogShare.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (!this.canSeeAll(user) && row.vendorId !== user.id) throw new ForbiddenException("Ese enlace no es tuyo.");
    if (row.suspendedAt) return this.present({ ...row, events: [] });
    const updated = await this.prisma.catalogShare.update({
      where: { id },
      data: { suspendedAt: new Date() },
    });
    await this.audit.log({
      user,
      action: "suspend",
      entity: "CatalogShare",
      entityId: id,
      after: { ruc: row.ruc, clientCompany: row.clientCompany },
      ip,
    });
    return this.present({ ...updated, events: [] });
  }

  async renew(id: string, hours: unknown, user: AuthUser, ip?: string) {
    const row = await this.prisma.catalogShare.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (!this.canSeeAll(user) && row.vendorId !== user.id) throw new ForbiddenException("Ese enlace no es tuyo.");
    let plan;
    try {
      plan = planShareRenew(row, hours);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (plan.mode === "reactivate") {
      const other = await this.prisma.catalogShare.findFirst({
        where: {
          id: { not: row.id },
          ruc: row.ruc,
          suspendedAt: null,
          archivedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (row.ruc && other) {
        throw new BadRequestException("Este cliente ya tiene un enlace activo. Suspéndelo o archívalo antes de reactivar este.");
      }
    }
    const updated = await this.prisma.catalogShare.update({
      where: { id },
      data: {
        hours: plan.hours,
        expiresAt: plan.expiresAt,
        ...(plan.mode === "reactivate" ? { activeSession: "" } : {}),
      },
    });
    await this.audit.log({
      user,
      action: plan.mode,
      entity: "CatalogShare",
      entityId: id,
      after: { expiresAt: plan.expiresAt, hours: plan.hours },
      ip,
    });
    return this.present({ ...updated, events: [] });
  }

  async archive(id: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.catalogShare.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (!this.canSeeAll(user) && row.vendorId !== user.id) throw new ForbiddenException("Ese enlace no es tuyo.");
    if (row.archivedAt) return this.present({ ...row, events: [] });
    const updated = await this.prisma.catalogShare.update({
      where: { id },
      data: { archivedAt: new Date(), activeSession: "" },
    });
    await this.audit.log({
      user,
      action: "archive",
      entity: "CatalogShare",
      entityId: id,
      after: { ruc: row.ruc, clientCompany: row.clientCompany },
      ip,
    });
    return this.present({ ...updated, events: [] });
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
