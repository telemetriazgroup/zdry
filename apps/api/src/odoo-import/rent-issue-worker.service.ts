import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { QuotePdfService } from "./quote-pdf.service";
import { QuoteIssueWorker } from "./quote-issue-worker.service";
import { loadQuoteIssueConfig } from "./quote-issue.store";
import { normalizeOdooConfig, envOdooConfig, ODOO_CONFIG_KEY } from "../domain/odoo-config";
import { ZDRY_SYNC_CONTEXT, amountsMatchOdoo, many2oneId, odooFormUrl } from "../domain/quote-issue-draft";
import {
  RENT_ISSUE_EVENT,
  RENT_ISSUE_MAX_ATTEMPTS,
  QuoteRentDraftError,
  assertRentIssuable,
  buildRentSaleOrderVals,
  contractEndDate,
  pickRentFields,
  rentExpectedAmounts,
  type RentDraftInput,
} from "../domain/quote-rent-draft";

const SYNC = { context: { ...ZDRY_SYNC_CONTEXT } };

@Injectable()
export class RentIssueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RentIssueWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly quotePdf: QuotePdfService,
    private readonly saleIssue: QuoteIssueWorker,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log.warn(`rent_issue: ${(e as Error).message}`));
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
        where: { event: RENT_ISSUE_EVENT, status: "pending" },
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
      where: { quoteId, event: RENT_ISSUE_EVENT, status: { in: ["pending", "running"] } },
    });
    if (existing) return existing;
    return this.prisma.odooSyncJob.create({
      data: { quoteId, event: RENT_ISSUE_EVENT, payload: { quoteId }, status: "pending" },
    });
  }

  async runJob(jobId: string) {
    const job = await this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    if (!job || job.event !== RENT_ISSUE_EVENT) return job;
    if (job.status === "sent") return job;
    if (job.attempts >= RENT_ISSUE_MAX_ATTEMPTS && job.status === "error") return job;

    await this.prisma.odooSyncJob.update({
      where: { id: jobId },
      data: { status: "running", attempts: { increment: 1 } },
    });

    try {
      const result = await this.issueRent(job.quoteId);
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
          status: attempts >= RENT_ISSUE_MAX_ATTEMPTS ? "error" : "pending",
          lastError: message.slice(0, 500),
        },
      });
      await this.prisma.quoteEvent.create({
        data: { quoteId: job.quoteId, type: "odoo_error", detail: message.slice(0, 280) },
      });
      this.log.warn(`rent_issue ${job.quoteId}: ${message}`);
      return this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    }
  }

  private async issueRent(quoteId: string) {
    const q = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, vendor: true, lines: true },
    });
    if (!q) throw new Error("Cotización no encontrada.");
    if (q.odooSaleId) {
      return { saleId: q.odooSaleId, saleName: q.odooSaleName, skipped: "already_issued" };
    }

    const issueCfg = await loadQuoteIssueConfig(this.prisma);
    const draftIn: RentDraftInput[] = q.lines.map((l) => ({ iso: l.iso, type: l.type, cat: l.cat }));
    const rentPrice = q.rentPriceNet != null ? Number(q.rentPriceNet) : 0;
    let lines;
    try {
      lines = assertRentIssuable(q.kind, q.demo, issueCfg, draftIn, rentPrice);
    } catch (e) {
      if (e instanceof QuoteRentDraftError && (e.code === "sale" || e.code === "demo")) {
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

    const { partnerId, contactId } = await this.saleIssue.upsertPartner(q.customer, q.vendor.name);
    const userId = await this.saleIssue.findUserId(q.vendor.email);
    const fields = await this.saleIssue.saleFields();
    const now = new Date();
    const months = q.rentMonths || issueCfg.rentMonths || 12;
    let vals = buildRentSaleOrderVals({
      cfg: issueCfg,
      quoteNumber: q.number,
      partnerId,
      contactId,
      userId,
      email: q.customer.email || q.vendor.email,
      phone: q.customer.phone,
      deliveryPlace: q.dispatchNotes,
      lines,
      rentStart: q.rentStart || now,
      rentMonths: months,
      now,
    });
    vals = pickRentFields(fields.order, vals);
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
      throw new Error("Odoo no devolvió el id de la cotización de alquiler.");
    }

    try {
      const rows = await this.odoo.read("sale.order", [saleId], [
        "name",
        "state",
        "invoice_status",
        "amount_untaxed",
        "amount_tax",
        "amount_total",
        "plan_id",
        "start_date",
        "end_date",
        "subscription_id",
      ]);
      const so = rows[0] || {};
      if (String(so.state || "draft") === "sale") {
        throw new Error("La SO nació confirmada; Q6 no debe llamar action_confirm.");
      }
      const expected = rentExpectedAmounts(rentPrice, issueCfg.taxAmount);
      if (Number(so.amount_tax) === 0 && expected.tax > 0) {
        throw new Error("Odoo no aplicó el IGV 18 % al servicio de alquiler. Se anula el borrador.");
      }
      if (expected.tax > 0 && !amountsMatchOdoo(expected, so)) {
        this.log.warn(
          `alquiler ${q.number}: ZDRY tax=${expected.tax} total=${expected.total} vs Odoo tax=${so.amount_tax} total=${so.amount_total}`,
        );
      }

      const saleName = String(so.name || "");
      const url = odooFormUrl(odooCfg.url, "sale.order", saleId);
      const start = q.rentStart || now;
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
          odooPlanId: many2oneId(so.plan_id) || issueCfg.planId,
          odooSubscriptionId: many2oneId(so.subscription_id),
          rentMonths: months,
          rentStart: start,
          rentEnd: new Date(`${contractEndDate(start, months)}T00:00:00.000Z`),
          rentPriceNet: rentPrice,
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
          detail: `Alquiler Odoo ${saleName} (draft, cuota ${rentPrice} + ISO $0, ${expected.total} c/IGV).`,
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
          linesJson: { event: RENT_ISSUE_EVENT, saleName } as Prisma.InputJsonValue,
          diffJson: { state: { before: "", after: String(so.state || "draft") } } as Prisma.InputJsonValue,
        },
      });
      try {
        await this.quotePdf.capture(q.id);
      } catch (pdfErr) {
        this.log.warn(`PDF Q3 ${q.number}: ${(pdfErr as Error).message}`);
      }
      try {
        await this.quotePdf.captureCronograma(q.id);
      } catch (cronErr) {
        this.log.warn(`cronograma ${q.number}: ${(cronErr as Error).message}`);
        await this.prisma.quoteEvent.create({
          data: { quoteId: q.id, type: "odoo_cronograma_error", detail: ((cronErr as Error).message || "").slice(0, 280) },
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
}
