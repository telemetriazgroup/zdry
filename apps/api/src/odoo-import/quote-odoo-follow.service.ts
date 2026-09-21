import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  isosFromPayload,
  quotePatchFromOdooEvent,
  saleIdsFromInvoicePayload,
  saleNamesFromPayload,
  shouldFollowOdooEvent,
  type QuoteFollowPatch,
} from "../domain/quote-odoo-follow";
import { snapshotDiff, type SaleSnapshot } from "../domain/quote-amend";
import { followDiffJson, followLinesJson } from "../domain/quote-odoo-timeline";

@Injectable()
export class QuoteOdooFollowService {
  private readonly log = new Logger(QuoteOdooFollowService.name);

  constructor(private readonly prisma: PrismaService) {}

  async applyEvent(input: {
    event: string;
    origin?: string | null;
    model?: string | null;
    resId?: number | null;
    payload?: Record<string, unknown> | null;
  }) {
    if (!shouldFollowOdooEvent(input.origin)) return { skipped: "anti-eco" as const };
    const patch = quotePatchFromOdooEvent(input);
    if (!patch) return { skipped: "no_patch" as const };
    const quote = await this.findQuote(input);
    if (!quote) return { skipped: "no_quote" as const };
    const before: SaleSnapshot = {
      state: quote.odooState || "",
      invoiceStatus: quote.odooInvoiceStatus || "",
      amountUntaxed: Number(quote.odooAmountUntaxed || 0),
      amountTax: Number(quote.odooAmountTax || 0),
      amountTotal: Number(quote.odooAmountTotal || 0),
      lines: [],
    };
    const data: Prisma.QuoteUpdateInput = {};
    if (patch.odooState != null) data.odooState = patch.odooState;
    if (patch.odooInvoiceStatus != null) data.odooInvoiceStatus = patch.odooInvoiceStatus;
    if (patch.odooInvoiceName !== undefined) data.odooInvoiceName = patch.odooInvoiceName;
    if (patch.odooInvoiceId !== undefined) data.odooInvoiceId = patch.odooInvoiceId;
    if (patch.odooPickingName !== undefined) data.odooPickingName = patch.odooPickingName;
    if (patch.odooPickingId !== undefined) data.odooPickingId = patch.odooPickingId;
    if (patch.odooPickingState !== undefined) data.odooPickingState = patch.odooPickingState;
    if (patch.odooPickingInName !== undefined) data.odooPickingInName = patch.odooPickingInName;
    if (patch.odooPickingInId !== undefined) data.odooPickingInId = patch.odooPickingInId;
    if (patch.odooPickingInState !== undefined) data.odooPickingInState = patch.odooPickingInState;
    if (patch.odooAmountUntaxed != null) data.odooAmountUntaxed = patch.odooAmountUntaxed;
    if (patch.odooAmountTax != null) data.odooAmountTax = patch.odooAmountTax;
    if (patch.odooAmountTotal != null) data.odooAmountTotal = patch.odooAmountTotal;
    if (!Object.keys(data).length && !patch.installment?.odooMoveId) return { skipped: "empty" as const };
    const updated = Object.keys(data).length
      ? await this.prisma.quote.update({ where: { id: quote.id }, data })
      : quote;
    if (patch.installment?.odooMoveId) {
      const invDate = this.parseDay(patch.installment.invoiceDate);
      const due = this.parseDay(patch.installment.dueDate);
      await this.prisma.quoteInstallment.upsert({
        where: { odooMoveId: patch.installment.odooMoveId },
        update: {
          name: patch.installment.name || "",
          amountTotal: patch.installment.amountTotal || 0,
          invoiceDate: invDate,
          dueDate: due,
          paymentState: patch.installment.paymentState || "",
        },
        create: {
          quoteId: quote.id,
          odooMoveId: patch.installment.odooMoveId,
          name: patch.installment.name || "",
          amountTotal: patch.installment.amountTotal || 0,
          invoiceDate: invDate,
          dueDate: due,
          paymentState: patch.installment.paymentState || "",
        },
      });
    }
    const after: SaleSnapshot = {
      state: updated.odooState || "",
      invoiceStatus: updated.odooInvoiceStatus || "",
      amountUntaxed: Number(updated.odooAmountUntaxed || 0),
      amountTax: Number(updated.odooAmountTax || 0),
      amountTotal: Number(updated.odooAmountTotal || 0),
      lines: [],
    };
    const diff = followDiffJson({
      snapshot: snapshotDiff(before, after),
      beforeInvoice: quote.odooInvoiceName,
      afterInvoice: updated.odooInvoiceName,
      beforePicking: quote.odooPickingName,
      afterPicking: updated.odooPickingName,
      beforePickingIn: quote.odooPickingInName,
      afterPickingIn: updated.odooPickingInName,
    });
    if (Object.keys(diff).length) {
      await this.prisma.quoteOdooRevision.create({
        data: {
          quoteId: quote.id,
          source: "odoo",
          state: after.state,
          invoiceStatus: after.invoiceStatus,
          amountUntaxed: after.amountUntaxed,
          amountTax: after.amountTax,
          amountTotal: after.amountTotal,
          linesJson: followLinesJson({
            event: input.event,
            payload: input.payload,
            invoiceName: patch.odooInvoiceName,
            pickingName: patch.odooPickingName || patch.odooPickingInName,
          }) as Prisma.InputJsonValue,
          diffJson: diff as Prisma.InputJsonValue,
        },
      });
    }
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: quote.id,
        type: `odoo_${input.event}`,
        detail: this.detail(input.event, patch),
      },
    });
    this.log.log(`Quote ${quote.number} ← ${input.event}`);
    return { ok: true, quoteId: quote.id };
  }

  private detail(event: string, patch: QuoteFollowPatch) {
    if (event === "invoice_posted") return `Factura Odoo ${patch.odooInvoiceName || ""}`.trim();
    if (event === "picking_out_done") return `OUT Odoo ${patch.odooPickingName || ""} (patio ZDRY no se vacía solo)`.trim();
    if (event === "picking_in_done") return `IN Odoo ${patch.odooPickingInName || ""} (devolución)`.trim();
    if (event === "sale_state") return `SO Odoo ${patch.odooState || ""}`.trim();
    return event;
  }

  private parseDay(raw?: string | null): Date | null {
    const s = String(raw || "").trim();
    if (!s) return null;
    const d = new Date(s.length <= 10 ? `${s}T00:00:00.000Z` : s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private async findQuote(input: {
    event: string;
    model?: string | null;
    resId?: number | null;
    payload?: Record<string, unknown> | null;
  }) {
    if (input.model === "sale.order" && input.resId) {
      const byId = await this.prisma.quote.findFirst({ where: { odooSaleId: input.resId } });
      if (byId) return byId;
    }
    for (const id of saleIdsFromInvoicePayload(input.payload)) {
      const hit = await this.prisma.quote.findFirst({ where: { odooSaleId: id } });
      if (hit) return hit;
    }
    for (const name of saleNamesFromPayload(input.payload)) {
      const hit = await this.prisma.quote.findFirst({ where: { odooSaleName: name } });
      if (hit) return hit;
    }
    if (input.event === "picking_in_done" || input.event === "picking_out_done") {
      const isos = isosFromPayload(input.payload);
      for (const iso of isos) {
        const hit = await this.prisma.quote.findFirst({
          where: { odooSaleId: { not: null }, lines: { some: { iso } } },
          orderBy: { updatedAt: "desc" },
        });
        if (hit) return hit;
      }
    }
    return null;
  }
}
