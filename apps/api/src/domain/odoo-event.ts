import { inspectOdooIso, type OdooOwnedField } from "./odoo-lot-map";

export const ODOO_BRIDGE_EVENT_TYPES = [
  "lot_write",
  "quant_change",
  "picking_in_done",
  "picking_out_done",
  "po_confirm",
  "bill_posted",
  "sale_state",
  "invoice_posted",
  "lot_note",
  "mo_done",
] as const;

export type OdooBridgeEventType = (typeof ODOO_BRIDGE_EVENT_TYPES)[number];

export const ODOO_WEBHOOK_SECRET_KEY = "odoo_webhook_secret";

export type IncomingOdooEvent = {
  id?: number | null;
  model?: string | null;
  resId?: number | null;
  res_id?: number | null;
  iso?: string | null;
  event?: string | null;
  origin?: string | null;
  payload?: Record<string, unknown> | null;
  writeDate?: string | null;
  write_date?: string | null;
  source_write_date?: string | null;
};

export type NormalizedOdooEvent = {
  odooEventId: number | null;
  model: string;
  resId: number;
  iso: string | null;
  isoNormalized: string | null;
  event: string;
  origin: "odoo" | "zdry";
  payload: Record<string, unknown>;
  sourceWriteDate: string | null;
};

export type LotOwnedPatch = Partial<Record<OdooOwnedField, string | number | null>>;

export type ApplyOdooEventResult =
  | { action: "ignore"; reason: string }
  | {
      action: "apply";
      source: "odoo";
      updates: LotOwnedPatch;
      qtyOnHand?: number | null;
      overwritten?: Array<{ field: OdooOwnedField; localValue: unknown; odooValue: unknown }>;
    }
  | {
      action: "conflict";
      source: "odoo";
      updates: LotOwnedPatch;
      conflicts: Array<{ field: OdooOwnedField; localValue: unknown; odooValue: unknown }>;
    }
  | { action: "refresh"; isos: string[]; lotIds: number[] }
  | { action: "record"; reason: string };

const ODOO_KEY_TO_OWNED: Record<string, OdooOwnedField> = {
  color: "color",
  tara: "tareKg",
  tarekg: "tareKg",
  weight: "mgwKg",
  weight_kg: "mgwKg",
  mgwkg: "mgwKg",
  building_year: "year",
  year: "year",
  nro_dua: "dua",
  dua: "dua",
  procedence: "originCountry",
  procedencia: "originCountry",
  origincountry: "originCountry",
  maker: "manufacturer",
  manufacturer: "manufacturer",
  material: "material",
  tipo_material: "material",
  note: "description",
  description: "description",
  descripcion: "description",
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a == null && (b == null || b === "")) return true;
  if (b == null && (a == null || a === "")) return true;
  return String(a ?? "").trim() === String(b ?? "").trim();
}

export function webhookSecretFrom(setting: unknown, env = process.env.ODOO_ZDRY_WEBHOOK_SECRET || ""): string {
  if (typeof setting === "string" && setting.trim()) return setting.trim();
  if (setting && typeof setting === "object" && !Array.isArray(setting)) {
    const raw = (setting as Record<string, unknown>).secret;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return String(env || "").trim();
}

export function webhookSecretOk(provided: string | undefined, expected: string): boolean {
  if (!expected) return false;
  return String(provided || "").trim() === expected;
}

export function normalizeIncomingEvent(raw: IncomingOdooEvent | null | undefined): NormalizedOdooEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = String(raw.event || "").trim();
  if (!event) return null;
  const iso = raw.iso ? String(raw.iso).trim() : null;
  const inspected = iso ? inspectOdooIso(iso) : null;
  const origin = raw.origin === "zdry" ? "zdry" : "odoo";
  return {
    odooEventId: asNumber(raw.id),
    model: String(raw.model || ""),
    resId: asNumber(raw.resId ?? raw.res_id) || 0,
    iso,
    isoNormalized: inspected?.isoNormalized || null,
    event,
    origin,
    payload: asRecord(raw.payload),
    sourceWriteDate: raw.writeDate || raw.write_date || raw.source_write_date || null,
  };
}

export function mapLotPayloadToOwned(payload: Record<string, unknown> | null | undefined): LotOwnedPatch {
  const src = asRecord(payload);
  const out: LotOwnedPatch = {};
  for (const [key, value] of Object.entries(src)) {
    const folded = key.toLowerCase().replace(/[^a-z0-9_]+/g, "");
    const owned = ODOO_KEY_TO_OWNED[folded] || ODOO_KEY_TO_OWNED[key];
    if (!owned) continue;
    if (owned === "tareKg" || owned === "mgwKg" || owned === "year") {
      const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
      out[owned] = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    } else {
      const t = value == null || value === false ? null : String(value).trim();
      out[owned] = t || null;
    }
  }
  return out;
}

function listIsos(payload: Record<string, unknown>, fallbackIso?: string | null): string[] {
  const raw = payload.isos;
  const fromList = Array.isArray(raw) ? raw.map((v) => String(v || "").trim()).filter(Boolean) : [];
  if (fallbackIso) fromList.push(fallbackIso);
  return [...new Set(fromList)];
}

function listLotIds(payload: Record<string, unknown>, fallbackId?: number): number[] {
  const raw = payload.lot_ids ?? payload.lotIds;
  const fromList = Array.isArray(raw) ? raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0) : [];
  if (fallbackId) fromList.push(fallbackId);
  return [...new Set(fromList)];
}

export function applyOdooEvent(input: {
  event: IncomingOdooEvent;
  localTouched?: boolean;
  current?: Partial<Record<OdooOwnedField, unknown>> & { qtyOnHand?: unknown };
}): ApplyOdooEventResult {
  const ev = normalizeIncomingEvent(input.event);
  if (!ev) return { action: "ignore", reason: "evento vacío" };
  if (ev.origin === "zdry") return { action: "ignore", reason: "anti-eco" };

  if (ev.event === "lot_write") {
    const updates = mapLotPayloadToOwned(ev.payload);
    const keys = Object.keys(updates) as OdooOwnedField[];
    if (!keys.length) return { action: "ignore", reason: "sin campos de ficha" };
    const overwritten: Array<{ field: OdooOwnedField; localValue: unknown; odooValue: unknown }> = [];
    const apply: LotOwnedPatch = {};
    for (const field of keys) {
      const incoming = updates[field];
      const local = input.current?.[field];
      apply[field] = incoming;
      if (input.localTouched && !sameValue(local, incoming) && local != null && local !== "") {
        overwritten.push({ field, localValue: local, odooValue: incoming });
      }
    }
    return { action: "apply", source: "odoo", updates: apply, overwritten };
  }

  if (ev.event === "quant_change") {
    const qty = asNumber(ev.payload.qty_on_hand ?? ev.payload.quantity ?? ev.payload.qty);
    return { action: "apply", source: "odoo", updates: {}, qtyOnHand: qty };
  }

  if (
    ev.event === "picking_in_done" ||
    ev.event === "picking_out_done" ||
    ev.event === "po_confirm" ||
    ev.event === "bill_posted" ||
    ev.event === "mo_done"
  ) {
    return {
      action: "refresh",
      isos: listIsos(ev.payload, ev.iso),
      lotIds: listLotIds(ev.payload, ev.model === "stock.lot" ? ev.resId : 0),
    };
  }

  if (ev.event === "lot_note") {
    return { action: "record", reason: "nota de serie" };
  }

  if (ev.event === "sale_state" || ev.event === "invoice_posted") {
    return { action: "record", reason: `${ev.event} queda en bandeja para Q7 / J5` };
  }

  return { action: "record", reason: `evento ${ev.event} registrado` };
}
