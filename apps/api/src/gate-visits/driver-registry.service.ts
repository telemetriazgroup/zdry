import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
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
  peruReplyPhone,
  readXlsxSheets,
  registrationCard,
  registrationPreview,
  registrationRequest,
  visitWhatsappRef,
  registrationRows,
  validatePublicInput,
  PublicInput,
} from "../domain/driver-registry";
import { StorageService } from "../storage/storage.service";

type VisitRow = Prisma.GateVisitGetPayload<object>;

const DRIVER_QUEUE_LIMIT = 2;
const DRIVER_STALE_MS = 5 * 60 * 1000;
const DRIVER_SYNC_MS = 30 * 1000;

function manages(role: string) {
  return role === "admin" || role === "superadmin" || role === "coordinador";
}

@Injectable()
export class DriverRegistryService implements OnModuleInit, OnModuleDestroy {
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly salida: SalidaService,
    private readonly storage: StorageService,
  ) {}

  async onModuleInit() {
    await this.ensureMasters().catch(() => undefined);
    this.syncTimer = setInterval(() => {
      this.syncSalida().catch(() => undefined);
    }, DRIVER_SYNC_MS);
  }

  onModuleDestroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
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

  private registrationOf(visit: VisitRow) {
    return registrationCard({
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
    const emails = site.recipients.filter((item) => item.kind === "correo").map((item) => item.destination);
    const phones = site.recipients.filter((item) => item.kind === "whatsapp").map((item) => item.destination);
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
    const sent = await this.dispatchRegistration(
      this.registrationOf(visit),
      phones,
      emails,
      site.replyPhone,
      cfg,
      (telefono) => visitWhatsappRef(visit.id, "registro", telefono),
    );
    await this.storeResults(visit.id, sent.items.map((item) => ({ ...item, kind: "registro", audience: "interno" })));
  }

  private async dispatchRegistration(
    card: ReturnType<typeof registrationCard>,
    phones: string[],
    emails: string[],
    replyPhone: string,
    cfg: { url: string; clave: string },
    refFor?: (telefono: string) => string,
  ) {
    const contacto = whatsappDigits(replyPhone);
    const replyOk = contacto.length >= 8 && contacto.length <= 15;
    const preview = registrationPreview(card);
    const items: Array<{ channel: string; destination: string; status: string; detail: string; message: string }> = [];
    const waReady = replyOk ? phones.map((phone) => ({ destination: phone, telefono: whatsappDigits(phone) })) : [];
    if (!replyOk) {
      for (const destination of phones) {
        items.push({ channel: "whatsapp", destination, status: "omitido", detail: "Falta el número de respuesta de la sede.", message: preview });
      }
    }
    if (!cfg.clave) {
      for (const item of waReady) items.push({ channel: "whatsapp", destination: item.destination, status: "error", detail: "Falta la clave de salida.", message: preview });
      for (const destination of emails) items.push({ channel: "correo", destination, status: "error", detail: "Falta la clave de salida.", message: "" });
      return { ok: false, detail: "Falta la clave de salida.", items };
    }
    const body = registrationRequest(
      card,
      waReady.map((item) => ({
        telefono: item.telefono,
        contacto,
        referencia: refFor ? refFor(item.telefono) : "",
      })),
      emails,
    );
    if (!body.whatsapp && !body.correo) {
      return { ok: false, detail: items.map((item) => `${item.channel} ${item.destination}: ${item.detail}`).join(" "), items };
    }
    const result = await this.postSalida(htmlSalidaUrl(cfg.url), cfg.clave, body);
    waReady.forEach((item, index) => {
      const hit = result.whatsapp[index];
      items.push({
        channel: "whatsapp",
        destination: item.destination,
        status: hit ? String(hit.estado || "error") : "error",
        detail: hit ? String(hit.motivo || result.detail || "") : (result.detail || "La salida no confirmó el WhatsApp."),
        message: preview,
      });
    });
    emails.forEach((destination, index) => {
      const hit = result.correos[index];
      items.push({
        channel: "correo",
        destination,
        status: hit ? String(hit.estado || "error") : "error",
        detail: hit ? String(hit.motivo || result.detail || "") : (result.detail || "La salida no confirmó el correo."),
        message: "",
      });
    });
    const detail = items.map((item) => {
      const state = item.status === "en_cola" ? "en cola" : item.status === "en_espera" ? "en espera" : item.status;
      return `${item.channel} ${item.destination}: ${state}${item.detail ? ` (${item.detail})` : ""}`;
    }).join(" ");
    const ok = items.length > 0 && items.every((item) => item.status === "en_cola" || item.status === "en_espera");
    return { ok, detail, items };
  }

  private async sendWhatsapps(
    visit: VisitRow,
    phones: string[],
    replyPhone: string,
    message: string,
    kind: string,
    audience: string,
    cfg: { url: string; clave: string },
    referencia = "",
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
        message,
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
        message,
      })));
      return;
    }
    const body = {
      whatsapp: items.map((item) => {
        const row: Record<string, string> = { telefono: item.telefono, mensaje: message, contacto };
        if (referencia) row.referencia = referencia;
        return row;
      }),
    };
    const result = await this.postSalida(cfg.url, cfg.clave, body);
    await this.storeResults(visit.id, items.map((item, index) => {
      const hit = result.whatsapp[index];
      return {
        channel: "whatsapp",
        audience,
        destination: item.destination,
        kind,
        status: hit ? String(hit.estado || "error") : "error",
        detail: hit ? String(hit.motivo || result.detail || "") : (result.detail || "La salida no confirmó el WhatsApp."),
        message,
        externalRef: hit?.estado === "en_cola" ? referencia : "",
      };
    }));
  }

  private async storeResults(visitId: string, rows: Array<{
    channel: string;
    audience: string;
    destination: string;
    kind: string;
    status: string;
    detail: string;
    message?: string;
    externalRef?: string;
  }>) {
    if (!rows.length) return;
    await this.prisma.visitNotice.createMany({
      data: rows.map((row) => ({
        visitId,
        channel: row.channel,
        audience: row.audience,
        destination: row.destination,
        kind: row.kind,
        status: row.status,
        detail: row.detail.slice(0, 300),
        message: (row.message || "").slice(0, 4000),
        externalRef: (row.externalRef || "").slice(0, 80),
      })),
    });
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
      const whatsapp = Array.isArray(data.whatsapp) ? data.whatsapp as Array<Record<string, unknown>> : [];
      const correos = Array.isArray(data.correos) ? data.correos as Array<Record<string, unknown>> : [];
      const message = String(data.message || data.error || data.motivo || "").slice(0, 300);
      if (res.status === 404) return { ok: false, detail: "La ruta de registro no está publicada.", whatsapp, correos };
      if (res.status === 401) return { ok: false, detail: "La clave de salida no fue aceptada.", whatsapp, correos };
      if (!res.ok && !whatsapp.length && !correos.length) {
        return { ok: false, detail: message || `La salida respondió ${res.status}.`, whatsapp, correos };
      }
      return { ok: res.ok, detail: message, whatsapp, correos };
    } catch {
      return { ok: false, detail: "No se pudo conectar con la salida.", whatsapp: [] as Array<Record<string, unknown>>, correos: [] as Array<Record<string, unknown>> };
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
    if (notice.audience === "conductor" && notice.channel === "whatsapp") {
      if (visit.status !== "EN ATENCION") {
        throw new BadRequestException("La confirmación se reenvía cuando el ingreso está en atención.");
      }
      const kind = notice.kind === "ubicacion" ? "ubicacion" : "confirmacion";
      const ref = await this.nextDriverRef(visitId, kind);
      const text = await this.driverText(visit, kind, "");
      await this.sendWhatsapps(visit, [notice.destination], site?.replyPhone || "", text, notice.kind, notice.audience, cfg, ref);
    } else if (notice.channel === "correo" || notice.channel === "whatsapp") {
      const sent = await this.dispatchRegistration(
        this.registrationOf(visit),
        notice.channel === "whatsapp" ? [notice.destination] : [],
        notice.channel === "correo" ? [notice.destination] : [],
        site?.replyPhone || "",
        cfg,
        notice.kind === "registro" ? (telefono) => visitWhatsappRef(visit.id, "registro", telefono) : undefined,
      );
      await this.storeResults(visit.id, sent.items.map((item) => ({ ...item, kind: notice.kind, audience: notice.audience })));
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
    if (visit.status !== "EN ATENCION") {
      throw new BadRequestException("La confirmación y la ubicación se envían cuando el ingreso está en atención.");
    }
    const ref = await this.nextDriverRef(id, kind);
    const site = visit.siteId ? await this.prisma.visitSite.findUnique({ where: { id: visit.siteId } }) : null;
    const message = await this.driverText(visit, kind, warehouseId);
    const cfg = await this.salida.read();
    await this.sendWhatsapps(visit, [visit.phone], site?.replyPhone || "", message, kind, "conductor", cfg, ref);
    await this.audit.log({ user, action: "driver_notice", entity: "GateVisit", entityId: id, after: { kind }, ip });
    return this.detail(id);
  }

  private async nextDriverRef(visitId: string, kind: "confirmacion" | "ubicacion") {
    const queued = await this.prisma.visitNotice.count({
      where: { visitId, audience: "conductor", channel: "whatsapp", status: "en_cola" },
    });
    if (queued >= DRIVER_QUEUE_LIMIT) {
      throw new BadRequestException("Este ingreso ya tiene 2 mensajes pendientes de enviar. Cuando salga uno, se puede cargar otro.");
    }
    const sent = await this.prisma.visitNotice.count({
      where: { visitId, audience: "conductor", channel: "whatsapp", kind },
    });
    return visitWhatsappRef(visitId, kind, String(sent + 1));
  }

  async syncSalida() {
    const pending = await this.prisma.visitNotice.findMany({
      where: {
        channel: "whatsapp",
        audience: "conductor",
        status: { in: ["en_cola", "en_espera"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      include: { visit: { select: { id: true, driverName: true } } },
      orderBy: { createdAt: "asc" },
      take: 30,
    });
    if (!pending.length) return { alerts: [] as Array<{ id: string; visitId: string; text: string }> };
    const refs = [...new Set(pending.flatMap((note) => note.externalRef ? [note.externalRef] : [`zdry:visita:${note.visitId}:${note.kind}`]))];
    const known = await this.readSalidaEstado(refs);
    const alerts: Array<{ id: string; visitId: string; text: string }> = [];
    for (const note of pending) {
      const ref = note.externalRef || `zdry:visita:${note.visitId}:${note.kind}`;
      const hit = known.get(ref);
      const name = note.visit.driverName || "el conductor";
      if (hit?.estado === "enviado") {
        await this.prisma.visitNotice.update({ where: { id: note.id }, data: { status: "enviado", detail: "SGIT confirmó el envío." } });
        continue;
      }
      if (hit?.estado === "cerrado") {
        const text = `No se llegó a enviar el mensaje a ${name}.`;
        await this.prisma.visitNotice.update({ where: { id: note.id }, data: { status: "sin_enviar", detail: hit.motivo || text } });
        alerts.push({ id: note.id, visitId: note.visitId, text: hit.motivo || text });
        continue;
      }
      if (Date.now() - note.createdAt.getTime() >= DRIVER_STALE_MS) {
        const text = `No se llegó a enviar el mensaje a ${name}.`;
        await this.prisma.visitNotice.update({ where: { id: note.id }, data: { status: "sin_enviar", detail: text } });
        alerts.push({ id: note.id, visitId: note.visitId, text });
      }
    }
    return { alerts };
  }

  private async readSalidaEstado(refs: string[]) {
    const found = new Map<string, { estado: string; motivo: string }>();
    if (!refs.length) return found;
    const cfg = await this.salida.read();
    if (!cfg.clave) return found;
    try {
      const res = await fetch(`${cfg.url.replace(/\/$/, "")}/estado`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json", "x-salida-clave": cfg.clave },
        body: JSON.stringify({ referencias: refs.slice(0, 30) }),
      });
      if (!res.ok) return found;
      const data = await res.json() as { avisos?: Array<{ referencia?: string; estado?: string; motivo?: string }> };
      for (const aviso of data.avisos || []) {
        if (!aviso.referencia) continue;
        found.set(aviso.referencia, { estado: String(aviso.estado || ""), motivo: String(aviso.motivo || "") });
      }
    } catch {
      return found;
    }
    return found;
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
    const needsConfirm = visit.notices.some((note) => note.channel === "whatsapp" && !note.message && note.kind === "confirmacion");
    const needsCard = visit.notices.some((note) => note.channel === "whatsapp" && !note.message && note.kind === "registro");
    const confirmText = needsConfirm ? await this.driverText(visit, "confirmacion", "") : "";
    const cardText = needsCard ? registrationPreview(this.registrationOf(visit)) : "";
    const notices = visit.notices.map((note) => {
      if (note.channel !== "whatsapp") return { ...note, messageSaved: false };
      if (note.message) return { ...note, messageSaved: true };
      if (note.kind === "confirmacion") return { ...note, message: confirmText, messageSaved: false };
      if (note.kind === "registro") return { ...note, message: cardText, messageSaved: false };
      if (note.kind === "ubicacion") {
        return { ...note, message: "Este envío no guardó el texto de la ubicación.", messageSaved: false };
      }
      return { ...note, messageSaved: false };
    });
    const photoStatus = visitPhotoStatus(visit);
    const own = visit.site?.warehouses || [];
    const warehouses = own.length
      ? own.map((item) => ({ ...item, siteName: visit.site?.name || "" }))
      : (await this.prisma.visitWarehouse.findMany({
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }],
          include: { site: { select: { name: true, sortOrder: true } } },
        })).sort((a, b) => (a.site.sortOrder - b.site.sortOrder) || (a.sortOrder - b.sortOrder))
          .map((item) => ({ ...item, siteName: item.site.name }));
    return {
      ...visit,
      notices,
      unitPhotoKey: undefined,
      unitPhotoMime: undefined,
      photoStatus,
      hasPhoto: photoStatus === "visible",
      photoArchived: photoStatus === "archived",
      isoWarning: equipmentIsoWarning(visit.equipmentCode || ""),
      locked: visit.status !== "REGISTRADO" || !!visit.archivedAt,
      warehouses,
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
    if (body.replyPhone != null) {
      const next = peruReplyPhone(body.replyPhone);
      if (next == null) throw new BadRequestException("El WhatsApp de respuesta son 9 dígitos después del 51.");
      data.replyPhone = next;
    }
    const row = await this.prisma.visitSite.update({ where: { id }, data });
    await this.audit.log({ user, action: "update", entity: "VisitSite", entityId: id, ip });
    return row;
  }

  async testSite(id: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const site = await this.prisma.visitSite.findUnique({
      where: { id },
      include: { recipients: { where: { active: true } } },
    });
    if (!site) throw new NotFoundException("Sede no encontrada.");
    const emails = site.recipients.filter((item) => item.kind === "correo").map((item) => item.destination);
    const phones = site.recipients.filter((item) => item.kind === "whatsapp").map((item) => item.destination);
    if (!emails.length && !phones.length) throw new BadRequestException("Esta sede no tiene correos ni WhatsApp.");
    if (emails.length > 30 || phones.length > 30) throw new BadRequestException("El máximo es 30 mensajes por envío.");
    const now = new Date();
    const card = registrationCard({
      site: site.name,
      motive: "Prueba de configuración",
      when: now,
      tractorPlate: "PRUEBA",
      trailerPlate: "",
      driverName: "PRUEBA ZDRY",
      company: "ZGROUP",
      ruc: "",
      license: "",
      phone: "",
      equipmentCode: "",
      status: "REGISTRADO",
      observations: "Mensaje de prueba para validar la sede. No es un ingreso real.",
      publicCode: `ZG-PRUEBA-${formatPublicCode(now).slice(3)}`,
    });
    const cfg = await this.salida.read();
    const sent = await this.dispatchRegistration(card, phones, emails, site.replyPhone, cfg);
    await this.audit.log({ user, action: "test_notice", entity: "VisitSite", entityId: id, after: { ok: sent.ok }, ip });
    return { ok: sent.ok, detail: sent.detail, items: sent.items };
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
    let dest = "";
    if (channel === "correo") {
      dest = String(destination || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) throw new BadRequestException("El correo no es válido.");
    } else {
      const phone = peruReplyPhone(destination);
      if (!phone) throw new BadRequestException("El WhatsApp son 9 dígitos después del 51.");
      dest = phone;
    }
    const row = await this.prisma.visitRecipient.create({
      data: { siteId, kind: channel, destination: dest, label: String(label || dest).trim().slice(0, 80) },
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException(channel === "correo" ? "Ese correo ya está en la sede." : "Ese WhatsApp ya está en la sede.");
      }
      throw error;
    });
    await this.audit.log({ user, action: "create", entity: "VisitRecipient", entityId: row.id, ip });
    return row;
  }

  async patchRecipient(id: string, destination: string, user: AuthUser, ip?: string) {
    if (!manages(user.role)) throw new ForbiddenException("Sin acceso.");
    const current = await this.prisma.visitRecipient.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Destino no encontrado.");
    let dest = "";
    if (current.kind === "correo") {
      dest = String(destination || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) throw new BadRequestException("El correo no es válido.");
    } else if (current.kind === "whatsapp") {
      const phone = peruReplyPhone(destination);
      if (!phone) throw new BadRequestException("El WhatsApp son 9 dígitos después del 51.");
      dest = phone;
    } else {
      throw new BadRequestException("Ese destino no se puede editar.");
    }
    const row = await this.prisma.visitRecipient.update({
      where: { id },
      data: { destination: dest, label: dest },
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException(current.kind === "correo" ? "Ese correo ya está en la sede." : "Ese WhatsApp ya está en la sede.");
      }
      throw error;
    });
    await this.audit.log({ user, action: "update", entity: "VisitRecipient", entityId: id, after: { destination: dest }, ip });
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

  async removeVisit(id: string, user: AuthUser, ip?: string) {
    if (user.role !== "superadmin") throw new ForbiddenException("Solo el superusuario puede eliminar un ingreso.");
    const row = await this.prisma.gateVisit.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Ingreso no encontrado.");
    if (row.unitPhotoKey) await this.storage.delete(row.unitPhotoKey).catch(() => undefined);
    await this.prisma.gateVisit.delete({ where: { id } });
    await this.audit.log({
      user,
      action: "delete",
      entity: "GateVisit",
      entityId: id,
      before: { publicCode: row.publicCode, driverName: row.driverName, tractorPlate: row.tractorPlate },
      ip,
    });
    return { ok: true };
  }

  async resetVisits(user: AuthUser, ip?: string) {
    if (user.role !== "superadmin") throw new ForbiddenException("Solo el superusuario puede reiniciar el módulo.");
    const photos = await this.prisma.gateVisit.findMany({
      where: { unitPhotoKey: { not: null } },
      select: { unitPhotoKey: true },
    });
    for (const row of photos) {
      if (row.unitPhotoKey) await this.storage.delete(row.unitPhotoKey).catch(() => undefined);
    }
    const result = await this.prisma.gateVisit.deleteMany();
    await this.audit.log({
      user,
      action: "delete",
      entity: "GateVisit",
      entityId: "reset",
      after: { removed: result.count },
      ip,
    });
    return { ok: true, removed: result.count };
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
