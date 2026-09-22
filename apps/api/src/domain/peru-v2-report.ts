/**
 * Réplica ZDRY del reporte Odoo «Perú – Presupuesto/Pedido versión 2»
 * (sale.report_saleorder_copy_1_copy_4). Odoo 18 no entrega el QWeb por RPC;
 * este contrato arma el mismo documento con datos ya persistidos en ZDRY.
 *
 * Bloques del PDF Odoo (validados contra 10020263884) → fuente ZDRY:
 * 1. Membrete ZGROUP (logo oso, slogan, RUC, domicilio) → letterhead
 * 2. Cliente SUNAT (razón, domicilio, tel, mail, contacto, VAT) → Customer + User
 * 3. COTIZACIÓN N° → odooSaleName || number
 * 4. Referencia / fecha / validez / comercial → number, createdAt, validityDays, vendor
 * 5. Asunto (VENTA DE CONTENEDOR DRY …) → saleAsunto
 * 6. Líneas ISO · descripción · P.U. · cant · total (sin IGV) → QuoteLine
 * 7. Condiciones (IGV, plazo, moneda, entrega) → quote-issue defaults
 * 8. Cuentas corrientes ZGROUP → letterhead.banks
 * 9. NO INCLUYE + términos → DEFAULT_QUOTE_NOTE
 */

import { DEFAULT_QUOTE_NOTE, defaultQuoteIssueConfig } from "./odoo-quote-issue";
import { measureFromType, saleAsunto, usageFromCat, usageLabel, validityDate } from "./quote-issue-draft";

export type PeruV2Bank = { kind: string; bank: string; account: string };

export type PeruV2Line = {
  n: number;
  iso: string;
  description: string;
  qty: number;
  priceUnit: number;
  priceFinal: number;
};

export type PeruV2Report = {
  saleName: string;
  reference: string;
  quoteDate: string;
  validUntil: string;
  validityLabel: string;
  commercial: string;
  asunto: string;
  customerName: string;
  customerVat: string;
  customerAddress: string;
  customerPhone: string;
  customerEmail: string;
  contactName: string;
  contactPhone: string;
  currencyLabel: string;
  paymentTerm: string;
  deliveryTime: string;
  deliveryPlace: string;
  taxNote: string;
  note: string;
  lines: PeruV2Line[];
  letterhead: {
    name: string;
    slogan: string;
    tagline: string;
    vat: string;
    address: string;
    banks: PeruV2Bank[];
  };
};

export const ZGROUP_LETTERHEAD = {
  name: "ZGROUP S.A.C.",
  slogan: "LÍDERES EN LA CADENA DE FRÍO",
  tagline: "INGENIERÍA EN FRÍO",
  vat: "20521180774",
  address: "Calle Ordoner Vargas 142 / Lima / Perú",
  banks: [
    { kind: "CTA. CORRIENTE", bank: "BANCO DE CRÉDITO DEL PERÚ - MONEDA DOLARES", account: "191-1755511-1-67 / 00219100175551116756" },
    { kind: "CTA. CORRIENTE", bank: "BANCO DE CRÉDITO DEL PERÚ - MONEDA SOLES", account: "191-1876416-0-95 / 00219100187641609550" },
    { kind: "CTA. CORRIENTE", bank: "SCOTIABANK - MONEDA DOLARES", account: "0003812201 / 00908100000381220116" },
    { kind: "CTA. CORRIENTE", bank: "SCOTIABANK - MONEDA SOLES", account: "0000035893 / 00908100000003589311" },
    { kind: "CTA. CORRIENTE", bank: "BBVA PERÚ - MONEDA DOLARES", account: "0011-0261-00-00327322 / 01126100010003273258" },
    { kind: "DETRACCIÓN", bank: "BANCO DE LA NACIÓN - MONEDA SOLES", account: "00-0030011740" },
  ] as PeruV2Bank[],
};

export function formatPeDate(raw: Date | string | null | undefined): string {
  const d = raw instanceof Date ? raw : raw ? new Date(raw) : new Date();
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || "";
  return `${pick("month")}/${pick("day")}/${pick("year")}`;
}

/** Domicilio como en el PDF Odoo: calle-distrito-ciudad-Perú */
export function reportAddress(c: {
  street?: string | null;
  district?: string | null;
  province?: string | null;
  department?: string | null;
}): string {
  const street = String(c.street || "").replace(/\s+/g, " ").trim();
  const district = String(c.district || "").replace(/\s+/g, " ").trim();
  const city = String(c.province || c.department || "").replace(/\s+/g, " ").trim();
  const extras = [district, city].filter((p) => p && !street.toUpperCase().includes(p.toUpperCase()));
  const core = [street, ...extras].filter(Boolean).join("-");
  if (!core) return "";
  return /per[uú]/i.test(core) ? core : `${core}-Perú`;
}

export function moneyReport(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function peruV2Missing(r: PeruV2Report): string[] {
  const miss: string[] = [];
  if (!r.saleName) miss.push("número de cotización");
  if (!r.customerName) miss.push("razón social");
  if (!r.customerVat) miss.push("RUC");
  if (!r.lines.length) miss.push("líneas");
  return miss;
}

export function buildPeruV2Report(input: {
  number: string;
  odooSaleName?: string | null;
  kind?: string | null;
  createdAt?: Date | string | null;
  vendorName?: string | null;
  contactName?: string | null;
  dispatchNotes?: string | null;
  customer: {
    companyName?: string | null;
    rucDni?: string | null;
    email?: string | null;
    phone?: string | null;
    street?: string | null;
    district?: string | null;
    province?: string | null;
    department?: string | null;
  };
  lines: Array<{ iso: string; type?: string | null; cat?: string | null; priceNet?: number | null; name?: string | null }>;
  extras?: Array<{ label: string; amount: number }>;
  validityDays?: number;
  validityLabel?: string;
  deliveryTime?: string;
  deliveryPlace?: string;
  paymentTerm?: string;
  note?: string;
}): PeruV2Report {
  const cfg = defaultQuoteIssueConfig();
  const days = input.validityDays ?? cfg.defaults.validityDays;
  const created = input.createdAt instanceof Date ? input.createdAt : input.createdAt ? new Date(input.createdAt) : new Date();
  const validIso = validityDate(created, days);
  const draft = input.lines.map((l) => {
    const measure = measureFromType(l.type || "") || String(l.type || "").toUpperCase();
    const usage = usageFromCat(l.cat || "");
    return {
      iso: l.iso,
      measure,
      usage,
      priceNet: Number(l.priceNet) || 0,
      name: l.name || `${l.iso} - CONTENEDOR DRY ${measure} ${usageLabel(usage)}`,
    };
  });
  const extras = (input.extras || []).filter((e) => Number(e.amount) > 0);
  const lines: PeruV2Line[] = [
    ...draft.map((l, i) => ({
      n: i + 1,
      iso: l.iso,
      description: l.name,
      qty: 1,
      priceUnit: l.priceNet,
      priceFinal: l.priceNet,
    })),
    ...extras.map((e, i) => ({
      n: draft.length + i + 1,
      iso: "",
      description: e.label,
      qty: 1,
      priceUnit: e.amount,
      priceFinal: e.amount,
    })),
  ];
  return {
    saleName: String(input.odooSaleName || input.number).trim(),
    reference: input.number,
    quoteDate: formatPeDate(created),
    validUntil: formatPeDate(`${validIso}T12:00:00.000-05:00`),
    validityLabel: input.validityLabel || cfg.defaults.validityLabel,
    commercial: String(input.vendorName || "").trim(),
    asunto: saleAsunto(input.kind === "alquiler" ? "alquiler" : "venta", draft),
    customerName: String(input.customer.companyName || "").trim(),
    customerVat: String(input.customer.rucDni || "").replace(/\D/g, ""),
    customerAddress: reportAddress(input.customer),
    customerPhone: String(input.customer.phone || "").trim(),
    customerEmail: String(input.customer.email || "").trim(),
    contactName: String(input.contactName || "").trim(),
    contactPhone: String(input.customer.phone || "").trim(),
    currencyLabel: "Dolares Americanos",
    paymentTerm: input.paymentTerm || cfg.paymentTermName,
    deliveryTime: input.deliveryTime || cfg.defaults.deliveryTime,
    deliveryPlace: (input.dispatchNotes || "").trim() || input.deliveryPlace || cfg.defaults.deliveryPlace,
    taxNote: "No incluyen IGV",
    note: input.note || DEFAULT_QUOTE_NOTE,
    lines,
    letterhead: { ...ZGROUP_LETTERHEAD },
  };
}
