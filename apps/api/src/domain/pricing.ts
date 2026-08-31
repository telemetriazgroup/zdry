/** Reglas jerárquicas de precio — oráculo zdry_prototype_26.html (PRICING_RULES / resolveRule). */

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

export function computeListPrices(unit: PricedUnit, rules: PricingRule[]): { priceList: number; priceMin: number; marginPct: number; maxDiscountPct: number } {
  const rule = resolvePricingRule(unit, rules) || { scope: "global", marginPct: 22, maxDiscountPct: 10 };
  const base = unit.fobCif && unit.fobCif > 0 ? unit.fobCif : defaultAcquisition(unit.type);
  const margin = Number(rule.marginPct) || 22;
  const maxDisc = Number(rule.maxDiscountPct) || 10;
  const priceList = Math.round(base / (1 - margin / 100));
  const priceMin = Math.round(priceList * (1 - maxDisc / 100));
  return { priceList, priceMin, marginPct: margin, maxDiscountPct: maxDisc };
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

export const DEFAULT_PRICING_RULES: PricingRule[] = [
  { scope: "global", target: null, marginPct: 22, maxDiscountPct: 10 },
  { scope: "category", target: "1TRIP", marginPct: 14, maxDiscountPct: 5 },
  { scope: "category", target: "ASIS", marginPct: 35, maxDiscountPct: 15 },
  { scope: "manufacturer", target: "CIMC", marginPct: 20, maxDiscountPct: 8 },
];
