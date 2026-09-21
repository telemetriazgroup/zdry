/** Q0: contrato de emisión de cotización. IDs se resuelven por nombre/código, no se hardcodean. */

export const ODOO_QUOTE_ISSUE_KEY = "odoo_quote_issue";

export const DEFAULT_QUOTE_NOTE = [
  "NO INCLUYE:",
  "- Servicios de transporte y manipuleo en destino",
  "- Viáticos como pasajes, hospedaje, alimentación y el transporte de insumos para el personal técnico que se desplace a provincia",
  "- Cualquier medicina contra hepatitis, COVID, permisos o cualquier homologación requerida para permitir el ingreso a nuestras instalaciones o las instalaciones del cliente",
  "- Plano, soldado y pintado del contenedor. El equipo es despachado en el estado encontrado.",
  "",
  "Términos y Condiciones: https://www.zgroup.com.pe/terms",
].join("\n");

export type QuoteProductBind = {
  key: string;
  measure: string;
  usage: string;
  defaultCode: string;
  productId: number | null;
  productName: string;
};

export type OdooQuoteIssueConfig = {
  reportName: string;
  companyVat: string;
  companyId: number | null;
  taxAmount: number;
  taxId: number | null;
  taxName: string;
  pricelistName: string;
  pricelistId: number | null;
  warehouseName: string;
  warehouseId: number | null;
  fiscalPositionName: string;
  fiscalPositionId: number | null;
  paymentTermName: string;
  paymentTermId: number | null;
  identificationTypeName: string;
  identificationTypeId: number | null;
  products: QuoteProductBind[];
  defaults: {
    validityDays: number;
    validityLabel: string;
    deliveryPlace: string;
    deliveryTime: string;
    country: string;
    note: string;
    lineTypeSale: string;
    lineTypeFreight: string;
    lineTypeRent: string;
  };
};

export type NamedOdooRow = {
  id?: number | null;
  name?: string | null;
  display_name?: string | null;
  default_code?: string | null;
  amount?: number | null;
  report_name?: string | null;
  vat?: string | null;
};

export type QuoteIssueHits = {
  report?: NamedOdooRow | null;
  tax?: NamedOdooRow | null;
  pricelist?: NamedOdooRow | null;
  warehouse?: NamedOdooRow | null;
  fiscalPosition?: NamedOdooRow | null;
  paymentTerm?: NamedOdooRow | null;
  company?: NamedOdooRow | null;
  identificationType?: NamedOdooRow | null;
  products?: Array<{ key: string; row: NamedOdooRow | null }>;
};

const DEFAULT_PRODUCTS: QuoteProductBind[] = [
  { key: "20dc-segundo", measure: "20 DC", usage: "segundo_uso", defaultCode: "CDD20F0003", productId: null, productName: "" },
  { key: "40hc-segundo", measure: "40 HC", usage: "segundo_uso", defaultCode: "CDD40H0004", productId: null, productName: "" },
  { key: "40dc-segundo", measure: "40 DC", usage: "segundo_uso", defaultCode: "", productId: null, productName: "" },
  { key: "flete", measure: "FLETE", usage: "servicio", defaultCode: "", productId: null, productName: "" },
];

export function defaultQuoteIssueConfig(): OdooQuoteIssueConfig {
  return {
    reportName: "sale.report_saleorder_copy_1_copy_4",
    companyVat: "20521180774",
    companyId: null,
    taxAmount: 18,
    taxId: null,
    taxName: "IGV",
    pricelistName: "Lista de precios por defecto USD",
    pricelistId: null,
    warehouseName: "Principal Callao",
    warehouseId: null,
    fiscalPositionName: "LOCAL PERU",
    fiscalPositionId: null,
    paymentTermName: "Immediate Payment",
    paymentTermId: null,
    identificationTypeName: "RUC",
    identificationTypeId: null,
    products: DEFAULT_PRODUCTS.map((p) => ({ ...p })),
    defaults: {
      validityDays: 7,
      validityLabel: "7 DÍAS",
      deliveryPlace: "ZGROUP CALLAO",
      deliveryTime: "SEGUN PROGRAMACIÓN",
      country: "Peru",
      note: DEFAULT_QUOTE_NOTE,
      lineTypeSale: "VENTA DE PRODUCTOS",
      lineTypeFreight: "VENTA DE SERVICIO - FLETE",
      lineTypeRent: "VENTA DE SERVICIOS - ALQUILER",
    },
  };
}

function asInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function rowName(row: NamedOdooRow | null | undefined): string {
  if (!row) return "";
  return String(row.display_name || row.name || "").trim();
}

export function pickNamed(rows: NamedOdooRow[] | null | undefined, needles: string[]): NamedOdooRow | null {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const want = needles.map((n) => n.toLowerCase()).filter(Boolean);
  const hit = list.find((r) => {
    const hay = `${rowName(r)} ${r.default_code || ""} ${r.report_name || ""} ${r.vat || ""}`.toLowerCase();
    return want.some((n) => hay.includes(n));
  });
  return hit || list[0] || null;
}

function normalizeProduct(raw: unknown, fallback: QuoteProductBind): QuoteProductBind {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    key: asStr(src.key, fallback.key),
    measure: asStr(src.measure, fallback.measure),
    usage: asStr(src.usage, fallback.usage),
    defaultCode: asStr(src.defaultCode, fallback.defaultCode).toUpperCase(),
    productId: asInt(src.productId),
    productName: asStr(src.productName),
  };
}

export function normalizeQuoteIssueConfig(raw: unknown): OdooQuoteIssueConfig {
  const base = defaultQuoteIssueConfig();
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const defs = src.defaults && typeof src.defaults === "object" && !Array.isArray(src.defaults) ? (src.defaults as Record<string, unknown>) : {};
  const incoming = Array.isArray(src.products) ? src.products : [];
  const products = base.products.map((fb, i) => normalizeProduct(incoming[i] || incoming.find((p) => (p as QuoteProductBind)?.key === fb.key), fb));
  for (const extra of incoming) {
    const key = asStr((extra as QuoteProductBind)?.key);
    if (key && !products.some((p) => p.key === key)) products.push(normalizeProduct(extra, { ...DEFAULT_PRODUCTS[0], key }));
  }
  const validityDays = Number(defs.validityDays);
  return {
    reportName: asStr(src.reportName, base.reportName) || base.reportName,
    companyVat: asStr(src.companyVat, base.companyVat).replace(/\D/g, "") || base.companyVat,
    companyId: asInt(src.companyId),
    taxAmount: Number.isFinite(Number(src.taxAmount)) && Number(src.taxAmount) > 0 ? Number(src.taxAmount) : 18,
    taxId: asInt(src.taxId),
    taxName: asStr(src.taxName, base.taxName) || base.taxName,
    pricelistName: asStr(src.pricelistName, base.pricelistName) || base.pricelistName,
    pricelistId: asInt(src.pricelistId),
    warehouseName: asStr(src.warehouseName, base.warehouseName) || base.warehouseName,
    warehouseId: asInt(src.warehouseId),
    fiscalPositionName: asStr(src.fiscalPositionName, base.fiscalPositionName) || base.fiscalPositionName,
    fiscalPositionId: asInt(src.fiscalPositionId),
    paymentTermName: asStr(src.paymentTermName, base.paymentTermName) || base.paymentTermName,
    paymentTermId: asInt(src.paymentTermId),
    identificationTypeName: asStr(src.identificationTypeName, base.identificationTypeName) || base.identificationTypeName,
    identificationTypeId: asInt(src.identificationTypeId),
    products,
    defaults: {
      validityDays: Number.isFinite(validityDays) && validityDays > 0 ? Math.min(90, Math.round(validityDays)) : 7,
      validityLabel: asStr(defs.validityLabel, base.defaults.validityLabel) || base.defaults.validityLabel,
      deliveryPlace: asStr(defs.deliveryPlace, base.defaults.deliveryPlace) || base.defaults.deliveryPlace,
      deliveryTime: asStr(defs.deliveryTime, base.defaults.deliveryTime) || base.defaults.deliveryTime,
      country: asStr(defs.country, base.defaults.country) || base.defaults.country,
      note: asStr(defs.note, base.defaults.note) || base.defaults.note,
      lineTypeSale: asStr(defs.lineTypeSale, base.defaults.lineTypeSale) || base.defaults.lineTypeSale,
      lineTypeFreight: asStr(defs.lineTypeFreight, base.defaults.lineTypeFreight) || base.defaults.lineTypeFreight,
      lineTypeRent: asStr(defs.lineTypeRent, base.defaults.lineTypeRent) || base.defaults.lineTypeRent,
    },
  };
}

export function quoteIssueReady(cfg: OdooQuoteIssueConfig): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!cfg.reportName) missing.push("reportName");
  if (!cfg.taxId) missing.push("taxId");
  if (!cfg.pricelistId) missing.push("pricelistId");
  if (!cfg.warehouseId) missing.push("warehouseId");
  if (!cfg.fiscalPositionId) missing.push("fiscalPositionId");
  if (!cfg.paymentTermId) missing.push("paymentTermId");
  if (!cfg.companyId) missing.push("companyId");
  const mapped = cfg.products.filter((p) => p.defaultCode);
  if (!mapped.length) missing.push("products");
  for (const p of mapped) {
    if (!p.productId) missing.push(`product:${p.key}`);
  }
  return { ok: missing.length === 0, missing };
}

export function productIdFor(cfg: OdooQuoteIssueConfig, measure: string, usage = "segundo_uso"): number | null {
  const m = measure.trim().toUpperCase().replace(/\s+/g, " ");
  const u = usage.trim().toLowerCase();
  const hit = cfg.products.find((p) => p.measure.toUpperCase().replace(/\s+/g, " ") === m && p.usage === u && p.productId);
  return hit?.productId || cfg.products.find((p) => p.measure.toUpperCase().replace(/\s+/g, " ") === m && p.productId)?.productId || null;
}

/** Q4b: línea de flete/servicio. No es obligatorio para emitir la SO de producto (Q2). */
export function freightProductId(cfg: OdooQuoteIssueConfig): number | null {
  const hit = cfg.products.find((p) => p.key === "flete" && p.productId);
  return hit?.productId || null;
}

export function applyQuoteIssueHits(cfg: OdooQuoteIssueConfig, hits: QuoteIssueHits): OdooQuoteIssueConfig {
  const next = normalizeQuoteIssueConfig(cfg);
  if (hits.report) {
    next.reportName = String(hits.report.report_name || next.reportName);
  }
  if (hits.tax) {
    next.taxId = asInt(hits.tax.id);
    next.taxName = rowName(hits.tax) || next.taxName;
    if (hits.tax.amount != null && Number(hits.tax.amount) > 0) next.taxAmount = Number(hits.tax.amount);
  }
  if (hits.pricelist) {
    next.pricelistId = asInt(hits.pricelist.id);
    next.pricelistName = rowName(hits.pricelist) || next.pricelistName;
  }
  if (hits.warehouse) {
    next.warehouseId = asInt(hits.warehouse.id);
    next.warehouseName = rowName(hits.warehouse) || next.warehouseName;
  }
  if (hits.fiscalPosition) {
    next.fiscalPositionId = asInt(hits.fiscalPosition.id);
    next.fiscalPositionName = rowName(hits.fiscalPosition) || next.fiscalPositionName;
  }
  if (hits.paymentTerm) {
    next.paymentTermId = asInt(hits.paymentTerm.id);
    next.paymentTermName = rowName(hits.paymentTerm) || next.paymentTermName;
  }
  if (hits.company) {
    next.companyId = asInt(hits.company.id);
    if (hits.company.vat) next.companyVat = String(hits.company.vat).replace(/\D/g, "") || next.companyVat;
  }
  if (hits.identificationType) {
    next.identificationTypeId = asInt(hits.identificationType.id);
    next.identificationTypeName = rowName(hits.identificationType) || next.identificationTypeName;
  }
  for (const bind of hits.products || []) {
    const p = next.products.find((x) => x.key === bind.key);
    if (!p) continue;
    if (bind.row) {
      p.productId = asInt(bind.row.id);
      p.productName = rowName(bind.row);
      if (bind.row.default_code) p.defaultCode = String(bind.row.default_code).trim().toUpperCase();
    }
  }
  return next;
}

export type QuoteIssueCheck = { key: string; ok: boolean; id: number | null; label: string; error?: string };

export function quoteIssueChecks(cfg: OdooQuoteIssueConfig): QuoteIssueCheck[] {
  const row = (key: string, id: number | null, label: string, required = true): QuoteIssueCheck => ({
    key,
    ok: required ? Boolean(id) : true,
    id,
    label,
    error: required && !id ? "No resuelto en Odoo" : undefined,
  });
  const checks: QuoteIssueCheck[] = [
    { key: "reportName", ok: Boolean(cfg.reportName), id: null, label: cfg.reportName || "reporte", error: cfg.reportName ? undefined : "Falta report_name" },
    row("companyId", cfg.companyId, cfg.companyVat),
    row("taxId", cfg.taxId, `${cfg.taxName} ${cfg.taxAmount}%`),
    row("pricelistId", cfg.pricelistId, cfg.pricelistName),
    row("warehouseId", cfg.warehouseId, cfg.warehouseName),
    row("fiscalPositionId", cfg.fiscalPositionId, cfg.fiscalPositionName),
    row("paymentTermId", cfg.paymentTermId, cfg.paymentTermName),
    row("identificationTypeId", cfg.identificationTypeId, cfg.identificationTypeName, false),
  ];
  for (const p of cfg.products) {
    const required = Boolean(p.defaultCode);
    checks.push(row(`product:${p.key}`, p.productId, `${p.measure} ${p.usage} [${p.defaultCode || "sin código"}]`, required));
  }
  return checks;
}
