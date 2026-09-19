import { inspectOdooIso, type OdooOwnedField } from "./odoo-lot-map";
import { mapLotPayloadToOwned, type NormalizedOdooEvent } from "./odoo-event";

export const ODOO_DOC_KINDS = ["purchase", "bill", "picking_in", "picking_out", "mo", "sale"] as const;
export type OdooDocKind = (typeof ODOO_DOC_KINDS)[number];

export type TimelineDiff = {
  field: string;
  before: string | null;
  after: string | null;
  applied: boolean;
};

export type DocDraft = {
  kind: OdooDocKind;
  odooModel: string;
  odooId: number;
  name: string;
  summary: string;
  data: Record<string, unknown>;
};

export type NoteDraft = {
  body: string;
  author: string | null;
  odooMessageId: number | null;
  occurredAt: string | null;
};

function asText(v: unknown): string | null {
  if (v == null || v === false || v === "") return null;
  const t = String(v).trim();
  return t || null;
}

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fingerprint(data: Record<string, unknown>): string {
  return JSON.stringify(data, Object.keys(data).sort());
}

export function sameSnapshotData(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  return fingerprint(a || {}) === fingerprint(b || {});
}

export function fieldDiffs(
  before: Partial<Record<OdooOwnedField | "qtyOnHand", unknown>> | null | undefined,
  after: Partial<Record<OdooOwnedField | "qtyOnHand", unknown>> | null | undefined,
  appliedFields?: string[],
): TimelineDiff[] {
  const left = before || {};
  const right = after || {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])] as Array<OdooOwnedField | "qtyOnHand">;
  const out: TimelineDiff[] = [];
  for (const field of keys) {
    const b = left[field] == null || left[field] === "" ? null : String(left[field]);
    const a = right[field] == null || right[field] === "" ? null : String(right[field]);
    if (b === a) continue;
    out.push({
      field,
      before: b,
      after: a,
      applied: !appliedFields || appliedFields.includes(field),
    });
  }
  return out;
}

export function diffsFromLotWrite(
  current: Partial<Record<OdooOwnedField, unknown>> | undefined,
  payload: Record<string, unknown>,
  applied: Partial<Record<OdooOwnedField, unknown>>,
  conflicts: Array<{ field: string }>,
): TimelineDiff[] {
  const incoming = mapLotPayloadToOwned(payload);
  const blocked = new Set(conflicts.map((c) => c.field));
  const before: Partial<Record<OdooOwnedField, unknown>> = {};
  const after: Partial<Record<OdooOwnedField, unknown>> = {};
  for (const field of Object.keys(incoming) as OdooOwnedField[]) {
    before[field] = current?.[field];
    after[field] = incoming[field];
  }
  return fieldDiffs(before, after).map((d) => ({
    ...d,
    applied: !blocked.has(d.field) && Object.prototype.hasOwnProperty.call(applied, d.field),
  }));
}

function listIsos(payload: Record<string, unknown>, fallback?: string | null): string[] {
  const raw = payload.isos;
  const extra = Array.isArray(raw) ? raw.map((v) => String(v || "").trim()).filter(Boolean) : [];
  if (fallback) extra.push(fallback);
  return [...new Set(extra.map((s) => inspectOdooIso(s).isoNormalized || s).filter(Boolean))];
}

export function isosForEvent(ev: Pick<NormalizedOdooEvent, "iso" | "isoNormalized" | "payload">): string[] {
  return listIsos(ev.payload, ev.isoNormalized || ev.iso);
}

export function snapshotFromEvent(ev: NormalizedOdooEvent): DocDraft | null {
  const p = ev.payload;
  const id = ev.resId || asNum(p.odoo_id ?? p.id);
  if (ev.event === "po_confirm") {
    const name = asText(p.po_name || p.name) || ev.iso || "OC";
    const data = {
      name,
      partner: asText(p.partner || p.partner_name),
      state: asText(p.state),
      currency: asText(p.currency),
      amountTotal: p.amount_total ?? p.amountTotal ?? null,
      qtyReceived: p.qty_received ?? p.qtyReceived ?? null,
      date: asText(p.date_order || p.date),
    };
    return { kind: "purchase", odooModel: ev.model || "purchase.order", odooId: id, name, summary: [data.partner, data.state].filter(Boolean).join(" · "), data };
  }
  if (ev.event === "bill_posted") {
    const name = asText(p.bill_name || p.name) || "Factura";
    const pos = Array.isArray(p.po_names) ? p.po_names.map(String) : [];
    const data = {
      name,
      partner: asText(p.partner),
      state: asText(p.state) || "posted",
      amountTotal: p.amount_total ?? null,
      currency: asText(p.currency),
      date: asText(p.invoice_date || p.date),
      poNames: pos,
    };
    return { kind: "bill", odooModel: ev.model || "account.move", odooId: id, name, summary: [data.partner, pos.join(", ")].filter(Boolean).join(" · "), data };
  }
  if (ev.event === "picking_in_done" || ev.event === "picking_out_done") {
    const name = asText(p.picking_name || p.name) || "Albarán";
    const kind = ev.event === "picking_in_done" ? "picking_in" : "picking_out";
    const data = {
      name,
      pickingType: asText(p.picking_type),
      origin: asText(p.origin),
      date: asText(p.date_done || p.date),
      locationSrc: asText(p.location_src || p.location),
      locationDest: asText(p.location_dest),
      lotIds: p.lot_ids || [],
      isos: p.isos || [],
    };
    return { kind, odooModel: ev.model || "stock.picking", odooId: id, name, summary: [data.origin, data.date].filter(Boolean).join(" · "), data };
  }
  if (ev.event === "mo_done") {
    const name = asText(p.mo_name || p.name) || "MO";
    const data = {
      name,
      state: asText(p.state) || "done",
      productFinished: asText(p.product_finished || p.product),
      productCode: asText(p.product_code),
      sourceProduct: asText(p.source_product),
      sourceLotIds: p.source_lot_ids || [],
      date: asText(p.date_finished || p.date),
    };
    return { kind: "mo", odooModel: ev.model || "mrp.production", odooId: id, name, summary: [data.productFinished, data.sourceProduct].filter(Boolean).join(" ← "), data };
  }
  if (ev.event === "sale_state") {
    const name = asText(p.so_name || p.name) || "SO";
    const data = {
      name,
      state: asText(p.state),
      invoiceStatus: asText(p.invoice_status),
    };
    return { kind: "sale", odooModel: ev.model || "sale.order", odooId: id, name, summary: [data.state, data.invoiceStatus].filter(Boolean).join(" · "), data };
  }
  return null;
}

export function noteFromEvent(ev: NormalizedOdooEvent): NoteDraft | null {
  if (ev.event !== "lot_note") return null;
  const body = asText(ev.payload.body || ev.payload.note);
  if (!body) return null;
  return {
    body,
    author: asText(ev.payload.author || ev.payload.author_name),
    odooMessageId: asNum(ev.payload.note_id || ev.payload.message_id) || null,
    occurredAt: asText(ev.payload.date || ev.sourceWriteDate),
  };
}

export function backfillDocsFromCandidate(cand: {
  isoNormalized: string;
  odooPoId?: number | null;
  odooPoName?: string | null;
  odooVendorName?: string | null;
  odooBillName?: string | null;
  odooUnitPrice?: unknown;
  odooPickingName?: string | null;
  odooMoName?: string | null;
  odooIntakeKind?: string | null;
  odooSourceProductCode?: string | null;
  odooSourceLotId?: number | null;
}): DocDraft[] {
  const out: DocDraft[] = [];
  if (cand.odooPoName) {
    out.push({
      kind: "purchase",
      odooModel: "purchase.order",
      odooId: cand.odooPoId || 0,
      name: cand.odooPoName,
      summary: [cand.odooVendorName, cand.odooUnitPrice != null ? `USD ${cand.odooUnitPrice}` : ""].filter(Boolean).join(" · "),
      data: { name: cand.odooPoName, partner: cand.odooVendorName, unitPrice: cand.odooUnitPrice ?? null, source: "j1_backfill" },
    });
  }
  if (cand.odooBillName) {
    out.push({
      kind: "bill",
      odooModel: "account.move",
      odooId: 0,
      name: cand.odooBillName,
      summary: cand.odooPoName || "",
      data: { name: cand.odooBillName, poNames: cand.odooPoName ? [cand.odooPoName] : [], source: "j1_backfill" },
    });
  }
  if (cand.odooPickingName && cand.odooIntakeKind === "purchase") {
    out.push({
      kind: "picking_in",
      odooModel: "stock.picking",
      odooId: 0,
      name: cand.odooPickingName,
      summary: cand.odooPoName || "",
      data: { name: cand.odooPickingName, origin: cand.odooPoName, source: "j1_backfill" },
    });
  }
  if (cand.odooMoName || cand.odooIntakeKind === "fabrication") {
    const name = cand.odooMoName || cand.odooPickingName || "MO";
    out.push({
      kind: "mo",
      odooModel: "mrp.production",
      odooId: 0,
      name,
      summary: cand.odooSourceProductCode ? `era ${cand.odooSourceProductCode}` : "",
      data: {
        name,
        sourceProduct: cand.odooSourceProductCode,
        sourceLotIds: cand.odooSourceLotId ? [cand.odooSourceLotId] : [],
        source: "j1_backfill",
      },
    });
  }
  return out;
}

export const FICHA_FIELD_LABELS: Record<string, string> = {
  color: "Color",
  tareKg: "Tara (kg)",
  mgwKg: "Peso (kg)",
  year: "Año",
  manufacturer: "Fabricante",
  dua: "DUA",
  originCountry: "Procedencia",
  material: "Material",
  qtyOnHand: "Cantidad",
};

export type EvolutionStep = {
  value: string | null;
  source: string;
  event?: string | null;
  at: string;
  applied?: boolean;
};

export type FieldEvolution = {
  field: string;
  label: string;
  current: string | null;
  steps: EvolutionStep[];
};

export function fieldEvolution(
  rows: Array<{
    field: string;
    before: string | null;
    after: string | null;
    source: string;
    event?: string | null;
    createdAt: Date | string;
    applied?: boolean;
  }>,
): FieldEvolution[] {
  const by = new Map<string, typeof rows>();
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const row of sorted) {
    const list = by.get(row.field) || [];
    list.push(row);
    by.set(row.field, list);
  }
  return [...by.entries()].map(([field, list]) => {
    const steps: EvolutionStep[] = [];
    list.forEach((row, i) => {
      const at = typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString();
      const applied = row.applied !== false;
      if (i === 0 && row.before) {
        steps.push({ value: row.before, source: "prev", at, applied: true });
      }
      steps.push({ value: row.after, source: row.source, event: row.event, at, applied });
    });
    const live = [...steps].reverse().find((s) => s.applied !== false);
    return {
      field,
      label: FICHA_FIELD_LABELS[field] || field,
      current: live?.value ?? steps[steps.length - 1]?.value ?? null,
      steps,
    };
  });
}
