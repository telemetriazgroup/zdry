/** Q6: sale.order de alquiler — línea de servicio + ISO a $0 + plan. No confirma. No es Q5. */

import {
  productIdFor,
  rentIssueReady,
  rentServiceProductId,
  type OdooQuoteIssueConfig,
} from "./odoo-quote-issue";
import {
  assertDraftOnly,
  expectedAmounts,
  measureFromType,
  orderLineCommands,
  pickStudio,
  saleAsunto,
  usageFromCat,
  usageLabel,
  validityDate,
  type DraftLineIn,
  type DraftLineOut,
  type SaleOrderDraftVals,
} from "./quote-issue-draft";

export const RENT_ISSUE_EVENT = "rent_issue";
export const RENT_ISSUE_MAX_ATTEMPTS = 5;

export class QuoteRentDraftError extends Error {
  constructor(
    message: string,
    public readonly code: "not_ready" | "no_product" | "no_service" | "sale" | "demo" | "empty",
  ) {
    super(message);
  }
}

export type RentDraftInput = {
  iso: string;
  type: string;
  cat: string;
};

export function contractEndDate(from: Date, months: number): string {
  const d = new Date(from.getTime());
  const m = Number.isFinite(months) && months > 0 ? Math.round(months) : 12;
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
}

export function isoAssignName(iso: string, type: string, cat: string): string {
  const measure = measureFromType(type) || String(type || "").toUpperCase();
  const usage = usageFromCat(cat);
  return `ASIGNACIÓN DE CÓDIGOS · ${iso} · CONTENEDOR DRY ${measure} ${usageLabel(usage)}`;
}

export function rentServiceName(lines: Array<{ type: string; cat: string }>): string {
  const measures = [...new Set(lines.map((l) => measureFromType(l.type) || l.type))];
  const usage = lines.every((l) => usageFromCat(l.cat) === "nuevo") ? "NUEVO" : "SEGUNDO USO";
  const noun = measures.length > 1 ? "CONTENEDORES" : "CONTENEDOR";
  return `SERVICIO DE ALQUILER / ALQUILER DE ${noun} DRY ${measures.join(" / ")} ${usage}`.replace(/\s+/g, " ").trim();
}

export function buildRentAssignLines(cfg: OdooQuoteIssueConfig, lines: RentDraftInput[]): DraftLineOut[] {
  if (!lines.length) throw new QuoteRentDraftError("La cotización no tiene líneas DRY.", "empty");
  const out: DraftLineOut[] = [];
  for (const line of lines) {
    const measure = measureFromType(line.type);
    if (!measure) {
      throw new QuoteRentDraftError(`Producto DRY inexistente para ${line.iso} (${line.type}).`, "no_product");
    }
    const usage = usageFromCat(line.cat);
    const productId = productIdFor(cfg, measure, usage);
    if (!productId) {
      throw new QuoteRentDraftError(`Producto DRY inexistente para ${line.iso} (${measure} ${usage}).`, "no_product");
    }
    out.push({
      iso: line.iso,
      productId,
      productUomQty: 1,
      priceUnit: 0,
      name: isoAssignName(line.iso, line.type, line.cat),
      lineType: cfg.defaults.lineTypeSale,
      taxId: cfg.taxId as number,
      measure,
      usage,
    });
  }
  return out;
}

export function buildRentServiceLine(
  cfg: OdooQuoteIssueConfig,
  lines: RentDraftInput[],
  rentPriceNet: number,
): DraftLineOut {
  const productId = rentServiceProductId(cfg);
  if (!productId) {
    throw new QuoteRentDraftError(
      "Falta el producto de servicio de alquiler en Q0. Pulsa «Leer IDs desde Odoo».",
      "no_service",
    );
  }
  const price = Number(rentPriceNet);
  if (!Number.isFinite(price) || price < 0) {
    throw new QuoteRentDraftError("Precio de cuota inválido.", "empty");
  }
  return {
    iso: "alquiler",
    productId,
    productUomQty: 1,
    priceUnit: price,
    name: rentServiceName(lines),
    lineType: cfg.defaults.lineTypeRent,
    taxId: cfg.taxId as number,
    measure: "ALQUILER",
    usage: "segundo_uso",
  };
}

/** Familia A (cobra) + familia B (ISO $0). El IGV esperado sale solo del servicio. */
export function buildRentDraftLines(
  cfg: OdooQuoteIssueConfig,
  lines: RentDraftInput[],
  rentPriceNet: number,
): DraftLineOut[] {
  const service = buildRentServiceLine(cfg, lines, rentPriceNet);
  const assigns = buildRentAssignLines(cfg, lines);
  return [service, ...assigns];
}

export function rentExpectedAmounts(rentPriceNet: number, taxPercent = 18) {
  return expectedAmounts(Number(rentPriceNet) || 0, taxPercent);
}

export function canAmendRentQuota(state?: string | null): boolean {
  const s = String(state || "draft").toLowerCase();
  return s === "draft" || s === "sent" || s === "sale";
}

export function rentQuotaWriteMode(state?: string | null): "replace" | "service" | "blocked" {
  const s = String(state || "draft").toLowerCase();
  if (s === "draft" || s === "sent") return "replace";
  if (s === "sale") return "service";
  return "blocked";
}

export function assertRentIssuable(
  kind: string,
  demo: boolean,
  cfg: OdooQuoteIssueConfig,
  lines: RentDraftInput[],
  rentPriceNet: number,
): DraftLineOut[] {
  if (demo) throw new QuoteRentDraftError("Las cotizaciones demo no se emiten en Odoo.", "demo");
  if (kind !== "alquiler") {
    throw new QuoteRentDraftError("Q6 solo emite alquiler. La venta entra en Q2.", "sale");
  }
  const ready = rentIssueReady(cfg);
  if (!ready.ok) {
    throw new QuoteRentDraftError(
      `Q0 alquiler no listo (${ready.missing.join(", ")}). Pulsa «Leer IDs desde Odoo».`,
      "not_ready",
    );
  }
  return buildRentDraftLines(cfg, lines, rentPriceNet);
}

export function buildRentSaleOrderVals(input: {
  cfg: OdooQuoteIssueConfig;
  quoteNumber: string;
  partnerId: number;
  contactId?: number | null;
  userId?: number | null;
  email?: string;
  phone?: string;
  deliveryPlace?: string | null;
  lines: DraftLineOut[];
  rentStart?: Date;
  rentMonths?: number;
  now?: Date;
}): SaleOrderDraftVals {
  const { cfg } = input;
  const now = input.now || new Date();
  const months = input.rentMonths || cfg.rentMonths || 12;
  const start = input.rentStart || now;
  const pricelistId = cfg.rentPricelistId || cfg.pricelistId;
  const dry = input.lines.filter((l) => l.measure !== "ALQUILER" && l.measure !== "FLETE" && l.measure !== "SERVICIO");
  const vals: SaleOrderDraftVals = {
    partner_id: input.partnerId,
    partner_invoice_id: input.partnerId,
    partner_shipping_id: input.partnerId,
    company_id: cfg.companyId,
    pricelist_id: pricelistId,
    warehouse_id: cfg.warehouseId,
    fiscal_position_id: cfg.fiscalPositionId,
    payment_term_id: cfg.paymentTermId,
    client_order_ref: input.quoteNumber,
    origin: `ZDRY ${input.quoteNumber}`,
    validity_date: validityDate(now, cfg.defaults.validityDays),
    note: cfg.defaults.note,
    x_studio_asunto_cotizacion: saleAsunto("alquiler", dry.length ? dry : input.lines),
    x_studio_validez_de_la_oferta: cfg.defaults.validityLabel,
    x_studio_tiempo_de_entrega_1: cfg.defaults.deliveryTime,
    x_studio_lugar_de_entrega: (input.deliveryPlace || "").trim() || cfg.defaults.deliveryPlace,
    x_studio_correo: input.email || "",
    x_studio_celular: input.phone || "",
    x_studio_leasing: true,
    is_subscription: true,
    plan_id: cfg.planId,
    start_date: start.toISOString().slice(0, 10),
    end_date: contractEndDate(start, months),
    order_line: orderLineCommands(input.lines),
  };
  if (input.contactId) vals.x_studio_contacto = input.contactId;
  if (input.userId) vals.user_id = input.userId;
  assertDraftOnly(vals);
  return vals;
}

export function pickRentFields(
  orderFields: Record<string, unknown> | null | undefined,
  vals: SaleOrderDraftVals,
): SaleOrderDraftVals {
  const next = pickStudio(orderFields, vals);
  if (!orderFields) return next;
  for (const key of ["is_subscription", "plan_id", "start_date", "end_date", "x_studio_leasing"]) {
    if (!(key in orderFields)) delete next[key];
  }
  return next;
}

export { orderLineCommands, pickStudio, expectedAmounts };
