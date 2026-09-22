/**
 * Extras de adquisición: almacén Odoo + proveedor OC + one-off por ISO.
 * No mutan fobCif. Se suman a resolveAcquisition antes del margen.
 */

export const ACQUISITION_OVERLAYS_KEY = "acquisition_overlays";

export type OverlayApplies = "oc" | "referential" | "all";
export type OverlayScope = "warehouse" | "vendor";

export type OverlayConcept = {
  id: string;
  key: string;
  label: string;
  amount: number;
  scope: OverlayScope;
  target: string;
  applies: OverlayApplies;
  active: boolean;
};

export type OverlayExtra = {
  key?: string;
  label: string;
  amount: number;
  note?: string;
};

export type OverlayUnit = {
  odooWarehouse?: string | null;
  odooVendorName?: string | null;
  overlaySkipKeys?: string[] | null;
  overlayExtras?: OverlayExtra[] | null;
};

export type OverlayLine = {
  key: string;
  label: string;
  amount: number;
  scope: OverlayScope | "unit";
  target: string;
};

export function slugOverlayKey(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

export function normalizeVendorTarget(name: string | null | undefined): string {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function newId(): string {
  return `ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeOverlayConcepts(raw: unknown): OverlayConcept[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { concepts?: unknown }).concepts)
      ? (raw as { concepts: unknown[] }).concepts
      : [];
  const out: OverlayConcept[] = [];
  for (const row of list) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const scope = r.scope === "vendor" ? "vendor" : r.scope === "warehouse" ? "warehouse" : null;
    const label = String(r.label || "").trim();
    const amount = Number(r.amount);
    const target = scope === "vendor" ? normalizeVendorTarget(String(r.target || "")) : String(r.target || "").trim().toUpperCase();
    if (!scope || !label || !target || !Number.isFinite(amount) || amount < 0) continue;
    const applies: OverlayApplies = r.applies === "oc" || r.applies === "referential" ? r.applies : "all";
    const key = slugOverlayKey(String(r.key || label)) || `c_${out.length + 1}`;
    out.push({
      id: String(r.id || newId()),
      key,
      label,
      amount: Math.round(amount * 100) / 100,
      scope,
      target,
      applies,
      active: r.active !== false,
    });
  }
  return out;
}

export function overlayAppliesTo(applies: OverlayApplies, acqKind: string): boolean {
  const isOc = acqKind === "fobCif";
  if (applies === "all") return true;
  if (applies === "oc") return isOc;
  return !isOc;
}

export function matchOverlayTarget(concept: OverlayConcept, unit: OverlayUnit): boolean {
  if (!concept.active) return false;
  if (concept.scope === "warehouse") {
    return String(unit.odooWarehouse || "").toUpperCase() === concept.target.toUpperCase();
  }
  const vendor = normalizeVendorTarget(unit.odooVendorName);
  return !!vendor && vendor.toLowerCase() === concept.target.toLowerCase();
}

export function applyOverlays(
  acq: { amount: number; kind: string },
  unit: OverlayUnit,
  concepts: OverlayConcept[] | null | undefined,
): { raw: number; overlays: OverlayLine[]; overlayTotal: number; base: number } {
  const raw = Number(acq.amount) || 0;
  const skip = new Set((unit.overlaySkipKeys || []).map((k) => String(k).toLowerCase()));
  const lines: OverlayLine[] = [];
  for (const c of concepts || []) {
    if (!matchOverlayTarget(c, unit)) continue;
    if (!overlayAppliesTo(c.applies, acq.kind)) continue;
    if (skip.has(c.key.toLowerCase()) || skip.has(c.id.toLowerCase())) continue;
    lines.push({
      key: c.key,
      label: c.label,
      amount: c.amount,
      scope: c.scope,
      target: c.target,
    });
  }
  for (const extra of unit.overlayExtras || []) {
    const amount = Number(extra.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const key = slugOverlayKey(extra.key || extra.label) || "unit";
    if (skip.has(key)) continue;
    lines.push({
      key,
      label: extra.label || "Ajuste unidad",
      amount: Math.round(amount * 100) / 100,
      scope: "unit",
      target: "iso",
    });
  }
  const overlayTotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  return { raw, overlays: lines, overlayTotal, base: Math.round((raw + overlayTotal) * 100) / 100 };
}
