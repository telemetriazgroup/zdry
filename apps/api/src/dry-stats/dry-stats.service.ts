import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { StorageService } from "../storage/storage.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import {
  DRY_STATS_FIELDS,
  DRY_STATS_YEARS,
  baselineFromPresent,
  presentDryStats,
  rowFromOdoo,
  type DryDealRow,
  type DryStatsPresent,
} from "../domain/odoo-dry-stats";
import {
  DRY_DOSSIER_INV_FIELDS,
  DRY_DOSSIER_LINE_FIELDS,
  DRY_DOSSIER_MSG_FIELDS,
  DRY_DOSSIER_PICK_FIELDS,
  DRY_DOSSIER_SO_FIELDS,
  DRY_FILE_MAX_BYTES,
  fileFromOdoo,
  headerExtraFromOdoo,
  invoiceFromOdoo,
  lineFromOdoo,
  notesFromSaleMessages,
  paymentStateFromInvoices,
  pickingFromOdoo,
  relId,
  relName,
  type DryDealDocDraft,
  type DryDealFileDraft,
} from "../domain/odoo-dry-dossier";

const PAGE = 200;
const MAX = 4000;
const HYDRATE_BATCH = 30;

type BaselineJson = {
  at: string;
  label: string;
  ventaIngresos: number;
  alquilerIngresos: number;
  otrosIngresos?: number;
  amountIngresoUsd: number;
  amountIngresoPen: number;
};

export type DryHydrateState = {
  gen: number;
  status: "idle" | "running" | "done" | "error" | "cancelled";
  current: number;
  total: number;
  name: string;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
};

const IDLE_HYDRATE: DryHydrateState = {
  gen: 0,
  status: "idle",
  current: 0,
  total: 0,
  name: "",
  message: "",
  startedAt: null,
  finishedAt: null,
};

@Injectable()
export class DryStatsService {
  private readonly log = new Logger(DryStatsService.name);
  private hydrateGen = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async present(filter: { year?: string; kind?: string } = {}): Promise<DryStatsPresent & { hydrate: DryHydrateState }> {
    const where: Prisma.OdooDryDealWhereInput = {};
    if (filter.year) where.year = Number(filter.year);
    if (filter.kind === "venta" || filter.kind === "alquiler" || filter.kind === "otros") where.kind = filter.kind;
    const [deals, meta] = await Promise.all([
      this.prisma.odooDryDeal.findMany({ where, orderBy: { dateOrder: "desc" } }),
      this.meta(),
    ]);
    const rows: DryDealRow[] = deals.map((d) => ({
      odooId: d.odooId,
      name: d.name,
      kind: d.kind as DryDealRow["kind"],
      year: d.year,
      month: d.month,
      dateOrder: d.dateOrder.toISOString(),
      partnerName: d.partnerName,
      vendorName: d.vendorName,
      amountTotal: Number(d.amountTotal),
      amountUntaxed: Number(d.amountUntaxed),
      currency: d.currency,
      state: d.state,
      invoiceStatus: d.invoiceStatus,
      isSubscription: d.isSubscription,
      pipeline: d.pipeline as DryDealRow["pipeline"],
      asunto: d.asunto,
      otherReason: d.otherReason || "",
    }));
    return {
      ...presentDryStats(rows, {
        excludedByReason: (meta?.excluded as Record<string, number>) || {},
        fetchedAt: meta?.fetchedAt?.toISOString() || null,
        baseline: (meta?.baseline as BaselineJson) || null,
      }),
      hydrate: (meta?.hydrate as DryHydrateState) || IDLE_HYDRATE,
    };
  }

  async list(query: {
    year?: string;
    kind?: string;
    pipeline?: string;
    vendor?: string;
    month?: string;
    q?: string;
    take?: number;
    skip?: number;
  }) {
    const take = Math.min(Math.max(Number(query.take) || 80, 1), 300);
    const skip = Math.max(Number(query.skip) || 0, 0);
    const where: Prisma.OdooDryDealWhereInput = {};
    if (query.year) where.year = Number(query.year);
    if (query.kind === "venta" || query.kind === "alquiler" || query.kind === "otros") where.kind = query.kind;
    if (query.pipeline) where.pipeline = query.pipeline;
    if (query.vendor) where.vendorName = { contains: query.vendor, mode: "insensitive" };
    if (query.month) where.month = query.month;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { partnerName: { contains: q, mode: "insensitive" } },
        { vendorName: { contains: q, mode: "insensitive" } },
        { asunto: { contains: q, mode: "insensitive" } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.odooDryDeal.findMany({ where, orderBy: { dateOrder: "desc" }, take, skip }),
      this.prisma.odooDryDeal.count({ where }),
    ]);
    return {
      total,
      skip,
      take,
      rows: rows.map((d) => ({
        id: d.id,
        odooId: d.odooId,
        name: d.name,
        kind: d.kind,
        year: d.year,
        month: d.month,
        dateOrder: d.dateOrder,
        partnerName: d.partnerName,
        vendorName: d.vendorName,
        amountTotal: Number(d.amountTotal),
        currency: d.currency,
        pipeline: d.pipeline,
        asunto: d.asunto,
        otherReason: d.otherReason,
        paymentState: d.paymentState,
        dossierStatus: d.dossierStatus,
        outCount: d.outCount,
        inCount: d.inCount,
        invoiceCount: d.invoiceCount,
        noteCount: d.noteCount,
        fileCount: d.fileCount,
      })),
    };
  }

  async one(id: string) {
    const d = await this.prisma.odooDryDeal.findFirst({
      where: { OR: [{ id }, { name: id }] },
      include: {
        lines: { orderBy: { odooId: "asc" } },
        docs: { orderBy: { date: "desc" } },
        notes: { orderBy: { date: "desc" } },
        files: { orderBy: { kind: "asc" } },
      },
    });
    if (!d) throw new NotFoundException("Cotización DRY no está en el archivo local.");
    return {
      ...d,
      amountTotal: Number(d.amountTotal),
      amountUntaxed: Number(d.amountUntaxed),
      amountTax: Number(d.amountTax),
      lines: d.lines.map((l) => ({
        ...l,
        qty: Number(l.qty),
        qtyDelivered: Number(l.qtyDelivered),
        qtyInvoiced: Number(l.qtyInvoiced),
        priceUnit: Number(l.priceUnit),
        priceSubtotal: Number(l.priceSubtotal),
        discount: Number(l.discount),
      })),
      docs: d.docs.map((doc) => ({
        ...doc,
        amount: Number(doc.amount),
        isos: doc.isos ? doc.isos.split(/\s+/).filter(Boolean) : [],
      })),
    };
  }

  async importFromOdoo(user: AuthUser) {
    this.hydrateGen += 1;
    const excluded: Record<string, number> = {};
    const accepted: DryDealRow[] = [];
    let offset = 0;
    const domain = [
      "&",
      ["x_studio_asunto_cotizacion", "ilike", "dry"],
      "&",
      ["date_order", ">=", "2023-01-01 00:00:00"],
      ["date_order", "<", "2027-01-01 00:00:00"],
    ];
    while (offset < MAX) {
      const page = await this.odoo.searchRead("sale.order", domain, [...DRY_STATS_FIELDS], {
        limit: PAGE,
        offset,
        order: "date_order desc",
      });
      if (!page.length) break;
      for (const raw of page) {
        const parsed = rowFromOdoo(raw);
        if (!parsed.row) {
          excluded[parsed.reason] = (excluded[parsed.reason] || 0) + 1;
          continue;
        }
        if (!DRY_STATS_YEARS.includes(parsed.row.year)) {
          excluded.fuera_anio = (excluded.fuera_anio || 0) + 1;
          continue;
        }
        accepted.push(parsed.row);
      }
      offset += page.length;
      if (page.length < PAGE) break;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.odooDryDeal.deleteMany({});
      if (accepted.length) {
        await tx.odooDryDeal.createMany({
          data: accepted.map((d) => ({
            odooId: d.odooId,
            name: d.name,
            kind: d.kind,
            year: d.year,
            month: d.month,
            dateOrder: new Date(d.dateOrder),
            partnerName: d.partnerName,
            vendorName: d.vendorName,
            amountTotal: d.amountTotal,
            amountUntaxed: d.amountUntaxed,
            currency: d.currency,
            state: d.state,
            invoiceStatus: d.invoiceStatus,
            isSubscription: d.isSubscription,
            pipeline: d.pipeline,
            asunto: d.asunto,
            otherReason: d.otherReason,
            dossierStatus: "pending",
          })),
        });
      }
      await tx.odooDryStatsMeta.upsert({
        where: { id: "current" },
        create: { id: "current", fetchedAt: new Date(), fetchedBy: user.name, excluded, hydrate: IDLE_HYDRATE },
        update: { fetchedAt: new Date(), fetchedBy: user.name, excluded },
      });
    });

    this.log.log(`DRY stats: ${accepted.length} cabeceras. Hidratando expedientes…`);
    await this.audit.log({
      user,
      action: "sync",
      entity: "OdooDryDeal",
      entityId: "import",
      after: { accepted: accepted.length, excluded },
    });
    this.kickHydrate("all");
    return this.present();
  }

  async hydrateStatus(): Promise<DryHydrateState> {
    const meta = await this.meta();
    return (meta?.hydrate as DryHydrateState) || IDLE_HYDRATE;
  }

  async startHydrate(user: AuthUser) {
    const total = await this.prisma.odooDryDeal.count();
    if (!total) throw new NotFoundException("Primero trae las cabeceras de Odoo.");
    const pendingText = await this.prisma.odooDryDeal.count({ where: { dossierStatus: { not: "ok" } } });
    this.kickHydrate(pendingText === 0 ? "files" : "all");
    await this.audit.log({ user, action: "sync", entity: "OdooDryDeal", entityId: "hydrate", after: { total, pendingText } });
    return this.hydrateStatus();
  }

  async openFile(dealId: string, fileId: string) {
    const file = await this.prisma.odooDryDealFile.findFirst({
      where: { id: fileId, dealId },
    });
    if (!file) throw new NotFoundException("Archivo no está en el expediente.");
    if (file.storageKey) {
      try {
        const obj = await this.storage.getBuffer(file.storageKey);
        return { buffer: obj.buffer, contentType: obj.contentType || file.mimetype, name: file.name };
      } catch {
        /* baja de Odoo si MinIO no lo tiene */
      }
    }
    const recs = await this.odoo.read("ir.attachment", [file.odooAttId], ["name", "mimetype", "datas"]);
    const rec = recs?.[0];
    if (!rec?.datas) throw new NotFoundException("Odoo no devolvió el archivo.");
    const buffer = Buffer.from(String(rec.datas), "base64");
    const key = `dry-stats/${dealId}/${file.odooAttId}-${safeFileName(file.name)}`;
    await this.storage.put(key, buffer, file.mimetype || "application/octet-stream");
    await this.prisma.odooDryDealFile.update({ where: { id: file.id }, data: { storageKey: key, size: buffer.length } });
    return { buffer, contentType: String(rec.mimetype || file.mimetype || "application/octet-stream"), name: file.name };
  }

  async markBaseline(user: AuthUser, label?: string) {
    const current = await this.present();
    const baseline = baselineFromPresent(current, label || "Antes de ZDRY");
    await this.prisma.odooDryStatsMeta.upsert({
      where: { id: "current" },
      create: { id: "current", baseline, fetchedAt: current.fetchedAt ? new Date(current.fetchedAt) : new Date() },
      update: { baseline },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "OdooDryStatsMeta",
      entityId: "baseline",
      after: baseline,
    });
    return this.present();
  }

  private kickHydrate(mode: "all" | "files" = "all") {
    this.hydrateGen += 1;
    const gen = this.hydrateGen;
    void this.runHydrate(gen, mode).catch((e) => this.log.error(`hydrate: ${(e as Error).message}`));
  }

  private async runHydrate(gen: number, mode: "all" | "files" = "all") {
    const total = await this.prisma.odooDryDeal.count();
    await this.writeHydrate({
      gen,
      status: "running",
      current: 0,
      total,
      name: "",
      message: mode === "files" ? "Bajando imágenes y documentos…" : "Bajando líneas, despachos, facturas, notas y archivos…",
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    let soFields: string[] = [...DRY_DOSSIER_SO_FIELDS];
    let lineFields: string[] = [...DRY_DOSSIER_LINE_FIELDS];
    try {
      soFields = await this.available("sale.order", DRY_DOSSIER_SO_FIELDS);
      lineFields = await this.available("sale.order.line", DRY_DOSSIER_LINE_FIELDS);
    } catch (e) {
      this.log.warn(`fields_get: ${(e as Error).message}`);
    }

    let done = 0;
    let skip = 0;
    while (skip < total) {
      if (gen !== this.hydrateGen) {
        await this.writeHydrate({ gen, status: "cancelled", current: done, total, name: "", message: "Cancelado por una importación nueva.", startedAt: null, finishedAt: new Date().toISOString() });
        return;
      }
      const batch = await this.prisma.odooDryDeal.findMany({
        orderBy: { dateOrder: "desc" },
        skip,
        take: HYDRATE_BATCH,
        select: { id: true, odooId: true, name: true },
      });
      if (!batch.length) break;
      try {
        if (mode === "all") await this.hydrateBatch(batch, soFields, lineFields);
        else await this.hydrateFilesForDeals(batch);
      } catch (e) {
        const msg = (e as Error).message || "error de lote";
        this.log.warn(`hydrate lote ${batch[0]?.name}: ${msg}`);
        await this.prisma.odooDryDeal.updateMany({
          where: { id: { in: batch.map((b) => b.id) } },
          data: { dossierStatus: "error", dossierError: msg.slice(0, 500) },
        });
      }
      done += batch.length;
      skip += batch.length;
      await this.writeHydrate({
        gen,
        status: "running",
        current: done,
        total,
        name: batch[batch.length - 1]?.name || "",
        message: `${done} / ${total} expedientes`,
        startedAt: null,
        finishedAt: null,
      });
    }
    if (gen !== this.hydrateGen) return;
    await this.writeHydrate({
      gen,
      status: "done",
      current: total,
      total,
      name: "",
      message: "Archivo local listo. Las consultas ya no van a Odoo.",
      startedAt: null,
      finishedAt: new Date().toISOString(),
    });
  }

  private async hydrateBatch(
    batch: Array<{ id: string; odooId: number; name: string }>,
    soFields: string[],
    lineFields: string[],
  ) {
    const ids = batch.map((b) => b.odooId);
    const byOdoo = new Map(batch.map((b) => [b.odooId, b]));
    const orders = await this.odoo.searchRead("sale.order", [["id", "in", ids]], soFields, { limit: ids.length });
    const partnerIds = [...new Set(orders.map((o) => relId(o.partner_id)).filter(Boolean))];
    const partners = partnerIds.length
      ? await this.odoo.searchRead("res.partner", [["id", "in", partnerIds]], ["id", "vat", "name"], { limit: partnerIds.length })
      : [];
    const vatByPartner = new Map(partners.map((p) => [Number(p.id), String(p.vat || "")]));

    const lines = await this.odoo.searchRead("sale.order.line", [["order_id", "in", ids]], lineFields, { limit: 2000 });

    const pickIds = [
      ...new Set(
        orders.flatMap((o) => (Array.isArray(o.picking_ids) ? (o.picking_ids as number[]) : [])).filter((n) => Number(n) > 0),
      ),
    ];
    let pickings = pickIds.length
      ? await this.odoo.searchRead("stock.picking", [["id", "in", pickIds]], [...DRY_DOSSIER_PICK_FIELDS], { limit: 800 })
      : [];
    if (!pickings.length) {
      pickings = await this.odoo.searchRead("stock.picking", [["sale_id", "in", ids]], [...DRY_DOSSIER_PICK_FIELDS], { limit: 800 });
    }
    const realPickIds = pickings.map((p) => Number(p.id)).filter(Boolean);
    const moveLines = realPickIds.length
      ? await this.odoo.searchRead("stock.move.line", [["picking_id", "in", realPickIds]], ["picking_id", "lot_id"], { limit: 4000 })
      : [];
    const isosByPick = new Map<number, string[]>();
    for (const ml of moveLines) {
      const pid = relId(ml.picking_id);
      const iso = relName(ml.lot_id);
      if (!pid || !iso) continue;
      const list = isosByPick.get(pid) || [];
      if (!list.includes(iso)) list.push(iso);
      isosByPick.set(pid, list);
    }

    const invIds = [
      ...new Set(
        orders.flatMap((o) => (Array.isArray(o.invoice_ids) ? (o.invoice_ids as number[]) : [])).filter((n) => Number(n) > 0),
      ),
    ];
    const invoices = invIds.length
      ? await this.odoo.searchRead("account.move", [["id", "in", invIds]], [...DRY_DOSSIER_INV_FIELDS], { limit: 800 })
      : [];

    const messages = await this.odoo.searchRead(
      "mail.message",
      ["&", ["model", "=", "sale.order"], ["res_id", "in", ids]],
      [...DRY_DOSSIER_MSG_FIELDS],
      { limit: 2500, order: "date desc" },
    );

    const linesByOrder = new Map<number, typeof lines>();
    for (const line of lines) {
      const oid = relId(line.order_id);
      const list = linesByOrder.get(oid) || [];
      list.push(line);
      linesByOrder.set(oid, list);
    }
    const picksByOrder = new Map<number, typeof pickings>();
    for (const p of pickings) {
      const oid = relId(p.sale_id) || this.orderIdFromPicking(p, orders);
      if (!oid) continue;
      const list = picksByOrder.get(oid) || [];
      list.push(p);
      picksByOrder.set(oid, list);
    }
    const invById = new Map(invoices.map((i) => [Number(i.id), i]));
    const msgsByOrder = new Map<number, typeof messages>();
    for (const m of messages) {
      const oid = Number(m.res_id) || 0;
      const list = msgsByOrder.get(oid) || [];
      list.push(m);
      msgsByOrder.set(oid, list);
    }

    for (const order of orders) {
      const oid = Number(order.id);
      const deal = byOdoo.get(oid);
      if (!deal) continue;
      const extra = headerExtraFromOdoo(order, vatByPartner.get(relId(order.partner_id)) || "");
      const dealLines = (linesByOrder.get(oid) || []).map(lineFromOdoo).filter((l) => l.odooId);
      const dealDocs: DryDealDocDraft[] = [];
      for (const p of picksByOrder.get(oid) || []) {
        dealDocs.push(pickingFromOdoo(p, isosByPick.get(Number(p.id)) || []));
      }
      const orderInvIds = Array.isArray(order.invoice_ids) ? (order.invoice_ids as number[]) : [];
      for (const iid of orderInvIds) {
        const inv = invById.get(Number(iid));
        if (inv) dealDocs.push(invoiceFromOdoo(inv));
      }
      const dealNotes = notesFromSaleMessages(msgsByOrder.get(oid) || []);
      extra.paymentState = paymentStateFromInvoices(dealDocs) || extra.paymentState;
      await this.prisma.$transaction(async (tx) => {
        await tx.odooDryDealLine.deleteMany({ where: { dealId: deal.id } });
        await tx.odooDryDealDoc.deleteMany({ where: { dealId: deal.id } });
        await tx.odooDryDealNote.deleteMany({ where: { dealId: deal.id } });
        if (dealLines.length) {
          await tx.odooDryDealLine.createMany({
            data: dealLines.map((l) => ({
              dealId: deal.id,
              odooId: l.odooId,
              productCode: l.productCode,
              productName: l.productName,
              description: l.description,
              qty: l.qty,
              qtyDelivered: l.qtyDelivered,
              qtyInvoiced: l.qtyInvoiced,
              priceUnit: l.priceUnit,
              priceSubtotal: l.priceSubtotal,
              discount: l.discount,
              tax: l.tax,
              lotName: l.lotName,
              studioTipo: l.studioTipo,
              studioEquipo: l.studioEquipo,
              displayType: l.displayType,
            })),
          });
        }
        if (dealDocs.length) {
          await tx.odooDryDealDoc.createMany({
            data: dealDocs.map((doc) => ({
              dealId: deal.id,
              kind: doc.kind,
              odooModel: doc.odooModel,
              odooId: doc.odooId,
              name: doc.name,
              state: doc.state,
              date: asDate(doc.date),
              amount: doc.amount,
              currency: doc.currency,
              paymentState: doc.paymentState,
              isos: doc.isos.join(" "),
              summary: doc.summary,
            })),
          });
        }
        if (dealNotes.length) {
          await tx.odooDryDealNote.createMany({
            data: dealNotes.map((n) => ({
              dealId: deal.id,
              odooMsgId: n.odooMsgId,
              body: n.body,
              author: n.author,
              date: asDate(n.date),
              messageType: n.messageType,
            })),
          });
        }
        await tx.odooDryDeal.update({
          where: { id: deal.id },
          data: {
            partnerVat: extra.partnerVat,
            paymentTerm: extra.paymentTerm,
            warehouse: extra.warehouse,
            validityDate: asDate(extra.validityDate),
            opportunityName: extra.opportunityName,
            clientRef: extra.clientRef,
            amountTax: extra.amountTax,
            paymentState: extra.paymentState,
            note: extra.note,
            dossierStatus: "ok",
            dossierAt: new Date(),
            dossierError: "",
            outCount: dealDocs.filter((d) => d.kind === "picking_out").length,
            inCount: dealDocs.filter((d) => d.kind === "picking_in").length,
            invoiceCount: dealDocs.filter((d) => d.kind === "invoice" || d.kind === "refund").length,
            noteCount: dealNotes.length,
          },
        });
      });
    }
    await this.hydrateFilesForDeals(batch, messages, invoices);
  }

  private async hydrateFilesForDeals(
    batch: Array<{ id: string; odooId: number; name: string }>,
    messages?: Record<string, unknown>[],
    invoices?: Record<string, unknown>[],
  ) {
    const ids = batch.map((b) => b.odooId);
    const byOdoo = new Map(batch.map((b) => [b.odooId, b]));
    const msgRows =
      messages ||
      (await this.odoo.searchRead(
        "mail.message",
        ["&", ["model", "=", "sale.order"], ["res_id", "in", ids]],
        [...DRY_DOSSIER_MSG_FIELDS],
        { limit: 2500, order: "date desc" },
      ));
    const extraIds = [
      ...new Set(msgRows.flatMap((m) => (Array.isArray(m.attachment_ids) ? (m.attachment_ids as number[]) : [])).filter((n) => Number(n) > 0)),
    ];
    const invIds = invoices?.map((i) => Number(i.id)).filter(Boolean) || [];
    const domain: unknown[] = ["&", ["res_model", "=", "sale.order"], ["res_id", "in", ids]];
    if (extraIds.length && invIds.length) {
      domain.unshift("|", "|");
      domain.push("&", ["res_model", "=", "account.move"], ["res_id", "in", invIds], ["id", "in", extraIds]);
    } else if (extraIds.length) {
      domain.unshift("|");
      domain.push(["id", "in", extraIds]);
    } else if (invIds.length) {
      domain.unshift("|");
      domain.push("&", ["res_model", "=", "account.move"], ["res_id", "in", invIds]);
    }
    const atts = await this.odoo.searchRead(
      "ir.attachment",
      domain,
      ["id", "name", "mimetype", "file_size", "res_model", "res_id"],
      { limit: 800 },
    );
    const msgToOrder = new Map<number, number>();
    for (const m of msgRows) {
      const mid = Number(m.id);
      const oid = Number(m.res_id);
      if (mid && oid) msgToOrder.set(mid, oid);
    }
    const filesByOrder = new Map<number, DryDealFileDraft[]>();
    for (const raw of atts) {
      const source = String(raw.res_model || "so");
      const draft = fileFromOdoo(raw, source.includes("account") ? "invoice" : source.includes("mail") ? "message" : "so");
      if (!draft?.odooAttId) continue;
      let oid = 0;
      if (raw.res_model === "sale.order") oid = Number(raw.res_id) || 0;
      else if (raw.res_model === "mail.message") oid = msgToOrder.get(Number(raw.res_id)) || 0;
      else if (raw.res_model === "account.move") {
        const inv = (invoices || []).find((i) => Number(i.id) === Number(raw.res_id));
        oid = inv ? this.orderIdFromInvoice(inv, batch) : 0;
      }
      if (!oid && extraIds.includes(draft.odooAttId)) {
        const msg = msgRows.find((m) => Array.isArray(m.attachment_ids) && (m.attachment_ids as number[]).includes(draft.odooAttId));
        oid = msg ? Number(msg.res_id) : 0;
      }
      if (!oid || !byOdoo.has(oid)) continue;
      const list = filesByOrder.get(oid) || [];
      if (list.some((f) => f.odooAttId === draft.odooAttId)) continue;
      list.push(draft);
      filesByOrder.set(oid, list);
    }

    for (const deal of batch) {
      const drafts = (filesByOrder.get(deal.odooId) || []).slice(0, 16);
      const keep = drafts.map((f) => f.odooAttId);
      if (keep.length) {
        await this.prisma.odooDryDealFile.deleteMany({ where: { dealId: deal.id, odooAttId: { notIn: keep } } });
      }
      for (const f of drafts) {
        await this.prisma.odooDryDealFile.upsert({
          where: { dealId_odooAttId: { dealId: deal.id, odooAttId: f.odooAttId } },
          create: {
            dealId: deal.id,
            odooAttId: f.odooAttId,
            name: f.name,
            mimetype: f.mimetype,
            size: f.size,
            kind: f.kind,
            source: f.source,
          },
          update: { name: f.name, mimetype: f.mimetype, size: f.size, kind: f.kind, source: f.source },
        });
      }
      const stored = await this.prisma.odooDryDealFile.findMany({ where: { dealId: deal.id } });
      for (const file of stored) {
        if (file.storageKey || file.size > DRY_FILE_MAX_BYTES) continue;
        try {
          const recs = await this.odoo.read("ir.attachment", [file.odooAttId], ["datas", "mimetype", "name"]);
          const rec = recs?.[0];
          if (!rec?.datas) continue;
          const buffer = Buffer.from(String(rec.datas), "base64");
          if (!buffer.length) continue;
          const key = `dry-stats/${deal.id}/${file.odooAttId}-${safeFileName(file.name)}`;
          await this.storage.put(key, buffer, file.mimetype || "application/octet-stream");
          await this.prisma.odooDryDealFile.update({
            where: { id: file.id },
            data: { storageKey: key, size: buffer.length, mimetype: String(rec.mimetype || file.mimetype) },
          });
        } catch (e) {
          this.log.warn(`archivo ${file.name} SO ${deal.name}: ${(e as Error).message}`);
        }
      }
      await this.prisma.odooDryDeal.update({
        where: { id: deal.id },
        data: { fileCount: stored.length },
      });
    }
  }

  private orderIdFromInvoice(inv: Record<string, unknown>, batch: Array<{ odooId: number; name: string }>): number {
    const origin = String(inv.invoice_origin || "");
    const hit = batch.find((b) => origin.includes(b.name));
    return hit?.odooId || 0;
  }

  private orderIdFromPicking(p: Record<string, unknown>, orders: Record<string, unknown>[]): number {
    const origin = String(p.origin || "");
    const hit = orders.find((o) => origin.includes(String(o.name || "___never___")));
    return hit ? Number(hit.id) : 0;
  }

  private async available(model: string, wanted: readonly string[]) {
    const all = await this.odoo.fieldsGet(model);
    const have = wanted.filter((f) => Boolean(all[f]));
    return have.length ? have : [...wanted];
  }

  private async writeHydrate(patch: Partial<DryHydrateState>) {
    const cur = await this.hydrateStatus();
    const next: DryHydrateState = {
      ...cur,
      ...patch,
      startedAt: patch.startedAt === null ? cur.startedAt : patch.startedAt ?? cur.startedAt,
    };
    await this.prisma.odooDryStatsMeta.upsert({
      where: { id: "current" },
      create: { id: "current", hydrate: next },
      update: { hydrate: next },
    });
  }

  private meta() {
    return this.prisma.odooDryStatsMeta.findUnique({ where: { id: "current" } });
  }
}

function asDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeFileName(name: string) {
  return String(name || "archivo")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
}
