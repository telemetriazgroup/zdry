import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { SalidaService } from "../salida/salida.service";
import { whatsappDigits } from "../domain/catalog-commerce";
import { grantMatchesSession, shareIsLive } from "../domain/catalog-share";
import { retrievalByIso } from "../domain/yard-retrieval";
import {
  REVIEWING_TEXT,
  THANKS_TEXT,
  clientOfferText,
  commercialReplyUrl,
  contactAskedText,
  contactClock,
  executiveEscalationText,
  interestNoticeText,
  offerPrice,
  parseClientChoice,
  parseThreadId,
  priceLines,
  quoteAskedText,
  registrationExecutiveText,
  registrationVendorText,
  threadReference,
  usd,
  vendorReminderText,
} from "../domain/commercial-thread";

const OPEN = "abierto";
const WAITING = "esperando_contacto";
const QUOTE = "cotizacion_pedida";
const CLOSED = "cerrado";

type DeskUser = { id: string; name: string; email: string; whatsapp: string; role: string; active: boolean };

@Injectable()
export class CommercialService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly salida: SalidaService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch(() => undefined);
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async team(user: AuthUser) {
    const [vendors, executives, rows] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: "vendedor", active: true, ...(await this.prisma.hideDemo()) },
        select: { id: true, name: true, email: true, whatsapp: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.user.findMany({
        where: { role: "ejecutivo", active: true, ...(await this.prisma.hideDemo()) },
        select: { id: true, name: true, email: true, whatsapp: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.commercialDesk.findMany({
        where: user.role === "ejecutivo" ? { executiveId: user.id } : {},
        include: {
          vendor: { select: { id: true, name: true, email: true, whatsapp: true, active: true } },
          executive: { select: { id: true, name: true, email: true, whatsapp: true, active: true } },
        },
        orderBy: { vendor: { name: "asc" } },
      }),
    ]);
    return {
      canEdit: user.role === "superadmin" || user.role === "admin" || user.role === "ejecutivo",
      ownTeam: user.role === "ejecutivo",
      vendors,
      executives,
      rows: rows.map((row) => ({
        id: row.id,
        enabled: row.enabled,
        vendor: row.vendor,
        executive: row.executive,
      })),
    };
  }

  async saveDesk(body: { vendorId?: string; executiveId?: string; enabled?: boolean }, user: AuthUser, ip?: string) {
    const ownTeam = user.role === "ejecutivo";
    if (!ownTeam && user.role !== "superadmin" && user.role !== "admin") throw new ForbiddenException("Solo administración o el ejecutivo configuran el equipo comercial.");
    const vendorId = String(body.vendorId || "");
    const executiveId = ownTeam ? user.id : String(body.executiveId || "");
    const enabled = body.enabled === true;
    const [vendor, executive] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: vendorId } }),
      this.prisma.user.findUnique({ where: { id: executiveId } }),
    ]);
    if (!vendor || vendor.role !== "vendedor" || !vendor.active) throw new BadRequestException("Elige un vendedor activo.");
    if (!executive || executive.role !== "ejecutivo" || !executive.active) throw new BadRequestException("Elige un ejecutivo comercial activo.");
    if (enabled && (!phoneOk(vendor.whatsapp) || !phoneOk(executive.whatsapp))) {
      throw new BadRequestException("Para habilitarlo, el vendedor y el ejecutivo necesitan WhatsApp.");
    }
    const taken = await this.prisma.commercialDesk.findUnique({ where: { vendorId } });
    if (ownTeam && taken && taken.executiveId !== user.id) {
      throw new BadRequestException("Ese comercial ya está en el equipo de otro ejecutivo.");
    }
    const row = await this.prisma.commercialDesk.upsert({
      where: { vendorId },
      update: { executiveId, enabled },
      create: { vendorId, executiveId, enabled },
    });
    await this.audit.log({ user, action: "update", entity: "CommercialDesk", entityId: row.id, after: { vendorId, executiveId, enabled }, ip });
    return { id: row.id, vendorId, executiveId, enabled };
  }

  async follower(vendorId: string): Promise<{ id: string; name: string; whatsapp: string; email: string } | null> {
    const row = await this.prisma.commercialDesk.findUnique({
      where: { vendorId },
      include: { executive: { select: { id: true, name: true, whatsapp: true, email: true, active: true, role: true } } },
    });
    if (!row || !row.executive.active || row.executive.role !== "ejecutivo") return null;
    return { id: row.executive.id, name: row.executive.name, whatsapp: whatsappDigits(row.executive.whatsapp), email: row.executive.email };
  }

  async pickWalkIn(): Promise<{ vendor: DeskUser; executive: DeskUser }> {
    const desks = await this.prisma.commercialDesk.findMany({
      where: {
        enabled: true,
        vendor: { role: "vendedor", active: true, ...(await this.prisma.hideDemo()) },
        executive: { role: "ejecutivo", active: true },
      },
      include: {
        vendor: { select: { id: true, name: true, email: true, whatsapp: true, role: true, active: true } },
        executive: { select: { id: true, name: true, email: true, whatsapp: true, role: true, active: true } },
      },
    });
    const ready = desks.filter((row) => phoneOk(row.vendor.whatsapp) && phoneOk(row.executive.whatsapp));
    if (!ready.length) throw new BadRequestException("No hay un comercial disponible para atenderte. Avisa en portería.");
    const counts = await this.prisma.catalogShare.groupBy({
      by: ["vendorId"],
      where: { source: "cliente", vendorId: { in: ready.map((row) => row.vendorId) } },
      _count: { _all: true },
    });
    const load = new Map(counts.map((row) => [row.vendorId, row._count._all]));
    ready.sort((a, b) => (load.get(a.vendorId) || 0) - (load.get(b.vendorId) || 0) || a.vendor.name.localeCompare(b.vendor.name, "es"));
    return { vendor: ready[0].vendor, executive: ready[0].executive };
  }

  async notifyRegistration(input: {
    vendorName: string;
    vendorPhone: string;
    vendorEmail: string;
    executiveName: string;
    executivePhone: string;
    executiveEmail: string;
    clientName: string;
    company: string;
    doc: string;
    phone: string;
    email: string;
    clientPhone: string;
  }) {
    const contact = phoneOk(input.clientPhone) ? whatsappDigits(input.clientPhone) : input.vendorPhone;
    const vendorText = registrationVendorText(input);
    const executiveText = registrationExecutiveText(input);
    const vendor = await this.salida.notifyText({
      phone: input.vendorPhone,
      email: input.vendorEmail,
      contact,
      subject: "Tienes un cliente por atender",
      message: vendorText,
    });
    if (!phoneOk(input.executivePhone) && !input.executiveEmail) return { vendor, executive: null };
    const executive = await this.salida.notifyText({
      phone: input.executivePhone,
      email: input.executiveEmail,
      contact: input.vendorPhone || contact,
      subject: "Un comercial de tu equipo tiene un cliente",
      message: executiveText,
    });
    return { vendor, executive };
  }

  async notifyAssignedVendor(input: {
    vendorId: string;
    vendorName: string;
    vendorPhone: string;
    clientName: string;
    company: string;
    doc: string;
    phone: string;
    email: string;
    clientPhone: string;
  }) {
    const vendor = await this.prisma.user.findUnique({ where: { id: input.vendorId }, select: { email: true } });
    const contact = phoneOk(input.clientPhone) ? whatsappDigits(input.clientPhone) : input.vendorPhone;
    return this.salida.notifyText({
      phone: input.vendorPhone,
      email: vendor?.email || "",
      contact,
      subject: "Tienes un cliente por atender",
      message: registrationVendorText(input),
    });
  }

  async notifyExecutiveOfRegistration(input: {
    executiveName: string;
    executivePhone: string;
    executiveEmail: string;
    vendorName: string;
    vendorPhone: string;
    clientName: string;
    company: string;
    doc: string;
    phone: string;
    email: string;
  }) {
    if (!phoneOk(input.executivePhone) && !input.executiveEmail) return null;
    return this.salida.notifyText({
      phone: input.executivePhone,
      email: input.executiveEmail,
      contact: input.vendorPhone,
      subject: "Un comercial de tu equipo tiene un cliente",
      message: registrationExecutiveText(input),
    });
  }

  async openInterest(input: { shareId: string; iso: string; type: string; ip?: string }) {
    const share = await this.prisma.catalogShare.findUnique({ where: { id: input.shareId } });
    if (!share) throw new NotFoundException("Ese enlace no existe.");
    const existing = await this.prisma.commercialThread.findFirst({
      where: { shareId: share.id, iso: input.iso, status: { not: CLOSED } },
      orderBy: { createdAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (existing) return { fresh: false, client: this.clientView(existing, share.vendorName) };
    const prices = await this.unitPrices(input.iso);
    const thread = await this.prisma.commercialThread.create({
      data: {
        shareId: share.id,
        iso: input.iso,
        unitType: input.type,
        status: OPEN,
        priceList: prices.priceList,
        priceMin: prices.priceMin,
      },
      include: { messages: true },
    });
    const clientName = share.contactName || share.clientName;
    const note = interestNoticeText({
      who: share.vendorName,
      clientName,
      iso: input.iso,
      unitType: input.type,
      priceList: prices.priceList,
      priceMin: prices.priceMin,
    });
    await this.addMessage(thread.id, "sistema", `${clientName} pidió precio o información de ${input.iso}.`);
    const vendor = await this.prisma.user.findUnique({ where: { id: share.vendorId }, select: { email: true, whatsapp: true } });
    const vendorPhone = whatsappDigits(share.vendorWhatsapp || vendor?.whatsapp || "");
    const clientPhone = whatsappDigits(share.clientPhone);
    await this.salida.notifyText({
      phone: vendorPhone,
      email: vendor?.email || "",
      contact: phoneOk(clientPhone) ? clientPhone : vendorPhone,
      subject: `Consulta de ${input.iso}`,
      message: note,
      referencia: threadReference(thread.id),
      respuestaUrl: commercialReplyUrl(),
    });
    if (share.executiveId) {
      const executive = await this.prisma.user.findUnique({ where: { id: share.executiveId }, select: { email: true, name: true, whatsapp: true } });
      const executiveNote = interestNoticeText({
        who: executive?.name || share.executiveName,
        clientName,
        iso: input.iso,
        unitType: input.type,
        priceList: prices.priceList,
        priceMin: prices.priceMin,
      });
      await this.salida.notifyText({
        phone: whatsappDigits(share.executiveWhatsapp || executive?.whatsapp || ""),
        email: executive?.email || "",
        contact: vendorPhone,
        subject: `Consulta de ${input.iso}`,
        message: executiveNote,
      });
    }
    const loaded = await this.loadThread(thread.id);
    return { fresh: true, client: this.clientView(loaded, share.vendorName) };
  }

  async clientThread(token: string, threadId: string, cookie?: string) {
    const thread = await this.threadForToken(token, threadId, cookie);
    return this.clientView(thread, thread.share.vendorName);
  }

  async choose(token: string, threadId: string, option: unknown, cookie?: string) {
    const thread = await this.threadForToken(token, threadId, cookie);
    const choice = parseClientChoice(String(option || ""));
    if (choice !== "1" && choice !== "2" && choice !== "3") throw new BadRequestException("Elige 1, 2 o 3.");
    const reply = await this.applyChoice(thread, choice);
    const loaded = await this.loadThread(thread.id);
    return { ...this.clientView(loaded, thread.share.vendorName), message: reply };
  }

  async inbound(body: { referencia?: string; telefono?: string; texto?: string }, clave: string) {
    const cfg = await this.salida.read();
    if (!cfg.clave || clave !== cfg.clave) throw new UnauthorizedException("La clave de salida no fue aceptada.");
    const id = parseThreadId(String(body.referencia || ""));
    if (!id) return { mensaje: "" };
    const thread = await this.prisma.commercialThread.findUnique({ where: { id }, include: { share: true, messages: { orderBy: { createdAt: "asc" } } } });
    if (!thread) return { mensaje: "" };
    const phone = whatsappDigits(String(body.telefono || ""));
    const text = String(body.texto || "").trim().slice(0, 1000);
    if (!text) return { mensaje: "" };
    const vendorPhone = whatsappDigits(thread.share.vendorWhatsapp);
    const clientPhone = whatsappDigits(thread.share.clientPhone);
    const executivePhone = whatsappDigits(thread.share.executiveWhatsapp);
    if (phone === vendorPhone) {
      if (parseClientChoice(text) === "ok") {
        await this.confirm(thread.id, null);
        return { mensaje: "Quedó registrado que te comunicas con el cliente." };
      }
      await this.addMessage(thread.id, "vendedor", text);
      return { mensaje: thread.status === WAITING && !thread.vendorOkAt ? "Responde OK cuando te comuniques con el cliente." : "Quedó en el hilo." };
    }
    if (phone && phone === clientPhone) {
      const choice = parseClientChoice(text);
      if (choice === "1" || choice === "2" || choice === "3") return { mensaje: await this.applyChoice(thread, choice) };
      await this.addMessage(thread.id, "cliente", text);
      return { mensaje: this.clientPrompt(thread) };
    }
    if (phone && phone === executivePhone) {
      await this.addMessage(thread.id, "ejecutivo", text);
      return { mensaje: "Quedó en el hilo." };
    }
    return { mensaje: "" };
  }

  async listThreads(user: AuthUser) {
    const where = this.threadWhere(user);
    const rows = await this.prisma.commercialThread.findMany({
      where,
      include: { share: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map((row) => this.staffRow(row));
  }

  async readThread(id: string, user: AuthUser) {
    const thread = await this.loadThread(id);
    this.assertStaff(user, thread.share);
    return this.staffDetail(thread);
  }

  async offer(id: string, body: { useList?: boolean; price?: number }, user: AuthUser, ip?: string) {
    const thread = await this.loadThread(id);
    this.assertStaff(user, thread.share);
    if (thread.status === CLOSED || thread.status === QUOTE || thread.status === WAITING) {
      throw new BadRequestException("Ese hilo ya no espera un precio.");
    }
    const decided = offerPrice({
      useList: body.useList === true,
      amount: body.price == null ? null : Number(body.price),
      priceMin: money(thread.priceMin),
      priceList: money(thread.priceList),
    });
    if (!decided.ok) throw new BadRequestException(decided.message);
    const text = clientOfferText({
      clientName: thread.share.contactName || thread.share.clientName,
      iso: thread.iso,
      unitType: thread.unitType,
      net: decided.net,
    });
    await this.prisma.commercialThread.update({ where: { id }, data: { priceNet: decided.net, status: OPEN } });
    await this.addMessage(id, "vendedor", text);
    await this.notifyClient(thread.share, thread.id, "Precio del equipo", text, true);
    const list = money(thread.priceList);
    await this.prisma.shareFollow.create({
      data: {
        shareId: thread.shareId,
        authorId: user.id,
        authorName: user.name,
        channel: decided.net < list ? "descuento" : "whatsapp",
        body: text,
        iso: thread.iso,
        priceNet: decided.net,
        priceList: list,
      },
    });
    await this.audit.log({ user, action: "offer", entity: "CommercialThread", entityId: id, after: { priceNet: decided.net, iso: thread.iso }, ip });
    return this.staffDetail(await this.loadThread(id));
  }

  async confirm(id: string, user: AuthUser | null, ip?: string) {
    const thread = await this.loadThread(id);
    if (user) this.assertVendor(user, thread.share);
    if (thread.status !== WAITING || thread.vendorOkAt) return this.staffDetail(thread);
    await this.prisma.commercialThread.update({ where: { id }, data: { vendorOkAt: new Date() } });
    await this.addMessage(id, "vendedor", "El comercial confirmó que se comunica con el cliente.");
    await this.notifyClient(thread.share, thread.id, "Tu comercial te contacta", "Tu comercial confirmó que se comunica contigo.", false);
    await this.audit.log({ user, action: "confirm", entity: "CommercialThread", entityId: id, after: { iso: thread.iso }, ip });
    return this.staffDetail(await this.loadThread(id));
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const rows = await this.prisma.commercialThread.findMany({
        where: { status: WAITING, vendorOkAt: null, contactAskedAt: { not: null } },
        include: { share: true },
        take: 50,
      });
      const now = new Date();
      for (const row of rows) {
        if (!row.contactAskedAt) continue;
        const clock = contactClock({
          contactAskedAt: row.contactAskedAt,
          vendorOkAt: row.vendorOkAt,
          lastVendorPingAt: row.lastVendorPingAt,
          executivePingAt: row.executivePingAt,
          now,
        });
        if (clock.pingVendor) {
          const vendor = await this.prisma.user.findUnique({ where: { id: row.share.vendorId }, select: { email: true, whatsapp: true } });
          await this.salida.notifyText({
            phone: whatsappDigits(row.share.vendorWhatsapp || vendor?.whatsapp || ""),
            email: vendor?.email || "",
            contact: whatsappDigits(row.share.clientPhone) || whatsappDigits(row.share.vendorWhatsapp),
            subject: `Sigue pendiente el contacto de ${row.iso}`,
            message: vendorReminderText({ clientName: row.share.contactName || row.share.clientName, iso: row.iso }),
            referencia: threadReference(row.id),
            respuestaUrl: commercialReplyUrl(),
          });
          await this.prisma.commercialThread.update({ where: { id: row.id }, data: { lastVendorPingAt: now } });
        }
        if (clock.pingExecutive && row.share.executiveId) {
          const executive = await this.prisma.user.findUnique({ where: { id: row.share.executiveId }, select: { email: true, whatsapp: true } });
          const message = executiveEscalationText({
            vendorName: row.share.vendorName,
            clientName: row.share.contactName || row.share.clientName,
            phone: row.share.clientPhone,
            email: row.share.clientEmail,
            iso: row.iso,
            unitType: row.unitType,
          });
          await this.salida.notifyText({
            phone: whatsappDigits(row.share.executiveWhatsapp || executive?.whatsapp || ""),
            email: executive?.email || "",
            contact: whatsappDigits(row.share.vendorWhatsapp),
            subject: `El comercial no confirmó el contacto de ${row.iso}`,
            message,
          });
          await this.addMessage(row.id, "sistema", message);
          await this.prisma.commercialThread.update({ where: { id: row.id }, data: { executivePingAt: now } });
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async applyChoice(thread: ThreadRow, choice: "1" | "2" | "3"): Promise<string> {
    if (!thread.priceNet) return "Tu comercial todavía está preparando el precio de este equipo.";
    if (thread.status === CLOSED) return THANKS_TEXT;
    if (choice === "1") {
      if (thread.status === QUOTE) return REVIEWING_TEXT;
      const text = quoteAskedText({
        clientName: thread.share.contactName || thread.share.clientName,
        iso: thread.iso,
        unitType: thread.unitType,
        net: money(thread.priceNet),
      });
      await this.prisma.commercialThread.update({ where: { id: thread.id }, data: { status: QUOTE } });
      await this.addMessage(thread.id, "cliente", "Solicitar cotización");
      await this.addMessage(thread.id, "sistema", REVIEWING_TEXT);
      await this.addMessage(thread.id, "sistema", text);
      await this.prisma.shareFollow.create({
        data: {
          shareId: thread.shareId,
          authorName: "Cliente",
          channel: "cotizacion",
          body: text,
          iso: thread.iso,
          priceNet: money(thread.priceNet),
        },
      });
      const vendor = await this.prisma.user.findUnique({ where: { id: thread.share.vendorId }, select: { email: true, whatsapp: true } });
      await this.salida.notifyText({
        phone: whatsappDigits(thread.share.vendorWhatsapp || vendor?.whatsapp || ""),
        email: vendor?.email || "",
        contact: whatsappDigits(thread.share.clientPhone) || whatsappDigits(thread.share.vendorWhatsapp),
        subject: `Cotización pedida de ${thread.iso}`,
        message: text,
        referencia: threadReference(thread.id),
        respuestaUrl: commercialReplyUrl(),
      });
      return REVIEWING_TEXT;
    }
    if (choice === "2") {
      if (thread.status === WAITING) return CONTACT_ALREADY;
      const now = new Date();
      const text = contactAskedText({
        clientName: thread.share.contactName || thread.share.clientName,
        iso: thread.iso,
        unitType: thread.unitType,
        phone: thread.share.clientPhone,
        email: thread.share.clientEmail,
        net: money(thread.priceNet),
      });
      await this.prisma.commercialThread.update({
        where: { id: thread.id },
        data: { status: WAITING, contactAskedAt: now, lastVendorPingAt: now, vendorOkAt: null, executivePingAt: null },
      });
      await this.addMessage(thread.id, "cliente", "Que me contacte el comercial");
      await this.addMessage(thread.id, "sistema", text);
      const vendor = await this.prisma.user.findUnique({ where: { id: thread.share.vendorId }, select: { email: true, whatsapp: true } });
      await this.salida.notifyText({
        phone: whatsappDigits(thread.share.vendorWhatsapp || vendor?.whatsapp || ""),
        email: vendor?.email || "",
        contact: whatsappDigits(thread.share.clientPhone) || whatsappDigits(thread.share.vendorWhatsapp),
        subject: `Contacto urgente de ${thread.iso}`,
        message: text,
        referencia: threadReference(thread.id),
        respuestaUrl: commercialReplyUrl(),
      });
      return "Tu comercial recibió el aviso para comunicarse contigo.";
    }
    await this.prisma.commercialThread.update({ where: { id: thread.id }, data: { status: CLOSED } });
    await this.addMessage(thread.id, "cliente", "Entendido, gracias");
    await this.addMessage(thread.id, "sistema", THANKS_TEXT);
    return THANKS_TEXT;
  }

  private clientPrompt(thread: { status: string; priceNet: Prisma.Decimal | null; iso: string; unitType: string; share: { contactName: string; clientName: string } }): string {
    if (thread.status === QUOTE) return REVIEWING_TEXT;
    if (thread.status === WAITING) return "Tu comercial va a comunicarse contigo.";
    if (thread.status === CLOSED) return THANKS_TEXT;
    if (!thread.priceNet) return "Tu comercial está preparando el precio de este equipo.";
    return clientOfferText({
      clientName: thread.share.contactName || thread.share.clientName,
      iso: thread.iso,
      unitType: thread.unitType,
      net: money(thread.priceNet),
    });
  }

  private async threadForToken(token: string, threadId: string, cookie?: string) {
    const share = await this.prisma.catalogShare.findUnique({ where: { token: String(token || "").trim() } });
    if (!share || share.archivedAt || share.suspendedAt || !shareIsLive(share.expiresAt)) {
      throw new BadRequestException("Este enlace del catálogo no está disponible.");
    }
    if (grantMatchesSession(cookie, share.activeSession) !== "ok") {
      throw new BadRequestException("Entra al catálogo con tu clave para seguir la conversación.");
    }
    const thread = await this.loadThread(threadId);
    if (thread.shareId !== share.id) throw new NotFoundException("Ese hilo no es de este enlace.");
    return thread;
  }

  private async loadThread(id: string) {
    const thread = await this.prisma.commercialThread.findUnique({
      where: { id },
      include: { share: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!thread) throw new NotFoundException("Ese hilo no existe.");
    return thread;
  }

  private threadWhere(user: AuthUser): Prisma.CommercialThreadWhereInput {
    if (user.role === "superadmin" || user.role === "admin") return {};
    if (user.role === "ejecutivo") return { share: { executiveId: user.id } };
    if (user.role === "vendedor") return { share: { vendorId: user.id } };
    throw new ForbiddenException("Sin acceso");
  }

  private assertStaff(user: AuthUser, share: { vendorId: string; executiveId: string }) {
    if (user.role === "superadmin" || user.role === "admin") return;
    if (user.role === "vendedor" && share.vendorId === user.id) return;
    if (user.role === "ejecutivo" && share.executiveId === user.id) return;
    throw new ForbiddenException("Ese hilo no es de tu equipo.");
  }

  private assertVendor(user: AuthUser, share: { vendorId: string }) {
    if (user.role === "superadmin" || user.role === "admin" || (user.role === "vendedor" && share.vendorId === user.id)) return;
    throw new ForbiddenException("El OK lo confirma el comercial asignado.");
  }

  private async unitPrices(iso: string) {
    const unit = await this.prisma.container.findUnique({
      where: { iso },
      select: { iso: true, depotId: true, lado: true, ruma: true, columna: true, nivel: true, priceList: true, priceMin: true },
    });
    const baseList = money(unit?.priceList);
    const baseMin = money(unit?.priceMin);
    if (!unit) return { priceList: baseList, priceMin: baseMin };
    const retrieval = await retrievalByIso(this.prisma, [unit]);
    const extra = unit.lado ? retrieval.byIso.get(unit.iso)?.reference || 0 : 0;
    return { priceList: round(baseList + extra), priceMin: round(baseMin + extra) };
  }

  private async notifyClient(share: { clientPhone: string; clientEmail: string; vendorWhatsapp: string }, threadId: string, subject: string, message: string, reply: boolean) {
    await this.salida.notifyText({
      phone: whatsappDigits(share.clientPhone),
      email: share.clientEmail,
      contact: whatsappDigits(share.vendorWhatsapp) || whatsappDigits(share.clientPhone),
      subject,
      message,
      referencia: reply ? threadReference(threadId) : "",
      respuestaUrl: reply ? commercialReplyUrl() : "",
    });
  }

  private async addMessage(threadId: string, author: string, body: string) {
    await this.prisma.commercialMessage.create({ data: { threadId, author, body: body.slice(0, 4000) } });
  }

  private clientView(thread: { id: string; iso: string; unitType: string; status: string; priceNet: Prisma.Decimal | null; messages: Array<{ id: string; author: string; body: string; createdAt: Date }> }, vendorName: string) {
    const offer = thread.priceNet == null ? null : priceLines(money(thread.priceNet));
    return {
      threadId: thread.id,
      iso: thread.iso,
      unitType: thread.unitType,
      status: thread.status,
      vendorName,
      offer,
      message: thread.messages.length ? thread.messages[thread.messages.length - 1].body : "Tu comercial recibió la consulta.",
      messages: thread.messages.map((row) => ({ id: row.id, author: row.author, body: row.body, createdAt: row.createdAt })),
    };
  }

  private staffRow(row: Omit<ThreadRow, "messages"> & { messages?: ThreadRow["messages"] }) {
    return {
      id: row.id,
      iso: row.iso,
      unitType: row.unitType,
      status: row.status,
      priceList: money(row.priceList),
      priceMin: money(row.priceMin),
      priceNet: row.priceNet == null ? null : money(row.priceNet),
      clientName: row.share.contactName || row.share.clientName,
      clientCompany: row.share.clientCompany,
      vendorName: row.share.vendorName,
      executiveName: row.share.executiveName,
      updatedAt: row.updatedAt,
    };
  }

  private staffDetail(thread: ThreadRow) {
    const net = thread.priceNet == null ? null : money(thread.priceNet);
    return {
      ...this.staffRow(thread),
      margin: Math.round(money(thread.priceList) - money(thread.priceMin)),
      offer: net == null ? null : priceLines(net),
      maxLabel: `Precio de lista ${usd(money(thread.priceList))}`,
      clientPhone: thread.share.clientPhone,
      clientEmail: thread.share.clientEmail,
      vendorOkAt: thread.vendorOkAt,
      contactAskedAt: thread.contactAskedAt,
      messages: thread.messages.map((row) => ({ id: row.id, author: row.author, body: row.body, createdAt: row.createdAt })),
    };
  }
}

const CONTACT_ALREADY = "Tu comercial ya tiene el aviso para comunicarse contigo.";

type ThreadRow = Prisma.CommercialThreadGetPayload<{ include: { share: true; messages: true } }>;

function phoneOk(value: string) {
  const digits = whatsappDigits(value);
  return digits.length >= 8 && digits.length <= 15;
}

function money(value: Prisma.Decimal | number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? round(n) : 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
