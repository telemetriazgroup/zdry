/** Reglas jerárquicas de precio — oráculo zdry_prototype_26.html (PRICING_RULES / resolveRule). */

import { applyShowPrice, type VisibilityRule } from "./visibility";
import { applyOverlays, type OverlayConcept } from "./acquisition-overlay";

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
  costSource?: string | null;
  dryReferential?: number | null;
  odooWarehouse?: string | null;
  odooVendorName?: string | null;
  originCountry?: string | null;
  overlaySkipKeys?: string[] | null;
  overlayExtras?: Array<{ key?: string; label: string; amount: number; note?: string }> | null;
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
  if ((unit.costSource === "referential" || unit.costSource === "mo") && unit.dryReferential && unit.dryReferential > 0) {
    return { amount: Number(unit.dryReferential), kind: "referential" as const, type: unit.type, cat: unit.cat || null };
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

export const SAFETY_MARGIN_KEY = "safety_margin_rules";

/** Grupo anidado. Vacío = global. El que coincide con más criterios reemplaza al resto. */
export type SafetyMarginRule = {
  type: string | null;
  cat: string | null;
  supplier: string | null;
  origin: string | null;
  warehouse: string | null;
  marginPct: number;
  label?: string;
};

function safetyToken(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s || s === "—" || s === "-") return null;
  return s.toUpperCase();
}

function safetyFromLegacy(r: Record<string, unknown>): Pick<SafetyMarginRule, "type" | "cat" | "supplier" | "origin" | "warehouse"> | null {
  const scope = String(r.scope || "").trim();
  if (!scope) return null;
  const target = safetyToken(r.target);
  if (scope === "global") return { type: null, cat: null, supplier: null, origin: null, warehouse: null };
  if (scope === "category" && target) return { type: null, cat: target, supplier: null, origin: null, warehouse: null };
  if (scope === "type" && target) return { type: target, cat: null, supplier: null, origin: null, warehouse: null };
  return null;
}

/** 20% sobre 1000 deja el costo base en 1200. Un solo grupo gana: el más anidado que coincida. */
export function normalizeSafetyMarginRules(raw: unknown): SafetyMarginRule[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules)
      ? (raw as { rules: unknown[] }).rules
      : [];
  const out: SafetyMarginRule[] = [];
  for (const row of list) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const marginPct = Number(r.marginPct);
    if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 80) continue;
    const hasGroup = ["type", "cat", "supplier", "origin", "warehouse"].some((k) => k in r);
    const dims = hasGroup
      ? {
          type: safetyToken(r.type),
          cat: safetyToken(r.cat),
          supplier: safetyToken(r.supplier),
          origin: safetyToken(r.origin),
          warehouse: safetyToken(r.warehouse),
        }
      : safetyFromLegacy(r);
    if (!dims) continue;
    out.push({ ...dims, marginPct: Math.round(marginPct * 100) / 100 });
  }
  return out;
}

export function safetyRuleDepth(rule: SafetyMarginRule): number {
  return [rule.type, rule.cat, rule.supplier, rule.origin, rule.warehouse].filter(Boolean).length;
}

export function safetyRuleLabel(rule: SafetyMarginRule): string {
  const bits = [
    rule.type ? `tipo ${rule.type}` : "",
    rule.cat ? `condición ${rule.cat}` : "",
    rule.supplier ? `proveedor ${rule.supplier}` : "",
    rule.origin ? `procedencia ${rule.origin}` : "",
    rule.warehouse ? `almacén ${rule.warehouse}` : "",
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "global";
}

function safetyRuleMatches(unit: PricedUnit, rule: SafetyMarginRule): boolean {
  if (rule.type && rule.type !== safetyToken(unit.type)) return false;
  if (rule.cat && rule.cat !== safetyToken(unit.cat)) return false;
  if (rule.supplier && rule.supplier !== safetyToken(unit.odooVendorName)) return false;
  if (rule.origin && rule.origin !== safetyToken(unit.originCountry)) return false;
  if (rule.warehouse && rule.warehouse !== safetyToken(unit.odooWarehouse)) return false;
  return true;
}

/** El grupo con más criterios coincidentes gana y reemplaza al global. A igual profundidad, gana el último. */
export function resolveSafetyMargin(unit: PricedUnit, rules?: SafetyMarginRule[] | null): SafetyMarginRule | null {
  let best: SafetyMarginRule | null = null;
  let bestDepth = -1;
  for (const rule of rules || []) {
    if (!safetyRuleMatches(unit, rule)) continue;
    const depth = safetyRuleDepth(rule);
    if (depth >= bestDepth) {
      best = rule;
      bestDepth = depth;
    }
  }
  return best;
}

export function matchingSafetyMargins(unit: PricedUnit, rules?: SafetyMarginRule[] | null): SafetyMarginRule[] {
  const winner = resolveSafetyMargin(unit, rules);
  return winner ? [{ ...winner, label: safetyRuleLabel(winner) }] : [];
}

export function safetyMarginPctOf(unit: PricedUnit, rules?: SafetyMarginRule[] | null): number {
  const winner = resolveSafetyMargin(unit, rules);
  const pct = winner ? Number(winner.marginPct) || 0 : 0;
  return Math.round(Math.min(80, pct) * 100) / 100;
}

export function computeListPrices(
  unit: PricedUnit,
  rules: PricingRule[],
  refs?: AcquisitionRef[] | null,
  overlays?: OverlayConcept[] | null,
  safetyRules?: SafetyMarginRule[] | null,
): {
  priceList: number;
  priceMin: number;
  marginPct: number;
  maxDiscountPct: number;
  base: number;
  rawBase: number;
  overlayTotal: number;
  overlayLines: ReturnType<typeof applyOverlays>["overlays"];
  acqKind: string;
  safetyPct: number;
  safetyAdd: number;
  securedBase: number;
  safetyLines: SafetyMarginRule[];
} {
  const rule = resolvePricingRule(unit, rules) || { scope: "global", marginPct: 22, maxDiscountPct: 10 };
  const acq = resolveAcquisition(unit, refs);
  const applied = applyOverlays(acq, unit, overlays);
  const base = applied.base;
  const safetyLines = matchingSafetyMargins(unit, safetyRules);
  const safetyPct = safetyMarginPctOf(unit, safetyRules);
  const safetyAdd = Math.round((base * safetyPct) / 100);
  const securedBase = base + safetyAdd;
  const margin = Number(rule.marginPct) || 22;
  const maxDisc = Number(rule.maxDiscountPct) || 10;
  const priceList = Math.round(securedBase / (1 - margin / 100));
  const priceMin = Math.round(priceList * (1 - maxDisc / 100));
  return {
    priceList,
    priceMin,
    marginPct: margin,
    maxDiscountPct: maxDisc,
    base,
    rawBase: applied.raw,
    overlayTotal: applied.overlayTotal,
    overlayLines: applied.overlays,
    acqKind: acq.kind,
    safetyPct,
    safetyAdd,
    securedBase,
    safetyLines,
  };
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

function safetyPhrase(lines: SafetyMarginRule[]): string {
  if (!lines.length) return "";
  return lines.map((l) => `${l.marginPct}% ${l.label || safetyRuleLabel(l)}`).join(" + ");
}

export function describeOffer(
  unit: PricedUnit & { depotId?: string | null; status?: string },
  rules: PricingRule[],
  visRules: VisibilityRule[],
  stored: OfferSnapshot,
  refs?: AcquisitionRef[] | null,
  overlays?: OverlayConcept[] | null,
  safetyRules?: SafetyMarginRule[] | null,
) {
  const computed = computeListPrices(unit, rules, refs, overlays, safetyRules);
  const source = stored.priceSource === "manual" ? "manual" : "rule";
  const storedList = stored.priceList != null && stored.priceList > 0 ? stored.priceList : null;
  const storedMin = stored.priceMin != null && stored.priceMin > 0 ? stored.priceMin : null;
  const priceList = source === "manual" && storedList != null ? storedList : computed.priceList;
  const priceMin = source === "manual" && storedMin != null ? storedMin : computed.priceMin;
  const outdated = source !== "manual" && storedList != null && Math.round(storedList) !== computed.priceList;
  const rule = resolvePricingRule(unit, rules) || { scope: "global", target: null, marginPct: 22, maxDiscountPct: 10 };
  const acq = resolveAcquisition(unit, refs);
  const baseKind = acq.kind;
  const overlayBit = computed.overlayTotal
    ? ` + extras ${moneyUsd(computed.overlayTotal)} = base ${moneyUsd(computed.base)}`
    : "";
  const baseLabel =
    acq.kind === "fobCif"
      ? `costo FOB/CIF ${moneyUsd(computed.rawBase)}${overlayBit}`
      : acq.kind === "referential"
        ? `costo referencial DRY ${moneyUsd(computed.rawBase)}${overlayBit}`
        : acq.kind === "refTypeCat"
        ? `costo de referencia ${unit.type} · ${unit.cat} (${moneyUsd(computed.rawBase)})${overlayBit}`
        : `costo de referencia del tipo ${unit.type} (${moneyUsd(computed.rawBase)})${overlayBit}`;
  const ruleLabel = `${SCOPE_LABEL[rule.scope] || rule.scope}${rule.target ? ` ${rule.target}` : ""}`;
  const safetyBit = computed.safetyPct > 0
    ? ` Margen de seguridad ${safetyPhrase(computed.safetyLines)} = +${moneyUsd(computed.safetyAdd)} → costo base ${moneyUsd(computed.securedBase)}.`
    : "";
  const title = source === "manual"
    ? stored.adjustedByName
      ? `Precio de oferta fijado por ${stored.adjustedByName}`
      : "Precio de oferta fijado a mano"
    : `Precio calculado (${ruleLabel})`;
  const detail = source === "manual"
    ? `El administrador reemplazó la lista. La regla actual (${ruleLabel}) partiría de ${baseLabel}.${safetyBit} Con margen ${computed.marginPct}% → neto ${moneyUsd(computed.priceList)}.`
    : computed.safetyPct > 0
      ? `Sale de ${baseLabel}.${safetyBit} Sobre ese costo base, margen ${computed.marginPct}% (${ruleLabel}) → venta ${moneyUsd(computed.priceList)}. Piso ${moneyUsd(priceMin)} (dto. máx. ${computed.maxDiscountPct}% del precio objetivo, sin gerencia).`
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
    base: computed.base,
    rawBase: computed.rawBase,
    securedBase: computed.securedBase,
    safetyPct: computed.safetyPct,
    safetyAdd: computed.safetyAdd,
    safetyLines: computed.safetyLines,
    overlayTotal: computed.overlayTotal,
    overlayLines: computed.overlayLines,
    baseKind,
    ruleScope: rule.scope,
    ruleTarget: rule.target || null,
    marginPct: computed.marginPct,
    maxDiscountPct: computed.maxDiscountPct,
    suggestedList: computed.priceList,
    suggestedMin: computed.priceMin,
    storedList,
    outdated,
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
