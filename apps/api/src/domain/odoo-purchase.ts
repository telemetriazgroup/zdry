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

/** Un stock.move con N seriales: todos heredan la misma OC/precio. */
export function assignRefsBySharedMove(
  lines: Array<{ lotId: number; moveId: number }>,
  refByMoveId: Map<number, OdooPurchaseRef>,
): Map<number, OdooPurchaseRef> {
  const out = new Map<number, OdooPurchaseRef>();
  for (const line of lines) {
    const lotId = Number(line.lotId);
    const ref = refByMoveId.get(Number(line.moveId));
    if (!lotId || !ref?.odooPoName) continue;
    out.set(lotId, ref);
  }
  return out;
}

export function applySerialTextRefs(
  noteLines: Array<{ name?: string | null; orderId?: number | null }>,
  byIso: Map<string, number>,
  refByOrder: Map<number, OdooPurchaseRef>,
  existing: Map<number, OdooPurchaseRef> = new Map(),
): Map<number, OdooPurchaseRef> {
  const out = new Map(existing);
  for (const line of noteLines) {
    const oid = Number(line.orderId) || 0;
    const ref = refByOrder.get(oid);
    if (!ref?.odooPoName) continue;
    for (const iso of parseSerialsFromPoText(String(line.name || ""))) {
      const lotId = byIso.get(iso);
      if (lotId && !out.has(lotId)) out.set(lotId, ref);
    }
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
