import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { QuotePdfService } from "./quote-pdf.service";
import { loadQuoteIssueConfig } from "./quote-issue.store";
import { ZDRY_SYNC_CONTEXT } from "../domain/quote-issue-draft";
import type { DraftLineIn } from "../domain/quote-issue-draft";
import {
  AMEND_SOURCE,
  extraLinesForAmend,
  amendWriteVals,
  assertCanAmendOdoo,
  buildAmendLines,
  QuoteAmendError,
  snapshotDiff,
  totalChanged,
  type SaleSnapshot,
} from "../domain/quote-amend";
import {
  assertRentIssuable,
  canAmendRentQuota,
  rentQuotaWriteMode,
  QuoteRentDraftError,
} from "../domain/quote-rent-draft";

const SYNC = { context: { ...ZDRY_SYNC_CONTEXT } };

@Injectable()
export class QuoteAmendService {
  private readonly log = new Logger(QuoteAmendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly quotePdf: QuotePdfService,
  ) {}

  /** Lee Odoo y bloquea si ya no es presupuesto. Alquiler: cuota viva hasta sale. */
  async assertWritable(quoteId: string): Promise<void> {
    const q = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!q?.odooSaleId) return;
    const so = await this.readSale(q.odooSaleId);
    const state = so.state != null ? String(so.state) : "draft";
    if (q.kind === "alquiler") {
      if (!canAmendRentQuota(state)) {
        throw new QuoteAmendError(
          "El contrato de alquiler está cancelado en Odoo. No se puede enmendar desde ZDRY.",
          "cancelled",
          q.odooUrl || null,
          state,
        );
      }
      return;
    }
    assertCanAmendOdoo(state, q.odooUrl);
  }

  async sync(quoteId: string): Promise<{ skipped?: string; totalChanged?: boolean } | null> {
    const q = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { lines: true, extras: true, vendor: true },
    });
    if (!q) throw new QuoteAmendError("Cotización no encontrada.", "missing_sale");
    if (!q.odooSaleId) return { skipped: "no_so" };
    if (q.demo) return { skipped: "demo" };
    if (q.kind === "alquiler") return this.syncRent(q);

    const cfg = await loadQuoteIssueConfig(this.prisma);
    const dry: DraftLineIn[] = q.lines.map((l) => ({
      iso: l.iso,
      type: l.type,
      cat: l.cat,
      priceNet: Number(l.priceNet),
    }));
    const extras = q.extras.map((e) => ({ kind: e.kind, label: e.label, amount: Number(e.amount) }));
    const lines = buildAmendLines(cfg, dry, extras, q.clientPickup);

    const before = await this.readSnapshot(q.odooSaleId);
    assertCanAmendOdoo(before.state, q.odooUrl);

    let vals = amendWriteVals(lines, q.kind);
    const lineFields = await this.odoo.fieldsGet("sale.order.line");
    const orderFields = await this.odoo.fieldsGet("sale.order");
    if (Array.isArray(vals.order_line)) {
      vals.order_line = (vals.order_line as unknown[]).map((cmd) => {
        const tuple = cmd as [number, number, Record<string, unknown>?];
        if (tuple[0] !== 0 || !tuple[2]) return cmd;
        const lv = { ...tuple[2] };
        if (lineFields && !("x_studio_tipo" in lineFields)) delete lv.x_studio_tipo;
        return [tuple[0], tuple[1], lv];
      });
    }
    if (orderFields && !("x_studio_asunto_cotizacion" in orderFields)) {
      delete vals.x_studio_asunto_cotizacion;
    }

    await this.odoo.write("sale.order", [q.odooSaleId], vals, SYNC);
    const after = await this.readSnapshot(q.odooSaleId);
    const diff = snapshotDiff(before, after);

    await this.prisma.quote.update({
      where: { id: q.id },
      data: {
        odooState: after.state,
        odooInvoiceStatus: after.invoiceStatus || null,
        odooAmountUntaxed: after.amountUntaxed,
        odooAmountTax: after.amountTax,
        odooAmountTotal: after.amountTotal,
      },
    });

    if (Object.keys(diff).length) {
      await this.prisma.quoteOdooRevision.create({
        data: {
          quoteId: q.id,
          source: AMEND_SOURCE,
          state: after.state,
          invoiceStatus: after.invoiceStatus,
          amountUntaxed: after.amountUntaxed,
          amountTax: after.amountTax,
          amountTotal: after.amountTotal,
          linesJson: after.lines as Prisma.InputJsonValue,
          diffJson: diff as Prisma.InputJsonValue,
        },
      });
    }

    const changed = totalChanged(before.amountTotal, after.amountTotal);
    try {
      await this.quotePdf.capture(q.id, true);
      if (changed) {
        await this.quotePdf.postToSale(q.id);
        await this.prisma.dealMessage.create({
          data: {
            quoteId: q.id,
            authorRole: "vendedor",
            authorName: q.vendor.name,
            body: `El total de la cotización Odoo ${q.odooSaleName} cambió de ${before.amountTotal} a ${after.amountTotal}. Revisa el PDF Perú v2.`,
          },
        });
      }
    } catch (e) {
      this.log.warn(`PDF Q4b ${q.number}: ${(e as Error).message}`);
    }

    await this.prisma.quoteEvent.create({
      data: {
        quoteId: q.id,
        type: "odoo_amend",
        detail: changed
          ? `SO ${q.odooSaleName} enmendada (total ${before.amountTotal} → ${after.amountTotal}).`
          : `SO ${q.odooSaleName} enmendada (mismo total ${after.amountTotal}).`,
      },
    });

    return { totalChanged: changed };
  }

  private async syncRent(q: {
    id: string;
    number: string;
    kind: string;
    odooSaleId: number | null;
    odooSaleName: string | null;
    odooUrl: string | null;
    rentPriceNet: Prisma.Decimal | number | null;
    clientPickup: boolean;
    vendor: { name: string };
    lines: Array<{ iso: string; type: string; cat: string }>;
    extras: Array<{ kind: string; label: string; amount: Prisma.Decimal | number }>;
  }): Promise<{ skipped?: string; totalChanged?: boolean } | null> {
    if (!q.odooSaleId) return { skipped: "no_so" };
    const cfg = await loadQuoteIssueConfig(this.prisma);
    const rentPrice = q.rentPriceNet != null ? Number(q.rentPriceNet) : 0;
    let rentLines;
    try {
      rentLines = assertRentIssuable("alquiler", false, cfg, q.lines, rentPrice);
    } catch (e) {
      if (e instanceof QuoteRentDraftError) throw new QuoteAmendError(e.message, "empty");
      throw e;
    }
    const extras = extraLinesForAmend(
      cfg,
      q.extras.map((e) => ({ kind: e.kind, label: e.label, amount: Number(e.amount) })),
      q.clientPickup,
    );
    const before = await this.readSnapshot(q.odooSaleId);
    const mode = rentQuotaWriteMode(before.state);
    if (mode === "blocked") {
      throw new QuoteAmendError(
        "El contrato de alquiler está cancelado en Odoo. No se puede enmendar desde ZDRY.",
        "cancelled",
        q.odooUrl || null,
        before.state,
      );
    }

    if (mode === "replace") {
      let vals = amendWriteVals([...rentLines, ...extras], "alquiler");
      const lineFields = await this.odoo.fieldsGet("sale.order.line");
      const orderFields = await this.odoo.fieldsGet("sale.order");
      if (Array.isArray(vals.order_line)) {
        vals.order_line = (vals.order_line as unknown[]).map((cmd) => {
          const tuple = cmd as [number, number, Record<string, unknown>?];
          if (tuple[0] !== 0 || !tuple[2]) return cmd;
          const lv = { ...tuple[2] };
          if (lineFields && !("x_studio_tipo" in lineFields)) delete lv.x_studio_tipo;
          return [tuple[0], tuple[1], lv];
        });
      }
      if (orderFields && !("x_studio_asunto_cotizacion" in orderFields)) {
        delete vals.x_studio_asunto_cotizacion;
      }
      await this.odoo.write("sale.order", [q.odooSaleId], vals, SYNC);
    } else {
      const so = await this.readSale(q.odooSaleId);
      const lineIds = Array.isArray(so.order_line) ? (so.order_line as number[]) : [];
      const sols = lineIds.length
        ? await this.odoo.read("sale.order.line", lineIds, ["id", "name", "x_studio_tipo", "price_unit"])
        : [];
      const service = sols.find((l) =>
        String(l.x_studio_tipo || "")
          .toUpperCase()
          .includes("ALQUILER"),
      ) || sols.find((l) =>
        String(l.name || "")
          .toUpperCase()
          .includes("ALQUILER"),
      );
      if (!service?.id) {
        throw new QuoteAmendError("No se encontró la línea de servicio de alquiler en Odoo.", "empty");
      }
      await this.odoo.write("sale.order.line", [Number(service.id)], { price_unit: rentPrice }, SYNC);
    }

    const after = await this.readSnapshot(q.odooSaleId);
    const diff = snapshotDiff(before, after);
    await this.prisma.quote.update({
      where: { id: q.id },
      data: {
        odooState: after.state,
        odooInvoiceStatus: after.invoiceStatus || null,
        odooAmountUntaxed: after.amountUntaxed,
        odooAmountTax: after.amountTax,
        odooAmountTotal: after.amountTotal,
      },
    });
    if (Object.keys(diff).length) {
      await this.prisma.quoteOdooRevision.create({
        data: {
          quoteId: q.id,
          source: AMEND_SOURCE,
          state: after.state,
          invoiceStatus: after.invoiceStatus,
          amountUntaxed: after.amountUntaxed,
          amountTax: after.amountTax,
          amountTotal: after.amountTotal,
          linesJson: after.lines as Prisma.InputJsonValue,
          diffJson: diff as Prisma.InputJsonValue,
        },
      });
    }
    const changed = totalChanged(before.amountTotal, after.amountTotal);
    try {
      await this.quotePdf.capture(q.id, true);
      await this.quotePdf.captureCronograma(q.id, true);
      if (changed && mode === "replace") {
        await this.quotePdf.postToSale(q.id);
        await this.prisma.dealMessage.create({
          data: {
            quoteId: q.id,
            authorRole: "vendedor",
            authorName: q.vendor.name,
            body: `La cuota de alquiler Odoo ${q.odooSaleName} cambió de ${before.amountTotal} a ${after.amountTotal}.`,
          },
        });
      }
    } catch (e) {
      this.log.warn(`PDF Q6 ${q.number}: ${(e as Error).message}`);
    }
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: q.id,
        type: "odoo_amend",
        detail: `Cuota alquiler ${q.odooSaleName}: ${before.amountTotal} → ${after.amountTotal} (${mode}).`,
      },
    });
    return { totalChanged: changed };
  }

  private async readSale(saleId: number) {
    const rows = await this.odoo.read("sale.order", [saleId], [
      "name",
      "state",
      "invoice_status",
      "amount_untaxed",
      "amount_tax",
      "amount_total",
      "order_line",
    ]);
    if (!rows[0]) throw new QuoteAmendError("No se encontró la cotización en Odoo.", "missing_sale");
    return rows[0];
  }

  private async readSnapshot(saleId: number): Promise<SaleSnapshot> {
    const so = await this.readSale(saleId);
    const lineIds = Array.isArray(so.order_line) ? (so.order_line as number[]).filter((id) => Number(id) > 0) : [];
    const rawLines = lineIds.length
      ? await this.odoo.read("sale.order.line", lineIds, ["name", "price_unit", "product_uom_qty"])
      : [];
    return {
      state: String(so.state || "draft"),
      invoiceStatus: String(so.invoice_status || ""),
      amountUntaxed: Number(so.amount_untaxed) || 0,
      amountTax: Number(so.amount_tax) || 0,
      amountTotal: Number(so.amount_total) || 0,
      lines: rawLines.map((l) => ({
        name: String(l.name || ""),
        qty: Number(l.product_uom_qty) || 0,
        priceUnit: Number(l.price_unit) || 0,
      })),
    };
  }
}
