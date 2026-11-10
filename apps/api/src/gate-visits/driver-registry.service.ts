import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { SalidaService } from "../salida/salida.service";
import { whatsappDigits } from "../domain/catalog-commerce";
import { visitPhotoStatus } from "../domain/gate-visit";
import {
  CONFIRM_TEMPLATE_KEY,
  DEFAULT_CONFIRM_TEMPLATE,
  DEFAULT_LOCATION_TEMPLATE,
  ImportedRegistration,
  LIMA_EMAILS,
  LIMA_WAREHOUSES,
  LOCATION_TEMPLATE_KEY,
  SEED_MOTIVES,
  fillTemplate,
  formatPublicCode,
  htmlSalidaUrl,
  isLiveStatus,
  motiveForMessage,
  equipmentIsoWarning,
  readXlsxSheets,
  registrationRows,
  registryNotice,
  validatePublicInput,
  PublicInput,
} from "../domain/driver-registry";

type VisitRow = Prisma.GateVisitGetPayload<object>;

function manages(role: string) {
  return role === "admin" || role === "superadmin" || role === "coordinador";
}

@Injectable()
export class DriverRegistryService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly salida: SalidaService,
  ) {}

  async onModuleInit() {
    await this.ensureMasters().catch(() => undefined);
  }

  async ensureMasters() {
    for (const [index, motive] of SEED_MOTIVES.entries()) {
      await this.prisma.visitMotive.upsert({
        where: { name: motive.name },
        update: {},
        create: { name: motive.name, asksDetail: motive.asksDetail, sortOrder: index + 1 },
      });
    }
    await this.ensureSite("Lima", 1, LIMA_EMAILS, LIMA_WAREHOUSES);
    await this.ensureSite("Piura", 2, [], []);
    await this.ensureTemplate(CONFIRM_TEMPLATE_KEY, DEFAULT_CONFIRM_TEMPLATE);
    await this.ensureTemplate(LOCATION_TEMPLATE_KEY, DEFAULT_LOCATION_TEMPLATE);
  }

  private async ensureSite(
    name: string,
    sortOrder: number,
    emails: string[],
    warehouses: Array<{ name: string; mapUrl: string }>,
  ) {
    const existing = await this.prisma.visitSite.findUnique({ where: { name } });
    if (existing) return existing;
    return this.prisma.visitSite.create({
      data: {
        name,
        sortOrder,
        recipients: { create: emails.map((destination) => ({ kind: "correo", destination, label: destination })) },
        warehouses: { create: warehouses.map((item, index) => ({ ...item, sortOrder: index + 1 })) },
      },
    });
  }

  private async ensureTemplate(key: string, value: string) {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    if (row) return;
    await this.prisma.appSetting.create({ data: { key, value } });
  }

  async catalog(staff = false) {
    await this.ensureMasters();
    const [sites, motives, confirm, location] = await Promise.all([
      this.prisma.visitSite.findMany({
        where: staff ? {} : { active: true },
        orderBy: { sortOrder: "asc" },
        include: staff
          ? { recipients: { orderBy: { createdAt: "asc" } }, warehouses: { orderBy: { sortOrder: "asc" } } }
          : { warehouses: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
      }),
      this.prisma.visitMotive.findMany({
        where: staff ? {} : { active: true },
        orderBy: { sortOrder: "asc" },
      }),
      this.template(CONFIRM_TEMPLATE_KEY, DEFAULT_CONFIRM_TEMPLATE),
      this.template(LOCATION_TEMPLATE_KEY, DEFAULT_LOCATION_TEMPLATE),
    ]);
    return { sites, motives, confirmTemplate: confirm, locationTemplate: location };
  }

  async publicOptions() {
    const data = await this.catalog(false);
    return {
      sites: data.sites.map((site) => ({ id: site.id, name: site.name })),
      motives: data.motives.map((motive) => ({ id: motive.id, name: motive.name, asksDetail: motive.asksDetail })),
    };
  }

  private async template(key: string, fallback: string) {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const value = typeof row?.value === "string" ? row.value : "";
    return value.trim() || fallback;
  }

  async nextCode(from = new Date()) {
    for (let step = 0; step < 30; step += 1) {
      const code = formatPublicCode(new Date(from.getTime() + step * 1000));
      const taken = await this.prisma.gateVisit.findUnique({ where: { publicCode: code }, select: { id: true } });
      if (!taken) return code;
    }
    throw new BadRequestException("No se pudo asignar el código de registro. Inténtalo de nuevo.");
  }

  async resolvePublic(input: PublicInput) {
    const parsed = validatePublicInput(input);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const site = await this.prisma.visitSite.findFirst({ where: { id: parsed.value.siteId, active: true } });
    if (!site) throw new BadRequestException("Selecciona una sede.");
    const motive = await this.prisma.visitMotive.findFirst({ where: { id: parsed.value.motiveId, active: true } });
    if (!motive) throw new BadRequestException("Selecciona el motivo de visita.");
    if (motive.asksDetail && parsed.value.motiveDetail.length < 3) {
      throw new BadRequestException("Si el motivo es Otros, escribe el detalle.");
    }
    return { ...parsed.value, siteName: site.name, motive: motive.name };
  }

  async notifyRegistration(id: string) {
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit || visit.notifiedAt) return;
    try {
      await this.sendInternal(visit);
    } catch (e) {
      await this.prisma.visitNotice.create({
        data: {
          visitId: id,
          channel: "interno",
          audience: "interno",
          destination: visit.siteName || "sede",
          kind: "registro",
          status: "error",
          detail: String((e as Error).message || "No se pudo avisar.").slice(0, 300),
        },
      }).catch(() => undefined);
    }
    await this.prisma.gateVisit.update({ where: { id }, data: { notifiedAt: new Date() } });
  }

  private noticeInput(visit: VisitRow) {
    return registryNotice({
      site: visit.siteName || "Lima",
      motive: motiveForMessage(visit.motive, visit.motiveDetail),
      when: visit.visitAt || visit.createdAt,
      tractorPlate: visit.tractorPlate,
      trailerPlate: visit.trailerPlate,
      driverName: visit.driverName,
      company: visit.company,
      ruc: visit.ruc,
      license: visit.license,
      phone: visit.phone,
      equipmentCode: visit.equipmentCode || "",
      status: visit.status,
      observations: visit.observations,
      publicCode: visit.publicCode || "",
    });
  }

  private async sendInternal(visit: VisitRow) {
    if (!visit.siteId) return;
    const site = await this.prisma.visitSite.findUnique({
      where: { id: visit.siteId },
      include: { recipients: { where: { active: true } } },
    });
    if (!site) return;
    const pack = this.noticeInput(visit);
    const emails = site.recipients.filter((item) => item.kind === "correo");
    const phones = site.recipients.filter((item) => item.kind === "whatsapp");
    if (!emails.length && !phones.length) {
      await this.prisma.visitNotice.create({
        data: {
          visitId: visit.id,
          channel: "interno",
          audience: "interno",
          destination: site.name,
          kind: "registro",
          status: "omitido",
          detail: "Esta sede no tiene avisos configurados.",
        },
      });
      return;
    }
    const cfg = await this.salida.read();
    if (phones.length) await this.sendWhatsapps(visit, phones.map((item) => item.destination), site.replyPhone, pack.whatsapp, "registro", "interno", cfg);
    if (emails.length) await this.sendMails(visit, emails.map((item) => item.destination), pack, "registro", "interno", cfg);
  }

  private async sendWhatsapps(
    visit: VisitRow,
    phones: string[],
    replyPhone: string,
    message: string,
    kind: string,
    audience: string,
    cfg: { url: string; clave: string },
  ) {
    const contacto = whatsappDigits(replyPhone);
    const items = phones.map((phone) => ({ destination: phone, telefono: whatsappDigits(phone) }));
    if (contacto.length < 8 || contacto.length > 15) {
      await this.storeResults(visit.id, items.map((item) => ({
        channel: "whatsapp",
        audience,
        destination: item.destination,
        kind,
        status: "omitido",
        detail: "Falta el número de respuesta de la sede.",
      })));
      return;
    }
    if (!cfg.clave) {
      await this.storeResults(visit.id, items.map((item) => ({
        channel: "whatsapp",
        audience,
        destination: item.destination,
        kind,
        status: "error",
        detail: "Falta la clave de salida.",
      })));
      return;
    }
    const body = {
      whatsapp: items.map((item) => ({ telefono: item.telefono, mensaje: message, contacto })),
    };
    const result = await this.postSalida(cfg.url, cfg.clave, body);
    await this.storeResults(visit.id, items.map((item, index) => ({
      channel: "whatsapp",
      audience,
      destination: item.destination,
      kind,
      status: result.states[index] || result.status,
      detail: result.details[index] || result.detail,
    })));
  }

  private async sendMails(
    visit: VisitRow,
    emails: string[],
    pack: { subject: string; text: string; html: string },
    kind: string,
    audience: string,
    cfg: { url: string; clave: string },
  ) {
    if (!cfg.clave) {
      await this.storeResults(visit.id, emails.map((destination) => ({
        channel: "correo",
        audience,
        destination,
        kind,
        status: "pendiente_html",
        detail: "Falta la clave de salida.",
      })));
      return;
    }
    const body = {
      correo: emails.map((direccion) => ({
        direccion,
        asunto: pack.subject,
        cuerpo: pack.text,
        html: pack.html,
      })),
    };
    const result = await this.postSalida(htmlSalidaUrl(cfg.url), cfg.clave, body);
    const pending = result.status === "error" && /404|no se pudo|respondió 404/i.test(result.detail);
    await this.storeResults(visit.id, emails.map((destination, index) => ({
      channel: "correo",
      audience,
      destination,
      kind,
      status: pending ? "pendiente_html" : (result.states[index] || result.status),
      detail: pending ? "La ruta de correo HTML todavía no está publicada." : (result.details[index] || result.detail),
    })));
  }

  private async storeResults(visitId: string, rows: Array<{
    channel: string;
    audience: string;
    destination: string;
    kind: string;
    status: string;
    detail: string;
  }>) {
    if (!rows.length) return;
    await this.prisma.visitNotice.createMany({ data: rows.map((row) => ({ visitId, ...row, detail: row.detail.slice(0, 300) })) });
  }

  private async postSalida(url: string, clave: string, body: Record<string, unknown>) {
    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json", "x-salida-clave": clave },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (res.status === 404) return { status: "error", detail: "La salida respondió 404.", states: [] as string[], details: [] as string[] };
      if (res.status === 401) return { status: "error", detail: "La clave de salida no fue aceptada.", states: [], details: [] };
      const list = (Array.isArray(data.whatsapp) ? data.whatsapp : Array.isArray(data.correos) ? data.correos : []) as Array<Record<string, unknown>>;
      if (!res.ok && res.status !== 400) {
        return { status: "error", detail: `La salida respondió ${res.status}.`, states: [], details: [] };
      }
      return {
        status: "en_cola",
        detail: "",
        states: list.map((item) => String(item.estado || "error")),
        details: list.map((item) => String(item.motivo || "")),
      };
    } catch {
      return { status: "error", detail: "No se pudo conectar con la salida.", states: [] as string[], details: [] as string[] };
    }
  }

  async retryNotice(visitId: string, noticeId: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const notice = await this.prisma.visitNotice.findFirst({ where: { id: noticeId, visitId } });
    if (!notice) throw new NotFoundException("Aviso no encontrado.");
    if (notice.audience === "conductor" && notice.kind === "ubicacion") {
      throw new BadRequestException("Vuelve a enviar la ubicación desde la ficha.");
    }
    const visit = await this.prisma.gateVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException("Ingreso no encontrado.");
    const site = visit.siteId ? await this.prisma.visitSite.findUnique({ where: { id: visit.siteId } }) : null;
    const cfg = await this.salida.read();
    if (notice.channel === "correo") {
      const pack = this.noticeInput(visit);
      await this.sendMails(visit, [notice.destination], pack, notice.kind, notice.audience, cfg);
    } else if (notice.channel === "whatsapp") {
      const text = notice.audience === "conductor"
        ? await this.driverText(visit, "confirmacion", "")
        : this.noticeInput(visit).whatsapp;
      await this.sendWhatsapps(visit, [notice.destination], site?.replyPhone || "", text, notice.kind, notice.audience, cfg);
    }
    await this.audit.log({ user, action: "retry_notice", entity: "VisitNotice", entityId: noticeId, ip });
    return this.detail(visitId);
  }

  private async driverText(visit: VisitRow, kind: string, warehouseId: string) {
    if (kind === "ubicacion") {
      const warehouse = await this.prisma.visitWarehouse.findFirst({ where: { id: warehouseId, active: true } });
      if (!warehouse) throw new BadRequestException("Elige un almacén.");
      const template = await this.template(LOCATION_TEMPLATE_KEY, DEFAULT_LOCATION_TEMPLATE);
      return fillTemplate(template, {
        conductor: visit.driverName,
        motivo: motiveForMessage(visit.motive, visit.motiveDetail).toUpperCase(),
        almacen: warehouse.name.toUpperCase(),
        mapa: warehouse.mapUrl,
      });
    }
    const template = await this.template(CONFIRM_TEMPLATE_KEY, DEFAULT_CONFIRM_TEMPLATE);
    return fillTemplate(template, {
      conductor: visit.driverName,
      motivo: motiveForMessage(visit.motive, visit.motiveDetail).toUpperCase(),
    });
  }

  async sendDriver(id: string, kind: "confirmacion" | "ubicacion", warehouseId: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Ingreso no encontrado.");
    const site = visit.siteId ? await this.prisma.visitSite.findUnique({ where: { id: visit.siteId } }) : null;
    const message = await this.driverText(visit, kind, warehouseId);
    const cfg = await this.salida.read();
    await this.sendWhatsapps(visit, [visit.phone], site?.replyPhone || "", message, kind, "conductor", cfg);
    await this.audit.log({ user, action: "driver_notice", entity: "GateVisit", entityId: id, after: { kind }, ip });
    return this.detail(id);
  }

  async changeStatus(id: string, statusRaw: string, sendConfirm: boolean, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const status = String(statusRaw || "").trim().toUpperCase().replace("EN ATENCIÓN", "EN ATENCION");
    if (!isLiveStatus(status)) throw new BadRequestException("Elige un estado del ingreso.");
    const visit = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException("Ingreso no encontrado.");
    if (visit.status !== status) {
      await this.prisma.gateVisit.update({ where: { id }, data: { status } });
      await this.prisma.visitStatusEvent.create({
        data: { visitId: id, fromStatus: visit.status, toStatus: status, byId: user.id, byName: user.name },
      });
      await this.audit.log({
        user,
        action: "visit_status",
        entity: "GateVisit",
        entityId: id,
        after: { from: visit.status, to: status },
        ip,
      });
    }
    if (sendConfirm && status === "EN ATENCION") await this.sendDriver(id, "confirmacion", "", user, ip);
    return this.detail(id);
  }

  async detail(id: string) {
    const visit = await this.prisma.gateVisit.findUnique({
      where: { id },
      include: {
        notices: { orderBy: { createdAt: "desc" }, take: 40 },
        statusEvents: { orderBy: { createdAt: "desc" }, take: 20 },
        site: { include: { warehouses: { where: { active: true }, orderBy: { sortOrder: "asc" } } } },
      },
    });
    if (!visit) throw new NotFoundException("Ingreso no encontrado.");
    const photoStatus = visitPhotoStatus(visit);
    return {
      ...visit,
      unitPhotoKey: undefined,
      unitPhotoMime: undefined,
      photoStatus,
      hasPhoto: photoStatus === "visible",
      photoArchived: photoStatus === "archived",
      isoWarning: equipmentIsoWarning(visit.equipmentCode || ""),
      locked: visit.status !== "REGISTRADO" || !!visit.archivedAt,
      warehouses: visit.site?.warehouses || [],
    };
  }

  async saveTemplate(key: "confirm" | "location", value: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const text = String(value || "").trim();
    if (text.length < 8 || text.length > 2000) throw new BadRequestException("La plantilla tiene que tener un texto.");
    const setting = key === "confirm" ? CONFIRM_TEMPLATE_KEY : LOCATION_TEMPLATE_KEY;
    await this.prisma.appSetting.upsert({
      where: { key: setting },
      update: { value: text },
      create: { key: setting, value: text },
    });
    await this.audit.log({ user, action: "update", entity: "AppSetting", entityId: setting, ip });
    return { ok: true, value: text };
  }

  async addSite(name: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const clean = String(name || "").trim().slice(0, 80);
    if (clean.length < 2) throw new BadRequestException("Indica el nombre de la sede.");
    const row = await this.prisma.visitSite.create({ data: { name: clean, sortOrder: 100 } });
    await this.audit.log({ user, action: "create", entity: "VisitSite", entityId: row.id, after: { name: clean }, ip });
    return row;
  }

  async patchSite(id: string, body: { active?: boolean; replyPhone?: string }, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const data: Prisma.VisitSiteUpdateInput = {};
    if (typeof body.active === "boolean") data.active = body.active;
    if (body.replyPhone != null) data.replyPhone = whatsappDigits(body.replyPhone).slice(0, 15);
    const row = await this.prisma.visitSite.update({ where: { id }, data });
    await this.audit.log({ user, action: "update", entity: "VisitSite", entityId: id, ip });
    return row;
  }

  async addMotive(name: string, asksDetail: boolean, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const clean = String(name || "").trim().slice(0, 80);
    if (clean.length < 2) throw new BadRequestException("Indica el motivo.");
    const row = await this.prisma.visitMotive.create({ data: { name: clean, asksDetail: !!asksDetail, sortOrder: 100 } });
    await this.audit.log({ user, action: "create", entity: "VisitMotive", entityId: row.id, ip });
    return row;
  }

  async patchMotive(id: string, body: { active?: boolean }, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const row = await this.prisma.visitMotive.update({
      where: { id },
      data: { active: body.active !== false },
    });
    await this.audit.log({ user, action: "update", entity: "VisitMotive", entityId: id, ip });
    return row;
  }

  async addRecipient(siteId: string, kind: string, destination: string, label: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const channel = kind === "whatsapp" ? "whatsapp" : kind === "correo" ? "correo" : "";
    if (!channel) throw new BadRequestException("Elige correo o WhatsApp.");
    const dest = channel === "correo" ? String(destination || "").trim().toLowerCase() : whatsappDigits(destination);
    if (channel === "correo" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) throw new BadRequestException("El correo no es válido.");
    if (channel === "whatsapp" && (dest.length < 8 || dest.length > 15)) throw new BadRequestException("El número de WhatsApp no es válido.");
    const row = await this.prisma.visitRecipient.create({
      data: { siteId, kind: channel, destination: dest, label: String(label || dest).trim().slice(0, 80) },
    });
    await this.audit.log({ user, action: "create", entity: "VisitRecipient", entityId: row.id, ip });
    return row;
  }

  async removeRecipient(id: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    await this.prisma.visitRecipient.delete({ where: { id } });
    await this.audit.log({ user, action: "delete", entity: "VisitRecipient", entityId: id, ip });
    return { ok: true };
  }

  async addWarehouse(siteId: string, name: string, mapUrl: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const clean = String(name || "").trim().slice(0, 80);
    const url = String(mapUrl || "").trim().slice(0, 300);
    if (clean.length < 2) throw new BadRequestException("Indica el almacén.");
    if (!/^https:\/\/\S+$/i.test(url)) throw new BadRequestException("El enlace del mapa tiene que empezar por https://");
    const row = await this.prisma.visitWarehouse.create({ data: { siteId, name: clean, mapUrl: url } });
    await this.audit.log({ user, action: "create", entity: "VisitWarehouse", entityId: row.id, ip });
    return row;
  }

  async patchWarehouse(id: string, body: { active?: boolean; mapUrl?: string }, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const data: Prisma.VisitWarehouseUpdateInput = {};
    if (typeof body.active === "boolean") data.active = body.active;
    if (body.mapUrl != null) {
      const url = String(body.mapUrl).trim().slice(0, 300);
      if (!/^https:\/\/\S+$/i.test(url)) throw new BadRequestException("El enlace del mapa tiene que empezar por https://");
      data.mapUrl = url;
    }
    const row = await this.prisma.visitWarehouse.update({ where: { id }, data });
    await this.audit.log({ user, action: "update", entity: "VisitWarehouse", entityId: id, ip });
    return row;
  }

  async importWorkbook(buf: Buffer, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    await this.ensureMasters();
    let parsed: ReturnType<typeof registrationRows>;
    try {
      parsed = registrationRows(readXlsxSheets(buf));
    } catch (e) {
      throw new BadRequestException((e as Error).message || "No se pudo leer el Excel.");
    }
    const sites = await this.prisma.visitSite.findMany();
    const byName = new Map(sites.map((site) => [site.name.toLowerCase(), site]));
    let created = 0;
    let filled = 0;
    const skipped = [...parsed.skipped];
    for (const row of parsed.rows) {
      const site = byName.get(row.siteName.toLowerCase());
      if (!site) {
        skipped.push({ id: row.publicCode, reason: `La sede ${row.siteName} no está en el menú.` });
        continue;
      }
      const existing = await this.prisma.gateVisit.findUnique({ where: { publicCode: row.publicCode } });
      if (!existing) {
        await this.prisma.gateVisit.create({ data: this.importCreate(row, site.id) });
        created += 1;
        continue;
      }
      const data = this.importFill(existing, row, site.id);
      if (Object.keys(data).length) {
        await this.prisma.gateVisit.update({ where: { id: existing.id }, data });
        filled += 1;
      } else {
        skipped.push({ id: row.publicCode, reason: "Ya estaba cargado." });
      }
    }
    await this.audit.log({
      user,
      action: "import",
      entity: "GateVisit",
      entityId: "excel",
      after: { created, filled, skipped: skipped.length },
      ip,
    });
    return { created, filled, skipped };
  }

  private importCreate(row: ImportedRegistration, siteId: string): Prisma.GateVisitCreateInput {
    return {
      publicCode: row.publicCode,
      site: { connect: { id: siteId } },
      siteName: row.siteName,
      status: row.status,
      observations: row.observations,
      tractorPlate: row.tractorPlate,
      trailerPlate: row.trailerPlate,
      company: row.company,
      ruc: row.ruc,
      driverName: row.driverName,
      license: row.license,
      phone: row.phone,
      motive: row.motive,
      equipmentCode: row.equipmentCode || null,
      visitAt: row.visitAt,
    };
  }

  private importFill(existing: VisitRow, row: ImportedRegistration, siteId: string): Prisma.GateVisitUpdateInput {
    const data: Prisma.GateVisitUpdateInput = {};
    const fill = (current: string, incoming: string) => !current && incoming;
    if (!existing.siteId) {
      data.site = { connect: { id: siteId } };
      data.siteName = row.siteName;
    }
    if (fill(existing.company, row.company)) data.company = row.company;
    if (fill(existing.ruc, row.ruc)) data.ruc = row.ruc;
    if (fill(existing.driverName, row.driverName)) data.driverName = row.driverName;
    if (fill(existing.license, row.license)) data.license = row.license;
    if (fill(existing.phone, row.phone)) data.phone = row.phone;
    if (fill(existing.trailerPlate, row.trailerPlate)) data.trailerPlate = row.trailerPlate;
    if (fill(existing.motive, row.motive)) data.motive = row.motive;
    if (fill(existing.observations, row.observations)) data.observations = row.observations;
    if (!existing.equipmentCode && row.equipmentCode) data.equipmentCode = row.equipmentCode;
    if (!existing.visitAt) data.visitAt = row.visitAt;
    if (!existing.status) data.status = row.status;
    return data;
  }
}
