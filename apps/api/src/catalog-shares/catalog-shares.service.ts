import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser, COMMERCIAL_ROLES } from "../auth/auth.types";
import { OdooClient } from "../odoo/odoo.client";
import { SalidaService } from "../salida/salida.service";
import { salidaQueued, shareNoticePack, vendorReturnNotice } from "../domain/salida";
import { CATALOG_COMMERCE_KEY, normalizeCatalogCommerce, whatsappDigits } from "../domain/catalog-commerce";
import {
  clientFromAgent,
  deviceFromAgent,
  grantMatchesSession,
  newShareAccessCode,
  newShareSession,
  newShareToken,
  normalizeDni,
  normalizeShareDraft,
  normalizeWalkIn,
  planShareRenew,
  normalizeShareEvent,
  readShareGrant,
  shareCodeMatches,
  shareExpiresAt,
  shareExpiresAtExact,
  shareIsLive,
  walkInExtendUntil,
  shareStatus,
  signShareGrant,
  summarizeShareEvents,
} from "../domain/catalog-share";
import { isValidPeruRuc, mapSunatRuc, normalizeRuc } from "../domain/ruc-sunat";

@Injectable()
export class CatalogSharesService {
  private readonly pinFails = new Map<string, { n: number; until: number }>();
  private readonly walkInHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly odoo: OdooClient,
    private readonly salida: SalidaService,
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
    return user.role === "superadmin" || user.role === "admin" || user.role === "gerente" || user.role === "ejecutivo";
  }

  private present(row: {
    id: string;
    token: string;
    vendorId: string;
    vendorName: string;
    vendorWhatsapp: string;
    docKind?: string;
    source?: string;
    ruc: string;
    dni?: string;
    rucPending?: boolean;
    odooPartnerId?: number | null;
    odooContactId?: number | null;
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
      docKind: row.docKind === "dni" ? "dni" : "ruc",
      source: row.source === "cliente" ? "cliente" : "comercial",
      ruc: row.ruc,
      dni: row.dni || "",
      rucPending: Boolean(row.rucPending),
      odooPartnerId: row.odooPartnerId || null,
      odooContactId: row.odooContactId || null,
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
    if (archived && user.role !== "superadmin") throw new ForbiddenException("Solo el superadmin ve los enlaces archivados.");
    const mine = this.canSeeAll(user) ? {} : { vendorId: user.id };
    const where = { ...mine, archivedAt: archived ? { not: null } : null };
    const rows = await this.prisma.catalogShare.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 400,
      include: { events: { orderBy: { createdAt: "desc" }, take: 8 } },
    });
    return rows.map((r) => this.present(r));
  }

  async vendorChoices() {
    return this.prisma.user.findMany({
      where: { role: "vendedor", active: true, ...(await this.prisma.hideDemo()) },
      select: { id: true, name: true, whatsapp: true },
      orderBy: { name: "asc" },
    });
  }

  async report(user: AuthUser, archived = false) {
    if (archived && user.role !== "superadmin") throw new ForbiddenException("Solo el superadmin ve los enlaces archivados.");
    const mine = this.canSeeAll(user) ? {} : { vendorId: user.id };
    const rows = await this.prisma.catalogShare.findMany({
      where: { ...mine, archivedAt: archived ? { not: null } : null },
      orderBy: { createdAt: "desc" },
      take: 400,
      include: { events: { orderBy: { createdAt: "desc" }, take: 120 } },
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

  async create(body: Record<string, unknown>, user: AuthUser, ip?: string, origin?: string) {
    if (!COMMERCIAL_ROLES.includes(user.role)) {
      throw new ForbiddenException("Solo un comercial puede generar el enlace del catálogo.");
    }
    let draft;
    try {
      draft = normalizeShareDraft({
        ...body,
        vendorWhatsapp: body.vendorWhatsapp || (user.role === "vendedor" ? user.whatsapp : ""),
      });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const now = new Date();
    const active = await this.prisma.catalogShare.findFirst({
      where: draft.docKind === "dni"
        ? { dni: draft.dni, suspendedAt: null, archivedAt: null, expiresAt: { gt: now } }
        : { ruc: draft.ruc, suspendedAt: null, archivedAt: null, expiresAt: { gt: now } },
    });
    if (active) {
      throw new BadRequestException("Este cliente ya tiene un enlace activo. Suspéndelo para crear otro.");
    }
    const assignee = await this.resolveAssignee(user, body.vendorId);
    const linked = await this.ensureSharePartner(draft);
    const vendorWhatsapp = draft.vendorWhatsapp || whatsappDigits(assignee.whatsapp);
    const row = await this.prisma.catalogShare.create({
      data: {
        token: newShareToken(),
        vendorId: assignee.id,
        vendorName: assignee.name,
        vendorWhatsapp,
        docKind: draft.docKind,
        source: "comercial",
        ruc: draft.ruc,
        dni: draft.dni,
        rucPending: draft.rucPending,
        odooPartnerId: linked.partnerId,
        odooContactId: linked.contactId,
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
    if (vendorWhatsapp && vendorWhatsapp !== whatsappDigits(assignee.whatsapp)) {
      await this.prisma.user.update({ where: { id: assignee.id }, data: { whatsapp: vendorWhatsapp } });
    }
    const card = this.noticeCard(row, Boolean(draft.odooPartnerId || draft.customerId), origin);
    const notice = await this.salida.notifyShare(card);
    await this.audit.log({
      user,
      action: "create",
      entity: "CatalogShare",
      entityId: row.id,
      after: { clientName: row.clientName, hours: row.hours, salida: { channel: notice.channel, whatsapp: notice.whatsapp, correo: notice.correo } },
      ip,
    });
    return { ...this.present({ ...row, events: [] }), salida: notice, invite: shareNoticePack(card).whatsapp };
  }

  private noticeCard(row: {
    contactName: string;
    clientName: string;
    clientCompany: string;
    ruc: string;
    dni: string;
    street: string;
    district: string;
    province: string;
    department: string;
    clientEmail: string;
    clientPhone: string;
    vendorName: string;
    vendorWhatsapp: string;
    token: string;
    accessCode: string;
    hours: number;
  }, known: boolean, origin?: string) {
    return {
      known,
      name: row.contactName || row.clientName,
      company: row.clientCompany,
      ruc: row.ruc,
      dni: row.dni,
      address: [row.street, row.district, row.province, row.department].filter(Boolean).join(", "),
      email: row.clientEmail,
      phone: row.clientPhone,
      vendorName: row.vendorName,
      vendorPhone: row.vendorWhatsapp,
      url: this.shareLink(origin, row.token),
      code: row.accessCode,
      hours: row.hours,
    };
  }

  private shareLink(origin: string | undefined, token: string) {
    const base = String(origin || "").replace(/\/$/, "");
    const root = (process.env.COOKIE_PATH || "/zdry").replace(/\/$/, "");
    return `${base}${root}/c/${token}`;
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

  private guardWalkIn(ip?: string) {
    const key = String(ip || "local").slice(0, 64);
    const now = Date.now();
    const prev = (this.walkInHits.get(key) || []).filter((at) => now - at < 10 * 60 * 1000);
    if (prev.length >= 30) throw new BadRequestException("Demasiados intentos. Espera unos minutos.");
    prev.push(now);
    this.walkInHits.set(key, prev);
  }

  private publicCompanyView(found: {
    ruc: string;
    inOdoo: boolean;
    companyName: string;
    street: string;
    district: string;
    province: string;
    department: string;
    activeShare: { id: string; vendorName?: string; vendorWhatsapp?: string } | null;
  }) {
    const busy = Boolean(found.activeShare);
    return {
      ruc: found.ruc,
      known: found.inOdoo,
      greeting: found.inOdoo ? "Zgroup te saluda nuevamente." : "Zgroup te da la bienvenida.",
      companyName: found.companyName,
      street: found.street,
      district: found.district,
      province: found.province,
      department: found.department,
      busy,
      vendorName: busy ? found.activeShare?.vendorName || "" : "",
      vendorWhatsapp: busy ? found.activeShare?.vendorWhatsapp || "" : "",
    };
  }

  /** Consulta el RUC para portería. Devuelve la empresa, sin contactos ni correos de Odoo. */
  async publicLookupRuc(rawRuc: string, ip?: string, origin?: string) {
    this.guardWalkIn(ip);
    const found = await this.lookupRuc(rawRuc);
    const view = this.publicCompanyView(found);
    if (view.busy) return view;
    const again = await this.resolveWalkInReturn({ ruc: found.ruc }, origin, ip);
    if (!again) return view;
    if (again.busy) return { ...view, busy: true, vendorName: again.vendorName, vendorWhatsapp: again.vendorWhatsapp };
    return { ...view, busy: false, ...again };
  }

  async publicRegister(body: Record<string, unknown>, ip?: string, origin?: string) {
    this.guardWalkIn(ip);
    let draft;
    try {
      draft = normalizeWalkIn(body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const byDocument = draft.docKind === "ruc"
      ? await this.resolveWalkInReturn({ ruc: draft.ruc }, origin, ip)
      : await this.resolveWalkInReturn({ dni: draft.dni }, origin, ip);
    if (byDocument?.busy) {
      throw new BadRequestException({
        message: draft.docKind === "ruc" ? "Esta empresa ya tiene un enlace de catálogo." : "Este DNI ya tiene un enlace de catálogo.",
        busy: true,
        vendorName: byDocument.vendorName,
        vendorWhatsapp: byDocument.vendorWhatsapp,
      });
    }
    if (byDocument?.renewed) return byDocument;
    if (draft.docKind === "ruc" && draft.dni) {
      const byDni = await this.resolveWalkInReturn({ dni: draft.dni }, origin, ip);
      if (byDni?.busy) {
        throw new BadRequestException({
          message: "Este DNI ya tiene un enlace de catálogo.",
          busy: true,
          vendorName: byDni.vendorName,
          vendorWhatsapp: byDni.vendorWhatsapp,
        });
      }
      if (byDni?.renewed) return byDni;
    }
    const company = draft.docKind === "ruc" ? await this.lookupRuc(draft.ruc) : null;
    if (company?.activeShare) {
      throw new BadRequestException({
        message: "Esta empresa ya tiene un enlace de catálogo.",
        busy: true,
        vendorName: company.activeShare.vendorName,
        vendorWhatsapp: company.activeShare.vendorWhatsapp,
      });
    }
    const vendor = await this.assignWalkInVendor();
    const linked = await this.ensureSharePartner({
      docKind: draft.docKind,
      ruc: draft.ruc,
      dni: draft.dni,
      clientCompany: company?.companyName || draft.contactName,
      contactName: draft.contactName,
      clientEmail: draft.clientEmail,
      clientPhone: draft.clientPhone,
      street: company?.street || "",
      district: company?.district || "",
      province: company?.province || "",
      department: company?.department || "",
      sunatState: company?.sunatState || "",
      sunatCondition: company?.sunatCondition || "",
      odooPartnerId: null,
      odooContactId: null,
      contactDni: draft.docKind === "ruc" ? draft.dni : "",
    });
    const now = new Date();
    const row = await this.prisma.catalogShare.create({
      data: {
        token: newShareToken(),
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorWhatsapp: whatsappDigits(vendor.whatsapp),
        docKind: draft.docKind,
        source: "cliente",
        ruc: draft.ruc,
        dni: draft.dni,
        rucPending: draft.docKind === "dni",
        odooPartnerId: linked.partnerId,
        odooContactId: linked.contactId,
        clientName: draft.contactName,
        clientCompany: company?.companyName || draft.contactName,
        clientPhone: draft.clientPhone,
        clientEmail: draft.clientEmail,
        contactName: draft.contactName,
        street: company?.street || "",
        district: company?.district || "",
        province: company?.province || "",
        department: company?.department || "",
        sunatState: company?.sunatState || "",
        sunatCondition: company?.sunatCondition || "",
        customerId: company?.customerId || null,
        clientNote: "Registro en portería",
        accessCode: newShareAccessCode(),
        hours: draft.hours,
        expiresAt: shareExpiresAtExact(now, draft.hours),
      },
    });
    const known = Boolean(company?.inOdoo);
    const notice = await this.salida.notifyShare(this.noticeCard(row, known, origin));
    await this.audit.log({
      action: "create",
      entity: "CatalogShare",
      entityId: row.id,
      after: { source: "cliente", hours: row.hours, docKind: row.docKind, vendorId: vendor.id, salida: { channel: notice.channel, whatsapp: notice.whatsapp, correo: notice.correo } },
      ip,
    });
    return {
      token: row.token,
      path: `/c/${row.token}`,
      accessCode: row.accessCode,
      hours: row.hours,
      expiresAt: row.expiresAt,
      clientCompany: row.clientCompany,
      contactName: row.contactName,
      vendorName: row.vendorName,
      greeting: company ? (company.inOdoo ? "Zgroup te saluda nuevamente." : "Zgroup te da la bienvenida.") : "Zgroup te da la bienvenida.",
      salida: notice,
    };
  }

  private async assignWalkInVendor() {
    const vendors = await this.prisma.user.findMany({
      where: { role: "vendedor", active: true },
      select: { id: true, name: true, whatsapp: true },
      orderBy: { name: "asc" },
    });
    if (!vendors.length) {
      throw new BadRequestException("No hay un comercial disponible para atenderte. Avisa en portería.");
    }
    const counts = await this.prisma.catalogShare.groupBy({
      by: ["vendorId"],
      where: { source: "cliente", vendorId: { in: vendors.map((row) => row.id) } },
      _count: { _all: true },
    });
    const load = new Map(counts.map((row) => [row.vendorId, row._count._all]));
    vendors.sort((a, b) => (load.get(a.id) || 0) - (load.get(b.id) || 0) || a.name.localeCompare(b.name, "es"));
    return vendors[0];
  }

  async lookupRuc(rawRuc: string) {
    const ruc = normalizeRuc(rawRuc);
    if (!ruc || !isValidPeruRuc(ruc)) {
      throw new BadRequestException("Ingresa un RUC peruano de 11 dígitos.");
    }
    const company = await this.findCompany(ruc);
    const customer = await this.prisma.customer.findFirst({
      where: { rucDni: ruc },
      select: { id: true, email: true, phone: true, companyName: true },
    });
    const activeShare = await this.activeShareFor({ ruc });
    if (company) {
      const contacts = await this.childContacts(Number(company.id));
      const person = contacts[0];
      const address = this.addressOf(company);
      return {
        docKind: "ruc" as const,
        ruc,
        inOdoo: true,
        odooPartnerId: Number(company.id),
        odooContactId: person?.id || null,
        companyName: String(company.name || customer?.companyName || ""),
        ...address,
        sunatState: "",
        sunatCondition: "",
        customerId: customer?.id || null,
        contactName: person?.name || "",
        contactPhone: person?.phone || customer?.phone || "",
        contactEmail: person?.email || customer?.email || "",
        contacts,
        activeShare,
      };
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
    return {
      docKind: "ruc" as const,
      ruc,
      inOdoo: false,
      odooPartnerId: null,
      odooContactId: null,
      companyName: mapped.companyName,
      street: mapped.street,
      district: mapped.district,
      province: mapped.province,
      department: mapped.department,
      sunatState: mapped.sunatState,
      sunatCondition: mapped.sunatCondition,
      customerId: customer?.id || null,
      contactName: "",
      contactPhone: customer?.phone || "",
      contactEmail: customer?.email || "",
      contacts: [],
      activeShare,
    };
  }

  async lookupDni(rawDni: string) {
    const dni = normalizeDni(rawDni);
    if (!dni) throw new BadRequestException("Ingresa un DNI de 8 dígitos.");
    const people = (await this.partnersByDocument(dni)).filter((row) => !row.is_company);
    const person = people[0];
    const activeShare = await this.activeShareFor({ dni });
    if (!person) {
      return {
        docKind: "dni" as const,
        dni,
        inOdoo: false,
        rucPending: true,
        odooPartnerId: null,
        odooContactId: null,
        companyName: "",
        contactName: "",
        firstName: "",
        lastName: "",
        contactPhone: "",
        contactEmail: "",
        contacts: [],
        activeShare,
      };
    }
    const name = String(person.name || "").trim();
    const [firstName, ...rest] = name.split(/\s+/);
    const contact = this.mapContact(person);
    return {
      docKind: "dni" as const,
      dni,
      inOdoo: true,
      rucPending: true,
      odooPartnerId: Number(person.id),
      odooContactId: Number(person.id),
      companyName: name,
      contactName: name,
      firstName: firstName || "",
      lastName: rest.join(" "),
      contactPhone: contact.phone,
      contactEmail: contact.email,
      contacts: contact.name || contact.phone || contact.email ? [contact] : [],
      activeShare,
    };
  }

  async addRuc(id: string, rawRuc: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.catalogShare.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (!this.canSeeAll(user) && row.vendorId !== user.id) throw new ForbiddenException("Ese enlace no es tuyo.");
    if (row.archivedAt) throw new BadRequestException("Un enlace archivado no se edita.");
    if (!row.rucPending && row.ruc) throw new BadRequestException("Este enlace ya tiene RUC.");
    const ruc = normalizeRuc(rawRuc);
    if (!ruc || !isValidPeruRuc(ruc)) throw new BadRequestException("Ingresa un RUC peruano de 11 dígitos.");
    const taken = await this.activeShareFor({ ruc });
    if (taken && taken.id !== row.id) {
      throw new BadRequestException("Ese RUC ya tiene un enlace activo.");
    }
    const found = await this.lookupRuc(ruc);
    const partnerId = await this.attachRucCompany(found, row.odooPartnerId);
    const updated = await this.prisma.catalogShare.update({
      where: { id },
      data: {
        docKind: "ruc",
        ruc,
        rucPending: false,
        clientCompany: found.companyName || row.clientCompany,
        street: found.street || row.street,
        district: found.district || row.district,
        province: found.province || row.province,
        department: found.department || row.department,
        sunatState: found.sunatState || row.sunatState,
        sunatCondition: found.sunatCondition || row.sunatCondition,
        odooPartnerId: partnerId || row.odooPartnerId,
      },
    });
    await this.audit.log({
      user,
      action: "add_ruc",
      entity: "CatalogShare",
      entityId: id,
      after: { ruc, odooPartnerId: partnerId },
      ip,
    });
    return this.present({ ...updated, events: [] });
  }

  private async activeShareFor(where: { ruc?: string; dni?: string }) {
    const now = new Date();
    return this.prisma.catalogShare.findFirst({
      where: { ...where, suspendedAt: null, archivedAt: null, expiresAt: { gt: now } },
      select: { id: true, clientName: true, expiresAt: true, vendorName: true, vendorWhatsapp: true },
    });
  }

  private documentFilter(where: { ruc?: string; dni?: string }) {
    if (where.ruc) return { ruc: where.ruc };
    if (where.dni) return { dni: where.dni };
    return null;
  }

  /** Enlace vencido más reciente de ese RUC o DNI. No toca suspendidos ni archivados. */
  private async latestExpiredShare(where: { ruc?: string; dni?: string }) {
    const filter = this.documentFilter(where);
    if (!filter) return null;
    return this.prisma.catalogShare.findFirst({
      where: { ...filter, suspendedAt: null, archivedAt: null, expiresAt: { lte: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Vigente: ya tiene enlace. Vencido: 30 minutos más, reenvío al cliente y aviso al comercial. */
  private async resolveWalkInReturn(where: { ruc?: string; dni?: string }, origin?: string, ip?: string) {
    const filter = this.documentFilter(where);
    if (!filter) return null;
    const live = await this.activeShareFor(filter);
    if (live) return { busy: true as const, vendorName: live.vendorName || "", vendorWhatsapp: live.vendorWhatsapp || "" };
    const expired = await this.latestExpiredShare(filter);
    if (!expired) return null;
    return this.reopenShare(expired, origin, ip);
  }

  private async reopenShare(share: {
    id: string;
    token: string;
    accessCode: string;
    hours: number;
    vendorId: string;
    vendorName: string;
    vendorWhatsapp: string;
    contactName: string;
    clientName: string;
    clientCompany: string;
    ruc: string;
    dni: string;
    street: string;
    district: string;
    province: string;
    department: string;
    clientEmail: string;
    clientPhone: string;
  }, origin?: string, ip?: string) {
    const expiresAt = walkInExtendUntil();
    const updated = await this.prisma.catalogShare.updateMany({
      where: { id: share.id, suspendedAt: null, archivedAt: null, expiresAt: { lte: new Date() } },
      data: { expiresAt },
    });
    if (!updated.count) {
      const current = await this.prisma.catalogShare.findUnique({
        where: { id: share.id },
        select: { expiresAt: true, vendorName: true, vendorWhatsapp: true, suspendedAt: true, archivedAt: true },
      });
      if (current && !current.suspendedAt && !current.archivedAt && shareIsLive(current.expiresAt)) {
        return { busy: true as const, vendorName: current.vendorName || "", vendorWhatsapp: current.vendorWhatsapp || "" };
      }
      throw new BadRequestException("No se pudo reabrir el enlace. Intenta de nuevo.");
    }
    await this.prisma.catalogShareEvent.create({
      data: {
        shareId: share.id,
        kind: "return",
        detail: { minutes: 30 },
        ip: String(ip || "").slice(0, 64),
      },
    });
    const notice = await this.salida.notifyShare({ ...this.noticeCard({ ...share, hours: share.hours }, true, origin), minutes: 30 });
    const vendor = await this.prisma.user.findUnique({
      where: { id: share.vendorId },
      select: { email: true, name: true, whatsapp: true },
    });
    const vendorPhone = whatsappDigits(share.vendorWhatsapp || vendor?.whatsapp || "");
    const clientPhone = whatsappDigits(share.clientPhone);
    const alert = vendorReturnNotice({
      vendorName: vendor?.name || share.vendorName,
      clientName: share.contactName || share.clientName,
      company: share.clientCompany,
      ruc: share.ruc,
      dni: share.dni,
    });
    await this.salida.notifyText({
      phone: vendorPhone,
      email: vendor?.email || "",
      contact: clientPhone.length >= 8 ? clientPhone : vendorPhone,
      subject: alert.subject,
      message: alert.message,
    });
    await this.audit.log({
      action: "reopen",
      entity: "CatalogShare",
      entityId: share.id,
      after: { minutes: 30, salida: { channel: notice.channel, whatsapp: notice.whatsapp, correo: notice.correo } },
      ip,
    });
    const delivered = salidaQueued(notice.whatsapp) || salidaQueued(notice.correo);
    return {
      renewed: true as const,
      minutes: 30,
      greeting: "Zgroup te saluda nuevamente.",
      clientCompany: share.clientCompany,
      contactName: share.contactName || share.clientName,
      vendorName: share.vendorName,
      vendorWhatsapp: share.vendorWhatsapp,
      salida: notice,
      message: delivered
        ? "Ya tenías un enlace. Había vencido y te abrimos 30 minutos más. Revisa el correo y el WhatsApp con los que te registraste."
        : "Ya tenías un enlace. Había vencido y te abrimos 30 minutos más.",
      ...(delivered ? {} : { token: share.token, path: `/c/${share.token}`, accessCode: share.accessCode }),
    };
  }

  private vatDigits(value: unknown) {
    return String(value || "").replace(/\D/g, "");
  }

  private async partnersByDocument(doc: string) {
    try {
      const rows = await this.odoo.searchRead(
        "res.partner",
        ["|", ["vat", "=", doc], ["vat", "ilike", doc]],
        ["id", "name", "vat", "is_company", "parent_id", "email", "phone", "mobile", "street", "street2", "city", "state_id", "function"],
        { limit: 20 },
      );
      return rows.filter((row) => this.vatDigits(row.vat) === doc);
    } catch {
      return [];
    }
  }

  private async findCompany(ruc: string) {
    const rows = await this.partnersByDocument(ruc);
    return rows.find((row) => row.is_company) || null;
  }

  private addressOf(partner: Record<string, unknown>) {
    const state = Array.isArray(partner.state_id) ? String(partner.state_id[1] || "") : "";
    return {
      street: String(partner.street || ""),
      district: String(partner.city || ""),
      province: String(partner.street2 || ""),
      department: state,
    };
  }

  private mapContact(row: Record<string, unknown>) {
    return {
      id: Number(row.id),
      name: row.is_company ? "" : String(row.name || ""),
      phone: String(row.mobile || row.phone || ""),
      email: String(row.email || ""),
      role: String(row.function || ""),
    };
  }

  private async childByDni(companyId: number, dni: string) {
    try {
      const rows = await this.odoo.searchRead(
        "res.partner",
        [["parent_id", "=", companyId], ["is_company", "=", false]],
        ["id", "vat"],
        { limit: 40 },
      );
      const hit = rows.find((row) => this.vatDigits(row.vat) === dni);
      return hit?.id ? Number(hit.id) : null;
    } catch {
      return null;
    }
  }

  private async childContacts(companyId: number) {
    try {
      const children = await this.odoo.searchRead(
        "res.partner",
        [["parent_id", "=", companyId], ["is_company", "=", false]],
        ["id", "name", "email", "phone", "mobile", "function"],
        { limit: 12 },
      );
      return children.map((row) => this.mapContact(row)).filter((row) => row.name || row.phone || row.email);
    } catch {
      return [];
    }
  }

  private async peIdentity() {
    const types = await this.odoo.searchRead(
      "l10n_latam.identification.type",
      [],
      ["id", "name", "l10n_pe_vat_code"],
      { limit: 40 },
    );
    const byCode = (code: string, name: string) =>
      types.find((row) => String(row.l10n_pe_vat_code || "") === code)
      || types.find((row) => String(row.name || "").toUpperCase() === name);
    const countries = await this.odoo.searchRead("res.country", [["code", "=", "PE"]], ["id"], { limit: 1 });
    return {
      rucTypeId: Number(byCode("6", "RUC")?.id) || null,
      dniTypeId: Number(byCode("1", "DNI")?.id) || null,
      countryId: Number(countries[0]?.id) || null,
    };
  }

  /** El correo va solo al contacto. Si la empresa ya lo tiene, Odoo rechaza el alta del contacto. */
  private async releaseCompanyEmail(partnerId: number, company: { email?: unknown } | null, contactEmail: string) {
    const held = String(company?.email || "").trim().toLowerCase();
    const next = contactEmail.trim().toLowerCase();
    if (!partnerId || !held || held !== next) return;
    await this.odoo.write("res.partner", [partnerId], { email: false });
  }

  private async createPartner(values: Record<string, unknown>) {
    try {
      return Number(await this.odoo.create("res.partner", values));
    } catch (e) {
      const msg = (e as Error).message || "";
      if (!/taxpayer_state|taxpayer_condition|Invalid field/i.test(msg)) {
        throw new BadRequestException(msg || "No se pudo crear el contacto en Odoo.");
      }
      const next = { ...values };
      delete next.taxpayer_state;
      delete next.taxpayer_condition;
      return Number(await this.odoo.create("res.partner", next));
    }
  }

  private async ensureSharePartner(draft: {
    docKind: "ruc" | "dni";
    ruc: string;
    dni: string;
    clientCompany: string;
    contactName: string;
    clientEmail: string;
    clientPhone: string;
    street: string;
    district: string;
    province: string;
    department: string;
    sunatState: string;
    sunatCondition: string;
    odooPartnerId: number | null;
    odooContactId: number | null;
    contactDni?: string;
  }) {
    if (draft.docKind === "dni") return this.ensureDniPartner(draft);
    return this.ensureRucPartner(draft);
  }

  private async ensureRucPartner(draft: {
    ruc: string;
    clientCompany: string;
    contactName: string;
    clientEmail: string;
    clientPhone: string;
    street: string;
    district: string;
    province: string;
    department: string;
    sunatState: string;
    sunatCondition: string;
    odooContactId: number | null;
    contactDni?: string;
  }) {
    const ids = await this.peIdentity();
    let company = await this.findCompany(draft.ruc);
    let partnerId = company ? Number(company.id) : 0;
    if (!partnerId) {
      const values: Record<string, unknown> = {
        name: draft.clientCompany,
        vat: draft.ruc,
        is_company: true,
        company_type: "company",
        customer_rank: 1,
        phone: draft.clientPhone || false,
        street: draft.street || false,
        street2: [draft.district, draft.province, draft.department].filter(Boolean).join(" - ") || false,
        city: draft.district || false,
      };
      if (ids.rucTypeId) values.l10n_latam_identification_type_id = ids.rucTypeId;
      if (ids.countryId) values.country_id = ids.countryId;
      if (draft.sunatState) values.taxpayer_state = draft.sunatState;
      if (draft.sunatCondition) values.taxpayer_condition = draft.sunatCondition;
      partnerId = await this.createPartner(values);
      if (!partnerId) throw new BadRequestException("Odoo no creó la empresa.");
    }
    const contacts = await this.childContacts(partnerId);
    const chosen = draft.odooContactId
      ? contacts.find((row) => row.id === draft.odooContactId)
      : null;
    if (chosen) return { partnerId, contactId: chosen.id };
    const byDni = draft.contactDni ? await this.childByDni(partnerId, draft.contactDni) : null;
    if (byDni) return { partnerId, contactId: byDni };
    await this.releaseCompanyEmail(partnerId, company, draft.clientEmail);
    const child: Record<string, unknown> = {
      name: draft.contactName,
      parent_id: partnerId,
      type: "contact",
      company_type: "person",
      is_company: false,
      email: draft.clientEmail || false,
      phone: draft.clientPhone || false,
      mobile: draft.clientPhone || false,
    };
    if (draft.contactDni) {
      child.vat = draft.contactDni;
      if (ids.dniTypeId) child.l10n_latam_identification_type_id = ids.dniTypeId;
    }
    const contactId = await this.createPartner(child);
    return { partnerId, contactId: contactId || null };
  }

  private async ensureDniPartner(draft: {
    dni: string;
    contactName: string;
    clientEmail: string;
    clientPhone: string;
    odooPartnerId: number | null;
  }) {
    const ids = await this.peIdentity();
    const people = (await this.partnersByDocument(draft.dni)).filter((row) => !row.is_company);
    const existing = people.find((row) => Number(row.id) === draft.odooPartnerId) || people[0];
    if (existing?.id) {
      const id = Number(existing.id);
      return { partnerId: id, contactId: id };
    }
    const values: Record<string, unknown> = {
      name: draft.contactName,
      vat: draft.dni,
      is_company: false,
      company_type: "person",
      customer_rank: 1,
      email: draft.clientEmail || false,
      phone: draft.clientPhone || false,
      mobile: draft.clientPhone || false,
    };
    if (ids.dniTypeId) values.l10n_latam_identification_type_id = ids.dniTypeId;
    if (ids.countryId) values.country_id = ids.countryId;
    const partnerId = await this.createPartner(values);
    if (!partnerId) throw new BadRequestException("Odoo no creó el contacto con DNI.");
    return { partnerId, contactId: partnerId };
  }

  private async attachRucCompany(
    found: { inOdoo: boolean; odooPartnerId: number | null; companyName: string; street: string; district: string; province: string; department: string; sunatState: string; sunatCondition: string; ruc: string },
    personId: number | null,
  ) {
    let companyId = found.inOdoo ? found.odooPartnerId : null;
    if (!companyId) {
      const ids = await this.peIdentity();
      const values: Record<string, unknown> = {
        name: found.companyName,
        vat: found.ruc,
        is_company: true,
        company_type: "company",
        customer_rank: 1,
        street: found.street || false,
        city: found.district || false,
        street2: [found.district, found.province, found.department].filter(Boolean).join(" - ") || false,
      };
      if (ids.rucTypeId) values.l10n_latam_identification_type_id = ids.rucTypeId;
      if (ids.countryId) values.country_id = ids.countryId;
      if (found.sunatState) values.taxpayer_state = found.sunatState;
      if (found.sunatCondition) values.taxpayer_condition = found.sunatCondition;
      companyId = await this.createPartner(values);
    }
    if (personId && companyId && personId !== companyId) {
      try {
        const rows = await this.odoo.read("res.partner", [personId], ["parent_id", "is_company"]);
        const parent = rows[0]?.parent_id;
        const hasParent = Array.isArray(parent) ? Boolean(parent[0]) : Boolean(parent);
        if (!rows[0]?.is_company && !hasParent) {
          await this.odoo.write("res.partner", [personId], { parent_id: companyId });
        }
      } catch {
        /* el RUC queda en el enlace aunque el contacto ya tenga empresa */
      }
    }
    return companyId;
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

  private async resolveAssignee(user: AuthUser, vendorId: unknown) {
    if (user.role === "vendedor") return { id: user.id, name: user.name, whatsapp: user.whatsapp || "" };
    if (user.role !== "admin" && user.role !== "superadmin" && user.role !== "ejecutivo") {
      throw new ForbiddenException("Solo un comercial puede generar el enlace del catálogo.");
    }
    const id = String(vendorId || "").trim();
    if (!id) throw new BadRequestException("Elige el comercial que hará el seguimiento.");
    const vendor = await this.prisma.user.findFirst({
      where: { id, role: "vendedor", active: true },
      select: { id: true, name: true, whatsapp: true },
    });
    if (!vendor) throw new BadRequestException("Ese comercial no está disponible.");
    return vendor;
  }

  async archive(id: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.catalogShare.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Enlace no encontrado.");
    if (user.role !== "superadmin") throw new ForbiddenException("Solo el superadmin puede archivar un enlace.");
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
