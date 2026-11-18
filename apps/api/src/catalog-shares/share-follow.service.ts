import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AuditService } from "../audit/audit.service";
import { OdooClient } from "../odoo/odoo.client";
import { AuthUser } from "../auth/auth.types";
import { priceLines, usd } from "../domain/commercial-thread";

const CHANNELS = ["whatsapp", "telefono", "correo", "nota", "precio", "descuento", "cotizacion"] as const;

@Injectable()
export class ShareFollowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly odoo: OdooClient,
  ) {}

  async list(shareId: string, user: AuthUser) {
    const share = await this.shareFor(shareId, user);
    const [follows, quote] = await Promise.all([
      this.prisma.shareFollow.findMany({
        where: { shareId: share.id },
        include: { files: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      share.quoteId ? this.prisma.quote.findUnique({ where: { id: share.quoteId }, include: { lines: true, extras: true } }) : null,
    ]);
    return {
      quote: quote ? this.presentQuote(quote) : null,
      follows: follows.map((row) => this.present(row)),
    };
  }

  async add(shareId: string, body: { channel?: string; body?: string; iso?: string; priceNet?: number }, user: AuthUser, ip?: string) {
    const share = await this.shareFor(shareId, user);
    const channel = String(body.channel || "nota");
    if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) throw new BadRequestException("Elige teléfono, correo, WhatsApp o una nota.");
    const text = String(body.body || "").trim();
    if (!text) throw new BadRequestException("Escribe lo que ofreciste o lo que dijo el cliente.");
    const price = body.priceNet == null || body.priceNet === ("" as unknown) ? null : Number(body.priceNet);
    const row = await this.prisma.shareFollow.create({
      data: {
        shareId: share.id,
        authorId: user.id,
        authorName: user.name,
        channel,
        body: text.slice(0, 4000),
        iso: String(body.iso || "").trim().toUpperCase().slice(0, 20),
        priceNet: price != null && Number.isFinite(price) ? price : null,
      },
      include: { files: true },
    });
    await this.audit.log({ user, action: "follow", entity: "CatalogShare", entityId: share.id, after: { channel, iso: row.iso }, ip });
    return this.present(row);
  }

  async addPhoto(shareId: string, followId: string, file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number } | undefined, user: AuthUser) {
    const share = await this.shareFor(shareId, user);
    if (!file?.buffer?.length) throw new BadRequestException("Adjunta una imagen.");
    const mime = String(file.mimetype || "");
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new BadRequestException("La imagen tiene que ser JPG, PNG, WEBP o GIF.");
    const follow = await this.prisma.shareFollow.findFirst({ where: { id: followId, shareId: share.id } });
    if (!follow) throw new NotFoundException("Esa nota de seguimiento no existe.");
    const id = randomUUID();
    const key = `follow/${share.id}/${id}`;
    await this.storage.put(key, file.buffer, mime);
    const saved = await this.prisma.shareFollowFile.create({
      data: {
        id,
        followId: follow.id,
        storageKey: key,
        mimeType: mime,
        originalName: String(file.originalname || "imagen").slice(0, 180),
        sizeBytes: file.size || file.buffer.length,
      },
    });
    return { id: saved.id };
  }

  async file(fileId: string, user: AuthUser) {
    const file = await this.prisma.shareFollowFile.findUnique({ where: { id: fileId }, include: { follow: true } });
    if (!file) throw new NotFoundException("Esa imagen no está.");
    await this.shareFor(file.follow.shareId, user);
    const obj = await this.storage.get(file.storageKey);
    return { stream: obj.stream, mime: file.mimeType || obj.contentType || "image/jpeg", name: file.originalName };
  }

  async linkQuote(shareId: string, rawName: string, user: AuthUser, ip?: string) {
    const share = await this.shareFor(shareId, user);
    const saleName = String(rawName || "").trim();
    if (!saleName || saleName.length > 40) throw new BadRequestException("Escribe el número de la cotización de Odoo.");
    let orders: Record<string, unknown>[] = [];
    try {
      orders = await this.odoo.searchRead(
        "sale.order",
        ["|", ["name", "=", saleName], ["name", "ilike", saleName]],
        ["id", "name", "state", "partner_id", "amount_untaxed", "amount_tax", "amount_total", "currency_id", "note"],
        { limit: 5 },
      );
    } catch (e) {
      throw new BadRequestException(`No pude leer Odoo: ${(e as Error).message}`);
    }
    const order = orders.find((row) => String(row.name || "").toLowerCase() === saleName.toLowerCase()) || orders[0];
    if (!order) throw new NotFoundException("Esa cotización no está en Odoo.");
    const orderId = Number(order.id);
    let lines: Record<string, unknown>[] = [];
    try {
      lines = await this.odoo.searchRead(
        "sale.order.line",
        [["order_id", "=", orderId]],
        ["name", "product_id", "price_unit", "product_uom_qty", "price_subtotal", "price_total"],
        { limit: 80 },
      );
    } catch (e) {
      throw new BadRequestException(`Odoo no entregó las líneas: ${(e as Error).message}`);
    }
    const customerId = await this.ensureCustomer(share, many(order.partner_id));
    const quote = await this.upsertQuote(share, customerId, order, lines);
    await this.prisma.catalogShare.update({ where: { id: share.id }, data: { quoteId: quote.id } });
    const summary = this.quoteSummary(order, lines, quote.number);
    const follow = await this.prisma.shareFollow.create({
      data: {
        shareId: share.id,
        authorId: user.id,
        authorName: user.name,
        channel: "cotizacion",
        body: summary,
        quoteId: quote.id,
        priceNet: money(order.amount_untaxed),
      },
      include: { files: true },
    });
    await this.audit.log({
      user,
      action: "assimilate_quote",
      entity: "CatalogShare",
      entityId: share.id,
      after: { odoo: String(order.name || ""), quote: quote.number },
      ip,
    });
    return { follow: this.present(follow), quote: this.presentQuote(await this.prisma.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: true, extras: true } })) };
  }

  private async upsertQuote(share: ShareRow, customerId: string, order: Record<string, unknown>, lines: Record<string, unknown>[]) {
    const odooSaleId = Number(order.id);
    const existing = share.quoteId
      ? await this.prisma.quote.findUnique({ where: { id: share.quoteId } })
      : await this.prisma.quote.findFirst({ where: { odooSaleId } });
    const data = {
      odooSaleId,
      odooSaleName: String(order.name || ""),
      odooState: String(order.state || ""),
      odooAmountUntaxed: money(order.amount_untaxed),
      odooAmountTax: money(order.amount_tax),
      odooAmountTotal: money(order.amount_total),
      odooPartnerId: many(order.partner_id).id,
      odooUrl: await this.odooFormUrl(odooSaleId),
      vendorId: share.vendorId,
      customerId,
      dealStatus: "en_negociacion",
    };
    const quote = existing
      ? await this.prisma.quote.update({ where: { id: existing.id }, data })
      : await this.prisma.quote.create({ data: { ...data, number: await this.nextQuoteNumber(), kind: "venta" } });
    await this.prisma.quoteLine.deleteMany({ where: { quoteId: quote.id } });
    if (lines.length) {
      await this.prisma.quoteLine.createMany({
        data: lines.map((line, index) => {
          const product = many(line.product_id);
          const net = money(line.price_unit) || money(line.price_subtotal);
          return {
            quoteId: quote.id,
            iso: isoOf(String(line.name || product.name || ""), index),
            type: (product.name || String(line.name || "Equipo")).slice(0, 80),
            cat: "DRY",
            listPrice: net,
            minPrice: net,
            priceNet: net,
          };
        }),
      });
    }
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: quote.id,
        type: "odoo_assimilada",
        detail: `Cotización ${String(order.name || "")} asimilada desde Odoo. Neto ${usd(money(order.amount_untaxed))}, IGV ${usd(money(order.amount_tax))}, total ${usd(money(order.amount_total))}.`,
      },
    });
    return quote;
  }

  private quoteSummary(order: Record<string, unknown>, lines: Record<string, unknown>[], number: string) {
    const priced = priceLines(money(order.amount_untaxed) || 0);
    const rows = lines.slice(0, 12).map((line) => {
      const name = String(line.name || many(line.product_id).name || "Línea").replace(/\s+/g, " ").slice(0, 80);
      return `${name}: ${usd(money(line.price_subtotal) || money(line.price_unit))}`;
    });
    return [
      `Cotización Odoo ${String(order.name || "")} quedó en ZDRY como ${number}.`,
      `Estado Odoo: ${String(order.state || "borrador")}.`,
      priced.net ? priced.text : "",
      ...rows,
    ].filter(Boolean).join("\n").slice(0, 4000);
  }

  private async ensureCustomer(share: ShareRow, partner: { id: number | null; name: string }) {
    if (share.customerId) return share.customerId;
    const doc = share.ruc || share.dni;
    const found = doc
      ? await this.prisma.customer.findFirst({ where: { rucDni: doc } })
      : share.clientEmail
        ? await this.prisma.customer.findFirst({ where: { email: share.clientEmail } })
        : null;
    if (found) {
      await this.prisma.catalogShare.update({ where: { id: share.id }, data: { customerId: found.id } });
      return found.id;
    }
    const created = await this.prisma.customer.create({
      data: {
        rucDni: doc,
        companyName: share.clientCompany || partner.name || share.clientName,
        email: share.clientEmail || `${share.token}@registro.zdry`,
        phone: share.clientPhone,
        street: share.street,
        district: share.district,
        province: share.province,
        department: share.department,
        sunatState: share.sunatState,
        sunatCondition: share.sunatCondition,
        odooPartnerId: partner.id,
      },
    });
    await this.prisma.catalogShare.update({ where: { id: share.id }, data: { customerId: created.id } });
    return created.id;
  }

  private async nextQuoteNumber() {
    const year = new Date().getFullYear();
    const prefix = `COT-${year}-`;
    const last = await this.prisma.quote.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
    });
    const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
    return `${prefix}${String(Number.isFinite(seq) ? seq : 1).padStart(4, "0")}`;
  }

  private async odooFormUrl(id: number) {
    try {
      const cfg = await this.odoo.readConfig();
      const base = String(cfg.url || "").replace(/\/$/, "");
      return base ? `${base}/web#id=${id}&model=sale.order&view_type=form` : "";
    } catch {
      return "";
    }
  }

  private async shareFor(id: string, user: AuthUser) {
    const share = await this.prisma.catalogShare.findUnique({ where: { id } });
    if (!share) throw new NotFoundException("Enlace no encontrado.");
    if (user.role === "superadmin" || user.role === "admin") return share;
    if (user.role === "vendedor" && share.vendorId === user.id) return share;
    if (user.role === "ejecutivo" && (share.executiveId === user.id || !share.executiveId)) return share;
    if (user.role === "ejecutivo") return share;
    throw new ForbiddenException("Ese enlace no es de tu equipo.");
  }

  private present(row: Prisma.ShareFollowGetPayload<{ include: { files: true } }>) {
    return {
      id: row.id,
      channel: row.channel,
      body: row.body,
      iso: row.iso,
      priceNet: row.priceNet == null ? null : Number(row.priceNet),
      priceList: row.priceList == null ? null : Number(row.priceList),
      quoteId: row.quoteId,
      authorName: row.authorName,
      createdAt: row.createdAt,
      files: row.files.map((file) => ({ id: file.id, name: file.originalName, mime: file.mimeType })),
    };
  }

  private presentQuote(quote: { id: string; number: string; odooSaleName: string | null; odooState: string | null; odooAmountUntaxed: Prisma.Decimal | null; odooAmountTax: Prisma.Decimal | null; odooAmountTotal: Prisma.Decimal | null; odooUrl: string | null; lines: Array<{ iso: string; type: string; priceNet: Prisma.Decimal }> }) {
    return {
      id: quote.id,
      number: quote.number,
      odooSaleName: quote.odooSaleName,
      odooState: quote.odooState,
      net: quote.odooAmountUntaxed == null ? null : Number(quote.odooAmountUntaxed),
      igv: quote.odooAmountTax == null ? null : Number(quote.odooAmountTax),
      total: quote.odooAmountTotal == null ? null : Number(quote.odooAmountTotal),
      url: quote.odooUrl,
      lines: quote.lines.map((line) => ({ iso: line.iso, type: line.type, priceNet: Number(line.priceNet) })),
    };
  }
}

type ShareRow = {
  id: string;
  token: string;
  vendorId: string;
  customerId: string | null;
  quoteId: string;
  clientName: string;
  clientCompany: string;
  clientEmail: string;
  clientPhone: string;
  ruc: string;
  dni: string;
  street: string;
  district: string;
  province: string;
  department: string;
  sunatState: string;
  sunatCondition: string;
};

function many(value: unknown): { id: number | null; name: string } {
  if (Array.isArray(value)) return { id: Number(value[0]) || null, name: String(value[1] || "") };
  if (typeof value === "number") return { id: value, name: "" };
  return { id: null, name: "" };
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isoOf(name: string, index: number) {
  const hit = name.toUpperCase().match(/[A-Z]{4}\d{7}/);
  return hit ? hit[0] : `OD${String(index + 1).padStart(2, "0")}`;
}
