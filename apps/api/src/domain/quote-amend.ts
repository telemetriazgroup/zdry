/** Q4b: escribir la SO existente si sigue draft|sent. No confirma. No crea otra cotización. */

import { freightProductId, type OdooQuoteIssueConfig } from "./odoo-quote-issue";
import {
  buildDraftLines,
  expectedAmounts,
  orderLineCommands,
  saleAsunto,
  type DraftLineIn,
  type DraftLineOut,
} from "./quote-issue-draft";

export const AMEND_SOURCE = "zdry" as const;
export const LINE_TYPE_SERVICE = "VENTA DE SERVICIOS - OTROS";

export class QuoteAmendError extends Error {
  constructor(
    message: string,
    public readonly code: "confirmed" | "cancelled" | "missing_sale" | "no_freight_product" | "empty",
    public readonly odooUrl: string | null = null,
    public readonly odooState: string | null = null,
  ) {
    super(message);
  }
}

export function canAmendOdoo(state?: string | null): boolean {
  const s = String(state || "draft").toLowerCase();
  return s === "draft" || s === "sent";
}

export function assertCanAmendOdoo(state?: string | null, odooUrl?: string | null): void {
  const s = String(state || "").toLowerCase() || "draft";
  if (canAmendOdoo(s)) return;
  if (s === "cancel") {
    throw new QuoteAmendError(
      "La cotización está cancelada en Odoo. No se puede enmendar desde ZDRY.",
      "cancelled",
      odooUrl || null,
      s,
    );
  }
  throw new QuoteAmendError(
    "Esta cotización ya está confirmada en Odoo. Modifícala allá.",
    "confirmed",
    odooUrl || null,
    s,
  );
}

export function amendConflictBody(err: QuoteAmendError) {
  return {
    error: "odoo_confirmed",
    message: err.message,
    odooUrl: err.odooUrl,
    odooState: err.odooState,
  };
}

export type AmendExtraIn = { kind: string; label: string; amount: number };

export function extraLinesForAmend(
  cfg: OdooQuoteIssueConfig,
  extras: AmendExtraIn[],
  clientPickup: boolean,
): DraftLineOut[] {
  if (clientPickup) return [];
  const out: DraftLineOut[] = [];
  for (const extra of extras) {
    if (extra.kind !== "freight" && extra.kind !== "service") continue;
    const amount = Number(extra.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const productId = freightProductId(cfg);
    if (!productId) {
      throw new QuoteAmendError(
        "Falta el producto de flete/servicio en Q0. Pulsa «Leer IDs desde Odoo».",
        "no_freight_product",
      );
    }
    out.push({
      iso: extra.kind,
      productId,
      productUomQty: 1,
      priceUnit: amount,
      name: extra.label,
      lineType: extra.kind === "freight" ? cfg.defaults.lineTypeFreight : LINE_TYPE_SERVICE,
      taxId: cfg.taxId as number,
      measure: extra.kind === "freight" ? "FLETE" : "SERVICIO",
      usage: "segundo_uso",
    });
  }
  return out;
}

export function buildAmendLines(
  cfg: OdooQuoteIssueConfig,
  dry: DraftLineIn[],
  extras: AmendExtraIn[],
  clientPickup = false,
): DraftLineOut[] {
  if (!dry.length) throw new QuoteAmendError("La cotización no tiene líneas DRY.", "empty");
  return [...buildDraftLines(cfg, dry), ...extraLinesForAmend(cfg, extras, clientPickup)];
}

/** (5,0,0) borra las líneas actuales; (0,0,vals) crea las de ZDRY. Misma SO. */
export function replaceOrderLineCommands(lines: DraftLineOut[]): unknown[] {
  return [[5, 0, 0], ...orderLineCommands(lines)];
}

export function amendWriteVals(lines: DraftLineOut[], kind = "venta"): Record<string, unknown> {
  const vals: Record<string, unknown> = {
    order_line: replaceOrderLineCommands(lines),
    x_studio_asunto_cotizacion: saleAsunto(
      kind,
      lines.filter((l) => l.measure !== "FLETE" && l.measure !== "SERVICIO"),
    ),
  };
  assertAmendWrite(vals);
  return vals;
}

export function assertAmendWrite(vals: Record<string, unknown>): void {
  if ("state" in vals) throw new Error("Q4b no cambia state.");
  if ("action_confirm" in vals) throw new Error("Q4b no llama action_confirm.");
}

export type SaleSnapshot = {
  state: string;
  invoiceStatus: string;
  amountUntaxed: number;
  amountTax: number;
  amountTotal: number;
  lines: Array<{ name: string; qty: number; priceUnit: number }>;
};

export function snapshotDiff(before: SaleSnapshot, after: SaleSnapshot): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  (["state", "invoiceStatus", "amountUntaxed", "amountTax", "amountTotal"] as const).forEach((k) => {
    if (before[k] !== after[k]) diff[k] = { before: before[k], after: after[k] };
  });
  if (JSON.stringify(before.lines) !== JSON.stringify(after.lines)) {
    diff.lines = { before: before.lines, after: after.lines };
  }
  return diff;
}

export function totalChanged(before: number, after: number, tol = 0.05): boolean {
  return Math.abs(Number(after) - Number(before)) > tol;
}

export function expectedAmendAmounts(lines: DraftLineOut[], taxPercent = 18) {
  const net = lines.reduce((s, l) => s + l.priceUnit * l.productUomQty, 0);
  return expectedAmounts(net, taxPercent);
}
