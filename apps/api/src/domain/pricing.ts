/** Reglas jerárquicas de precio — oráculo zdry_prototype_26.html (PRICING_RULES / resolveRule). */

import { applyShowPrice, type VisibilityRule } from "./visibility";

export type PricingScope = "global" | "category" | "manufacturer" | "container" | "type";

export type PricingRule = {
  id?: string;
  scope: PricingScope | string;
  target?: string | null;
  marginPct: number;
  maxDiscountPct: number;
};

export type PricedUnit = {
  iso: string;
  type: string;
  cat: string;
  manufacturer?: string | null;
  fobCif?: number | null;
};

export function pricingSpecificity(scope: string): number {
  return ({ global: 1, type: 2, category: 2, manufacturer: 3, container: 4 } as Record<string, number>)[scope] || 0;
}

export function resolvePricingRule(unit: PricedUnit, rules: PricingRule[]): PricingRule | null {
  const matches = rules.filter((r) => {
    if (r.scope === "global") return true;
    if (r.scope === "type") return r.target === unit.type;
    if (r.scope === "category") return r.target === unit.cat;
    if (r.scope === "manufacturer") return r.target === unit.manufacturer;
    if (r.scope === "container") return r.target === unit.iso;
    return false;
  });
  matches.sort((a, b) => pricingSpecificity(b.scope) - pricingSpecificity(a.scope));
  return matches[0] || null;
}

export function defaultAcquisition(type: string): number {
  if (type.startsWith("20")) return 2800;
  if (type === "45HC") return 5200;
  return 4200;
}

export type AcquisitionRef = {
  type: string;
  cat: string | null;
  amount: number;
};

export const ACQUISITION_REFS_KEY = "acquisition_refs";

export const DEFAULT_ACQUISITION_REFS: AcquisitionRef[] = [
  { type: "20GP", cat: null, amount: 2800 },
  { type: "20OT", cat: null, amount: 2800 },
  { type: "20FR", cat: null, amount: 2800 },
  { type: "40GP", cat: null, amount: 4200 },
  { type: "40HC", cat: null, amount: 4200 },
  { type: "40OT", cat: null, amount: 4200 },
  { type: "40FR", cat: null, amount: 4200 },
  { type: "45HC", cat: null, amount: 5200 },
  { type: "HT", cat: null, amount: 4200 },
];

export function normalizeAcquisitionRefs(raw: unknown): AcquisitionRef[] {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { refs?: unknown }).refs) ? (raw as { refs: unknown[] }).refs : []);
  const out: AcquisitionRef[] = [];
  for (const row of list) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const type = String(r.type || "").trim().toUpperCase();
    const cat = String(r.cat || "").trim().toUpperCase() || null;
    const amount = Number(r.amount);
    if (!type || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({ type, cat, amount: Math.round(amount * 100) / 100 });
  }
  return out;
}

export function effectiveAcquisitionRefs(refs?: AcquisitionRef[] | null): AcquisitionRef[] {
  return refs?.length ? refs : DEFAULT_ACQUISITION_REFS;
}

export function resolveAcquisition(unit: PricedUnit, refs?: AcquisitionRef[] | null) {
  if (unit.fobCif && unit.fobCif > 0) {
    return { amount: Number(unit.fobCif), kind: "fobCif" as const, type: unit.type, cat: unit.cat || null };
  }
  const list = effectiveAcquisitionRefs(refs);
  const type = String(unit.type || "").toUpperCase();
  const cat = String(unit.cat || "").toUpperCase() || null;
  const typedCat = cat ? list.find((r) => r.type === type && r.cat === cat) : null;
  if (typedCat) return { amount: typedCat.amount, kind: "refTypeCat" as const, type, cat };
  const typed = list.find((r) => r.type === type && !r.cat);
  if (typed) return { amount: typed.amount, kind: "refType" as const, type, cat: null };
  return { amount: defaultAcquisition(unit.type), kind: "defaultType" as const, type, cat: null };
}

export function computeListPrices(
  unit: PricedUnit,
  rules: PricingRule[],
  refs?: AcquisitionRef[] | null,
): { priceList: number; priceMin: number; marginPct: number; maxDiscountPct: number; base: number } {
  const rule = resolvePricingRule(unit, rules) || { scope: "global", marginPct: 22, maxDiscountPct: 10 };
  const acq = resolveAcquisition(unit, refs);
  const base = acq.amount;
  const margin = Number(rule.marginPct) || 22;
  const maxDisc = Number(rule.maxDiscountPct) || 10;
  const priceList = Math.round(base / (1 - margin / 100));
  const priceMin = Math.round(priceList * (1 - maxDisc / 100));
  return { priceList, priceMin, marginPct: margin, maxDiscountPct: maxDisc, base };
}

/** Regla 4 / 19: el neto no puede bajar del piso de lista salvo override de Gerente. */
export function assertPriceFloor(priceNet: number, priceMin: number, override: boolean): { ok: true } | { ok: false; message: string } {
  if (priceNet + 1e-9 >= priceMin) return { ok: true };
  if (override) return { ok: true };
  return {
    ok: false,
    message: "El precio no puede bajar del piso de lista. Solo el Gerente de Ventas puede autorizar una excepción.",
  };
}

export const IGV_RATE = 0.18;
export function igvOf(net: number): number {
  return Math.round(net * IGV_RATE * 100) / 100;
}
export function grossOf(net: number): number {
  return Math.round(net * (1 + IGV_RATE) * 100) / 100;
}
export function moneyUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function netFromGross(gross: number): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.round((gross / (1 + IGV_RATE)) * 100) / 100;
}

export function parseMoneyAmount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export type OfferVisibilityMode = "show" | "request" | "inherit";

export type OfferSnapshot = {
  priceList?: number | null;
  priceMin?: number | null;
  priceSource?: string | null;
  showPriceOverride?: boolean | null;
  adjustedByName?: string | null;
  adjustedAt?: Date | string | null;
};

const SCOPE_LABEL: Record<string, string> = {
  global: "regla global",
  type: "regla por tipo",
  category: "regla por condición",
  manufacturer: "regla por fabricante",
  container: "regla por unidad",
};

export function visibilityModeOf(override: boolean | null | undefined): OfferVisibilityMode {
  if (override === true) return "show";
  if (override === false) return "request";
  return "inherit";
}

export function overrideFromVisibilityMode(mode: OfferVisibilityMode | string | null | undefined): boolean | null {
  if (mode === "show") return true;
  if (mode === "request") return false;
  return null;
}

export function describeOffer(
  unit: PricedUnit & { depotId?: string | null; status?: string },
  rules: PricingRule[],
  visRules: VisibilityRule[],
  stored: OfferSnapshot,
  refs?: AcquisitionRef[] | null,
) {
  const computed = computeListPrices(unit, rules, refs);
  const source = stored.priceSource === "manual" ? "manual" : "rule";
  const priceList = stored.priceList != null && stored.priceList > 0 ? stored.priceList : computed.priceList;
  const priceMin = stored.priceMin != null && stored.priceMin > 0 ? stored.priceMin : computed.priceMin;
  const rule = resolvePricingRule(unit, rules) || { scope: "global", target: null, marginPct: 22, maxDiscountPct: 10 };
  const acq = resolveAcquisition(unit, refs);
  const base = acq.amount;
  const baseKind = acq.kind;
  const baseLabel =
    acq.kind === "fobCif"
      ? `costo FOB/CIF ${moneyUsd(base)}`
      : acq.kind === "refTypeCat"
        ? `costo de referencia ${unit.type} · ${unit.cat} (${moneyUsd(base)})`
        : `costo de referencia del tipo ${unit.type} (${moneyUsd(base)})`;
  const ruleLabel = `${SCOPE_LABEL[rule.scope] || rule.scope}${rule.target ? ` ${rule.target}` : ""}`;
  const title = source === "manual"
    ? stored.adjustedByName
      ? `Precio de oferta fijado por ${stored.adjustedByName}`
      : "Precio de oferta fijado a mano"
    : `Precio calculado (${ruleLabel})`;
  const detail = source === "manual"
    ? `El administrador reemplazó la lista. La regla actual (${ruleLabel}) partiría de ${baseLabel} con margen ${computed.marginPct}% → neto ${moneyUsd(computed.priceList)}.`
    : `Sale de ${baseLabel} + margen ${computed.marginPct}% (${ruleLabel}). Piso comercial ${moneyUsd(priceMin)} (dto. máx. ${computed.maxDiscountPct}%).`;
  const mode = visibilityModeOf(stored.showPriceOverride);
  const inheritedShow = applyShowPrice(
    {
      iso: unit.iso,
      type: unit.type,
      cat: unit.cat,
      manufacturer: unit.manufacturer,
      depotId: unit.depotId,
      priceVisibilityOverride: stored.showPriceOverride,
      status: unit.status,
    },
    visRules,
  );
  const visibilityLabel =
    mode === "show"
      ? "Mostrar precio en el catálogo (decisión de esta unidad)."
      : mode === "request"
        ? "No mostrar precio: el cliente ve «Solicitar precio»."
        : inheritedShow
          ? "Según reglas: esta unidad muestra precio (p. ej. fabricante CIMC)."
          : "Según reglas: esta unidad no muestra precio; el cliente consulta.";
  return {
    source,
    title,
    detail,
    base,
    baseKind,
    ruleScope: rule.scope,
    ruleTarget: rule.target || null,
    marginPct: computed.marginPct,
    maxDiscountPct: computed.maxDiscountPct,
    suggestedList: computed.priceList,
    suggestedMin: computed.priceMin,
    priceList,
    priceMin,
    igv: igvOf(priceList),
    gross: grossOf(priceList),
    showPrice: inheritedShow,
    visibility: mode,
    visibilityLabel,
    adjustedByName: stored.adjustedByName || null,
    adjustedAt: stored.adjustedAt ? new Date(stored.adjustedAt).toISOString() : null,
  };
}

export const DEFAULT_PRICING_RULES: PricingRule[] = [
  { scope: "global", target: null, marginPct: 22, maxDiscountPct: 10 },
  { scope: "category", target: "1TRIP", marginPct: 14, maxDiscountPct: 5 },
  { scope: "category", target: "ASIS", marginPct: 35, maxDiscountPct: 15 },
  { scope: "manufacturer", target: "CIMC", marginPct: 20, maxDiscountPct: 8 },
];
