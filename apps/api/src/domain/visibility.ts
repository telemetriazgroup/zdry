/** Visibilidad de precio en catálogo — oráculo VISIBILITY_RULES / resolveVisibilityRule. */

export type VisibilityRule = {
  id?: string;
  scope: string;
  target?: string | null;
  show: boolean;
};

export type VisibleUnit = {
  iso: string;
  type: string;
  cat: string;
  manufacturer?: string | null;
  depotId?: string | null;
  priceVisibilityOverride?: boolean | null;
  status?: string;
};

export function visSpecificity(scope: string): number {
  return ({ global: 1, type: 2, category: 2, depot: 2, manufacturer: 3, container: 4 } as Record<string, number>)[scope] || 0;
}

export function resolveVisibilityRule(unit: VisibleUnit, rules: VisibilityRule[]): VisibilityRule | null {
  const matches = rules.filter((r) => {
    if (r.scope === "global") return true;
    if (r.scope === "type") return r.target === unit.type;
    if (r.scope === "category") return r.target === unit.cat;
    if (r.scope === "depot") return r.target === unit.depotId;
    if (r.scope === "manufacturer") return r.target === unit.manufacturer;
    if (r.scope === "container") return r.target === unit.iso;
    return false;
  });
  matches.sort((a, b) => visSpecificity(a.scope) - visSpecificity(b.scope));
  return matches.length ? matches[matches.length - 1] : null;
}

export function applyShowPrice(unit: VisibleUnit, rules: VisibilityRule[]): boolean {
  if (unit.status === "Vendido") return true;
  if (unit.priceVisibilityOverride != null) return !!unit.priceVisibilityOverride;
  const rule = resolveVisibilityRule(unit, rules);
  return rule ? !!rule.show : false;
}

export const DEFAULT_VISIBILITY_RULES: VisibilityRule[] = [
  { scope: "global", target: null, show: false },
  { scope: "manufacturer", target: "CIMC", show: true },
];
