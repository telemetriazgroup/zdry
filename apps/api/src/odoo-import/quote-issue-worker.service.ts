import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { QuotePdfService } from "./quote-pdf.service";
import { loadQuoteIssueConfig } from "./quote-issue.store";
import { normalizeOdooConfig, envOdooConfig, ODOO_CONFIG_KEY } from "../domain/odoo-config";
import {
  QUOTE_ISSUE_EVENT,
  QUOTE_ISSUE_MAX_ATTEMPTS,
  QuoteIssueDraftError,
  ZDRY_SYNC_CONTEXT,
  amountsMatchOdoo,
  assertIssuable,
  buildSaleOrderVals,
  expectedAmounts,
  many2oneId,
  odooFormUrl,
  pickStudio,
  type DraftLineIn,
  type DraftLineOut,
} from "../domain/quote-issue-draft";

const SYNC = { context: { ...ZDRY_SYNC_CONTEXT } };

@Injectable()
export class QuoteIssueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QuoteIssueWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private fieldsCache: { at: number; order: Record<string, unknown>; line: Record<string, unknown> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly quotePdf: QuotePdfService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log.warn(`quote_issue: ${(e as Error).message}`));
    }, 12_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.busy) return;
    const cfg = await this.odoo.readConfig();
    if (!cfg.enabled || !cfg.url) return;
    this.busy = true;
    try {
      const jobs = await this.prisma.odooSyncJob.findMany({
        where: { event: QUOTE_ISSUE_EVENT, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 3,
      });
      for (const job of jobs) {
        await this.runJob(job.id);
      }
    } finally {
      this.busy = false;
    }
  }

  async retry(jobId: string) {
    const job = await this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("Trabajo no encontrado.");
    await this.prisma.odooSyncJob.update({
      where: { id: jobId },
      data: { status: "pending", lastError: null, attempts: 0 },
    });
    return this.runJob(jobId);
  }

  async enqueue(quoteId: string) {
    const existing = await this.prisma.odooSyncJob.findFirst({
      where: { quoteId, event: QUOTE_ISSUE_EVENT, status: { in: ["pending", "running"] } },
    });
    if (existing) return existing;
    return this.prisma.odooSyncJob.create({
      data: { quoteId, event: QUOTE_ISSUE_EVENT, payload: { quoteId }, status: "pending" },
    });
  }

  async runJob(jobId: string) {
    const job = await this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    if (!job || job.event !== QUOTE_ISSUE_EVENT) return job;
    if (job.status === "sent") return job;
    if (job.attempts >= QUOTE_ISSUE_MAX_ATTEMPTS && job.status === "error") return job;

    await this.prisma.odooSyncJob.update({
      where: { id: jobId },
      data: { status: "running", attempts: { increment: 1 } },
    });

    try {
      const result = await this.issueQuote(job.quoteId);
      await this.prisma.odooSyncJob.update({
        where: { id: jobId },
        data: { status: "sent", lastError: null, payload: result as Prisma.InputJsonValue },
      });
      return this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    } catch (e) {
      const message = (e as Error).message || String(e);
      const attempts = job.attempts + 1;
      await this.prisma.odooSyncJob.update({
        where: { id: jobId },
        data: {
          status: attempts >= QUOTE_ISSUE_MAX_ATTEMPTS ? "error" : "pending",
          lastError: message.slice(0, 500),
        },
      });
      await this.prisma.quoteEvent.create({
        data: { quoteId: job.quoteId, type: "odoo_error", detail: message.slice(0, 280) },
      });
      this.log.warn(`quote_issue ${job.quoteId}: ${message}`);
      return this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    }
  }

  private async issueQuote(quoteId: string) {
    const q = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, vendor: true, lines: true },
    });
    if (!q) throw new Error("Cotización no encontrada.");
    if (q.odooSaleId) {
      return {
        saleId: q.odooSaleId,
        saleName: q.odooSaleName,
        skipped: "already_issued",
      };
    }

    const issueCfg = await loadQuoteIssueConfig(this.prisma);
    const draftLinesIn: DraftLineIn[] = q.lines.map((l) => ({
      iso: l.iso,
      type: l.type,
      cat: l.cat,
      priceNet: Number(l.priceNet),
    }));
    let lines: DraftLineOut[];
    try {
      lines = assertIssuable(q.kind, q.demo, issueCfg, draftLinesIn);
    } catch (e) {
      if (e instanceof QuoteIssueDraftError && (e.code === "rental" || e.code === "demo")) {
        await this.prisma.quoteEvent.create({
          data: { quoteId: q.id, type: "odoo_skip", detail: e.message },
        });
        return { saleId: null, skipped: e.code };
      }
      throw e;
    }

    const odooCfg = normalizeOdooConfig(
      (await this.prisma.appSetting.findUnique({ where: { key: ODOO_CONFIG_KEY } }))?.value,
      envOdooConfig(),
    );

    const { partnerId, contactId } = await this.upsertPartner(q.customer, q.vendor.name);
    const userId = await this.findUserId(q.vendor.email);
    const fields = await this.saleFields();
    let vals = buildSaleOrderVals({
      cfg: issueCfg,
      quoteNumber: q.number,
      kind: q.kind,
      partnerId,
      contactId,
      userId,
      email: q.customer.email || q.vendor.email,
      phone: q.customer.phone,
      deliveryPlace: q.dispatchNotes,
      lines,
    });
    vals = pickStudio(fields.order, vals);
    if (Array.isArray(vals.order_line)) {
      vals.order_line = (vals.order_line as unknown[]).map((cmd) => {
        const tuple = cmd as [number, number, Record<string, unknown>];
        const lv = { ...tuple[2] };
        if (fields.line && !("x_studio_tipo" in fields.line)) delete lv.x_studio_tipo;
        return [tuple[0], tuple[1], lv];
      });
    }

    const created = await this.odoo.create("sale.order", vals, SYNC);
    const saleId = Number(created);
    if (!Number.isFinite(saleId) || saleId <= 0) {
      throw new Error("Odoo no devolvió el id de la cotización.");
    }

    try {
      const rows = await this.odoo.read("sale.order", [saleId], [
        "name",
        "state",
        "invoice_status",
        "amount_untaxed",
        "amount_tax",
        "amount_total",
      ]);
      const so = rows[0] || {};
      if (String(so.state || "draft") === "sale") {
        throw new Error("La SO nació confirmada; Q2 no debe llamar action_confirm.");
      }
      const net = lines.reduce((s, l) => s + l.priceUnit * l.productUomQty, 0);
      const expected = expectedAmounts(net, issueCfg.taxAmount);
      if (Number(so.amount_tax) === 0 && expected.tax > 0) {
        throw new Error("Odoo no aplicó el IGV 18 %. Se anula el borrador para no dejar una SO a medias.");
      }
      if (!amountsMatchOdoo(expected, so)) {
        this.log.warn(
          `montos ${q.number}: ZDRY tax=${expected.tax} total=${expected.total} vs Odoo tax=${so.amount_tax} total=${so.amount_total}`,
        );
      }

      const saleName = String(so.name || "");
      const url = odooFormUrl(odooCfg.url, "sale.order", saleId);
      await this.prisma.quote.update({
        where: { id: q.id },
        data: {
          odooSaleId: saleId,
          odooSaleName: saleName,
          odooState: String(so.state || "draft"),
          odooInvoiceStatus: so.invoice_status ? String(so.invoice_status) : null,
          odooAmountUntaxed: Number(so.amount_untaxed) || expected.untaxed,
          odooAmountTax: Number(so.amount_tax) || expected.tax,
          odooAmountTotal: Number(so.amount_total) || expected.total,
          odooUrl: url,
          odooPartnerId: partnerId,
        },
      });
      await this.prisma.customer.update({
        where: { id: q.customerId },
        data: { odooPartnerId: partnerId, odooContactId: contactId },
      });
      await this.prisma.quoteEvent.create({
        data: {
          quoteId: q.id,
          type: "odoo_draft",
          detail: `Presupuesto Odoo ${saleName} (draft, ${expected.total} c/IGV).`,
        },
      });
      await this.prisma.quoteOdooRevision.create({
        data: {
          quoteId: q.id,
          source: "zdry",
          state: String(so.state || "draft"),
          invoiceStatus: so.invoice_status ? String(so.invoice_status) : null,
          amountUntaxed: Number(so.amount_untaxed) || expected.untaxed,
          amountTax: Number(so.amount_tax) || expected.tax,
          amountTotal: Number(so.amount_total) || expected.total,
          linesJson: { event: QUOTE_ISSUE_EVENT, saleName } as Prisma.InputJsonValue,
          diffJson: { state: { before: "", after: String(so.state || "draft") } } as Prisma.InputJsonValue,
        },
      });
      try {
        await this.quotePdf.capture(q.id);
      } catch (pdfErr) {
        this.log.warn(`PDF Q3 ${q.number}: ${(pdfErr as Error).message}`);
        await this.prisma.quoteEvent.create({
          data: { quoteId: q.id, type: "odoo_pdf_error", detail: ((pdfErr as Error).message || "").slice(0, 280) },
        });
      }
      return {
        saleId,
        saleName,
        state: so.state,
        amountUntaxed: so.amount_untaxed,
        amountTax: so.amount_tax,
        amountTotal: so.amount_total,
        expected,
      };
    } catch (e) {
      try {
        await this.odoo.unlink("sale.order", [saleId], SYNC);
      } catch (unlinkErr) {
        this.log.warn(`no se pudo borrar SO ${saleId}: ${(unlinkErr as Error).message}`);
      }
      throw e;
    }
  }

  async saleFields() {
    const now = Date.now();
    if (this.fieldsCache && now - this.fieldsCache.at < 10 * 60 * 1000) return this.fieldsCache;
    const [order, line] = await Promise.all([
      this.odoo.fieldsGet("sale.order"),
      this.odoo.fieldsGet("sale.order.line"),
    ]);
    this.fieldsCache = { at: now, order: order as Record<string, unknown>, line: line as Record<string, unknown> };
    return this.fieldsCache;
  }

  async findUserId(email: string): Promise<number | null> {
    const login = (email || "").trim().toLowerCase();
    if (!login) return null;
    try {
      const rows = await this.odoo.searchRead(
        "res.users",
        ["|", ["login", "=", login], ["login", "ilike", login]],
        ["id", "login"],
        { limit: 1 },
      );
      return many2oneId(rows[0]?.id);
    } catch {
      return null;
    }
  }

  async upsertPartner(
    customer: {
      id: string;
      rucDni: string;
      companyName: string;
      email: string;
      phone: string;
      street?: string;
      district?: string;
      province?: string;
      odooPartnerId?: number | null;
      odooContactId?: number | null;
    },
    contactName: string,
  ): Promise<{ partnerId: number; contactId: number | null }> {
    const vat = String(customer.rucDni || "").replace(/\D/g, "");
    const issueCfg = await loadQuoteIssueConfig(this.prisma);
    let countryId: number | null = null;
    try {
      const pe = await this.odoo.searchRead("res.country", [["code", "=", "PE"]], ["id"], { limit: 1 });
      countryId = many2oneId(pe[0]?.id);
    } catch {
      countryId = null;
    }

    const partnerVals: Record<string, unknown> = {
      name: customer.companyName,
      vat,
      company_type: "company",
      is_company: true,
      customer_rank: 1,
      email: customer.email || false,
      phone: customer.phone || false,
      street: customer.street || false,
      city: customer.province || customer.district || false,
    };
    if (issueCfg.identificationTypeId) partnerVals.l10n_latam_identification_type_id = issueCfg.identificationTypeId;
    if (countryId) partnerVals.country_id = countryId;

    let partnerId = customer.odooPartnerId || null;
    if (partnerId) {
      try {
        await this.odoo.write("res.partner", [partnerId], partnerVals, SYNC);
      } catch {
        partnerId = null;
      }
    }
    if (!partnerId) {
      const found = await this.odoo.searchRead(
        "res.partner",
        [
          ["vat", "=", vat],
          ["parent_id", "=", false],
        ],
        ["id"],
        { limit: 1 },
      );
      partnerId = many2oneId(found[0]?.id);
      if (partnerId) {
        await this.odoo.write("res.partner", [partnerId], partnerVals, SYNC);
      } else {
        partnerId = Number(await this.odoo.create("res.partner", partnerVals, SYNC));
      }
    }
    if (!Number.isFinite(partnerId) || partnerId <= 0) throw new Error("No se pudo crear/actualizar el cliente en Odoo.");

    const childName = (contactName || "").trim() || customer.companyName;
    const childVals: Record<string, unknown> = {
      name: childName,
      parent_id: partnerId,
      type: "contact",
      company_type: "person",
      email: customer.email || false,
      phone: customer.phone || false,
    };
    let contactId = customer.odooContactId || null;
    if (contactId) {
      try {
        await this.odoo.write("res.partner", [contactId], childVals, SYNC);
      } catch {
        contactId = null;
      }
    }
    if (!contactId) {
      const kids = await this.odoo.searchRead(
        "res.partner",
        [
          ["parent_id", "=", partnerId],
          ["type", "=", "contact"],
        ],
        ["id", "name"],
        { limit: 5 },
      );
      const hit = kids.find((k) => String(k.name || "").toLowerCase() === childName.toLowerCase()) || kids[0];
      contactId = many2oneId(hit?.id);
      if (contactId) {
        await this.odoo.write("res.partner", [contactId], childVals, SYNC);
      } else {
        contactId = Number(await this.odoo.create("res.partner", childVals, SYNC));
      }
    }
    return { partnerId, contactId: contactId && contactId > 0 ? contactId : null };
  }
}
