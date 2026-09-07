import { inspectOdooIso } from "./odoo-lot-map";

export type OdooPurchaseRef = {
  odooPoId: number | null;
  odooPoName: string | null;
  odooVendorName: string | null;
  odooBillName: string | null;
  odooUnitPrice: number | null;
};

const SERIAL_TOKEN = /[A-Z]{3}[A-Z0-9]\d{6,7}(?:-\d)?/i;

export function parseSerialsFromPoText(text: string): string[] {
  const raw = String(text || "").toUpperCase();
  const found = raw.match(new RegExp(SERIAL_TOKEN.source, "gi")) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of found) {
    const iso = inspectOdooIso(token).isoNormalized;
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push(iso);
  }
  return out;
}

export function purchaseRefFromOrder(input: {
  poId?: number | null;
  poName?: string | null;
  vendorName?: string | null;
  billName?: string | null;
  unitPrice?: number | null;
}): OdooPurchaseRef {
  const price = Number(input.unitPrice);
  return {
    odooPoId: input.poId || null,
    odooPoName: input.poName || null,
    odooVendorName: input.vendorName || null,
    odooBillName: input.billName || null,
    odooUnitPrice: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
  };
}

export const CONDITION_GRADES = ["bueno", "regular", "malo"] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export function parseCondition(v: unknown): ConditionGrade | null {
  const t = String(v || "").trim().toLowerCase();
  return (CONDITION_GRADES as readonly string[]).includes(t) ? (t as ConditionGrade) : null;
}
