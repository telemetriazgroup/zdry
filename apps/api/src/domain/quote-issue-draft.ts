/** Q2: armar sale.order draft. No confirma. No asigna lote. */

import { igvOf, grossOf } from "./pricing";
import { productIdFor, quoteIssueReady, type OdooQuoteIssueConfig } from "./odoo-quote-issue";

export const QUOTE_ISSUE_EVENT = "quote_issue";
export const ZDRY_SYNC_CONTEXT = { zdry_sync: true as const };
export const QUOTE_ISSUE_MAX_ATTEMPTS = 5;

export type DraftLineIn = {
  iso: string;
  type: string;
  cat: string;
  priceNet: number;
  name?: string;
};

export type DraftLineOut = {
  iso: string;
  productId: number;
  productUomQty: number;
  priceUnit: number;
  name: string;
  lineType: string;
  taxId: number;
  measure: string;
  usage: string;
};

export class QuoteIssueDraftError extends Error {
  constructor(
    message: string,
    public readonly code: "not_ready" | "no_product" | "rental" | "demo" | "empty",
  ) {
    super(message);
  }
}

export function measureFromType(type: string): string | null {
  const compact = String(type || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (compact === "20GP" || compact === "20DC" || compact === "20STD") return "20 DC";
  if (compact === "40HC" || compact === "40HQ") return "40 HC";
  if (compact === "40GP" || compact === "40DC" || compact === "40STD") return "40 DC";
  const spaced = String(type || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (spaced === "20 DC" || spaced === "40 HC" || spaced === "40 DC") return spaced;
  return null;
}

export function usageFromCat(cat: string): "nuevo" | "segundo_uso" {
  const c = String(cat || "")
    .trim()
    .toUpperCase();
  if (c === "1TRIP" || c.includes("NUEVO") || c === "NEW") return "nuevo";
  return "segundo_uso";
}

export function usageLabel(usage: "nuevo" | "segundo_uso"): string {
  return usage === "nuevo" ? "NUEVO" : "SEGUNDO USO";
}

export function expectedAmounts(net: number, taxPercent = 18): { untaxed: number; tax: number; total: number } {
  const rate = taxPercent > 1 ? taxPercent / 100 : taxPercent;
  if (rate === 0.18) {
    return { untaxed: net, tax: igvOf(net), total: grossOf(net) };
  }
  const tax = Math.round(net * rate * 100) / 100;
  return { untaxed: net, tax, total: Math.round((net + tax) * 100) / 100 };
}

export function amountsMatchOdoo(
  expected: { tax: number; total: number },
  actual: { amount_tax?: unknown; amount_total?: unknown },
  tol = 0.05,
): boolean {
  const tax = Number(actual.amount_tax);
  const total = Number(actual.amount_total);
  if (!Number.isFinite(tax) || !Number.isFinite(total)) return false;
  return Math.abs(tax - expected.tax) <= tol && Math.abs(total - expected.total) <= tol;
}

export function resolveDraftLine(
  cfg: OdooQuoteIssueConfig,
  line: DraftLineIn,
): DraftLineOut | { error: string; iso: string } {
  const measure = measureFromType(line.type);
  if (!measure) {
    return { error: `Producto DRY inexistente para ${line.iso} (${line.type}).`, iso: line.iso };
  }
  const usage = usageFromCat(line.cat);
  const productId = productIdFor(cfg, measure, usage);
  if (!productId) {
    return { error: `Producto DRY inexistente para ${line.iso} (${measure} ${usage}).`, iso: line.iso };
  }
  const bind = cfg.products.find((p) => p.productId === productId);
  const price = Number(line.priceNet);
  if (!Number.isFinite(price) || price < 0) {
    return { error: `Precio inválido en ${line.iso}.`, iso: line.iso };
  }
  return {
    iso: line.iso,
    productId,
    productUomQty: 1,
    priceUnit: price,
    name: line.name?.trim() || `${line.iso} · CONTENEDOR DRY ${measure} ${usageLabel(usage)}`,
    lineType: cfg.defaults.lineTypeSale,
    taxId: cfg.taxId as number,
    measure,
    usage,
  };
}

export function buildDraftLines(cfg: OdooQuoteIssueConfig, lines: DraftLineIn[]): DraftLineOut[] {
  if (!lines.length) throw new QuoteIssueDraftError("La cotización no tiene líneas.", "empty");
  const out: DraftLineOut[] = [];
  for (const line of lines) {
    const resolved = resolveDraftLine(cfg, line);
    if ("error" in resolved) throw new QuoteIssueDraftError(resolved.error, "no_product");
    out.push(resolved);
  }
  return out;
}

export function saleAsunto(kind: string, lines: Array<{ measure: string; usage: string }>): string {
  const measures = [...new Set(lines.map((l) => l.measure))];
    const usage = lines.every((l) => l.usage === "nuevo") ? "NUEVO" : "SEGUNDO USO";
  const noun = measures.length > 1 ? "CONTENEDORES" : "CONTENEDOR";
  const size = measures.join(" / ");
  const verb = kind === "alquiler" ? "ALQUILER" : "VENTA";
  return `${verb} DE ${noun} DRY ${size} ${usage}`.replace(/\s+/g, " ").trim();
}

export function validityDate(from: Date, days: number): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type SaleOrderDraftVals = Record<string, unknown>;

export function orderLineCommands(lines: DraftLineOut[]): unknown[] {
  return lines.map((l) => [
    0,
    0,
    {
      product_id: l.productId,
      name: l.name,
      product_uom_qty: l.productUomQty,
      price_unit: l.priceUnit,
      tax_id: [[6, 0, [l.taxId]]],
      x_studio_tipo: l.lineType,
    },
  ]);
}

export function assertDraftOnly(vals: SaleOrderDraftVals): void {
  if (vals.state && vals.state !== "draft" && vals.state !== "sent") {
    throw new Error("Q2 no puede fijar state distinto de draft.");
  }
  if ("action_confirm" in vals) {
    throw new Error("Q2 no llama action_confirm.");
  }
}

export function buildSaleOrderVals(input: {
  cfg: OdooQuoteIssueConfig;
  quoteNumber: string;
  kind: string;
  partnerId: number;
  contactId?: number | null;
  userId?: number | null;
  email?: string;
  phone?: string;
  deliveryPlace?: string | null;
  lines: DraftLineOut[];
  now?: Date;
}): SaleOrderDraftVals {
  const { cfg } = input;
  const now = input.now || new Date();
  const vals: SaleOrderDraftVals = {
    partner_id: input.partnerId,
    partner_invoice_id: input.partnerId,
    partner_shipping_id: input.partnerId,
    company_id: cfg.companyId,
    pricelist_id: cfg.pricelistId,
    warehouse_id: cfg.warehouseId,
    fiscal_position_id: cfg.fiscalPositionId,
    payment_term_id: cfg.paymentTermId,
    client_order_ref: input.quoteNumber,
    origin: `ZDRY ${input.quoteNumber}`,
    validity_date: validityDate(now, cfg.defaults.validityDays),
    note: cfg.defaults.note,
    x_studio_asunto_cotizacion: saleAsunto(input.kind, input.lines),
    x_studio_validez_de_la_oferta: cfg.defaults.validityLabel,
    x_studio_tiempo_de_entrega_1: cfg.defaults.deliveryTime,
    x_studio_lugar_de_entrega: (input.deliveryPlace || "").trim() || cfg.defaults.deliveryPlace,
    x_studio_correo: input.email || "",
    x_studio_celular: input.phone || "",
    order_line: orderLineCommands(input.lines),
  };
  if (input.contactId) vals.x_studio_contacto = input.contactId;
  if (input.userId) vals.user_id = input.userId;
  assertDraftOnly(vals);
  return vals;
}

export function pickStudio(fields: Record<string, unknown> | null | undefined, vals: SaleOrderDraftVals): SaleOrderDraftVals {
  if (!fields) return vals;
  const next = { ...vals };
  for (const key of Object.keys(next)) {
    if (key.startsWith("x_studio_") && !(key in fields)) delete next[key];
  }
  return next;
}

export function assertIssuable(kind: string, demo: boolean, cfg: OdooQuoteIssueConfig, lines: DraftLineIn[]): DraftLineOut[] {
  if (demo) throw new QuoteIssueDraftError("Las cotizaciones demo no se emiten en Odoo.", "demo");
  if (kind === "alquiler") {
    throw new QuoteIssueDraftError("Alquiler: la SO Odoo entra en Q6, no en Q2.", "rental");
  }
  const ready = quoteIssueReady(cfg);
  if (!ready.ok) {
    throw new QuoteIssueDraftError(`Q0 no listo (${ready.missing.join(", ")}). Pulsa «Leer IDs desde Odoo».`, "not_ready");
  }
  return buildDraftLines(cfg, lines);
}

export function odooFormUrl(baseUrl: string, model: string, id: number): string {
  const root = String(baseUrl || "").replace(/\/$/, "");
  return `${root}/web#id=${id}&model=${model}&view_type=form`;
}

export function many2oneId(raw: unknown): number | null {
  if (typeof raw === "number" && raw > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "number" && raw[0] > 0) return raw[0];
  return null;
}
