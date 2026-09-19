export const DRY_REFERENTIAL_KEY = "dry_referential_price";

export type DryReferentialSetting = {
  amount: number | null;
  windowMonths: number;
};

export function normalizeDryReferential(raw: unknown): DryReferentialSetting {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const amount = Number(src.amount);
  const windowMonths = Number(src.windowMonths);
  return {
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
    windowMonths: Number.isFinite(windowMonths) && windowMonths > 0 ? Math.min(120, Math.max(1, Math.round(windowMonths))) : 24,
  };
}

/** Promedio de precios OC/factura DRY. Ignora ajustes y ceros. */
export function averageOcUnitPrices(prices: Array<number | null | undefined>): number | null {
  const ok = prices.map(Number).filter((p) => Number.isFinite(p) && p > 0);
  if (!ok.length) return null;
  return Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 100) / 100;
}

export function pricesFromOriginRows(
  rows: Array<{ costSource?: string | null; odooIntakeKind?: string | null; odooUnitPrice?: number | null }>,
): number[] {
  return rows
    .filter((r) => r.odooIntakeKind !== "adjustment" && r.costSource !== "referential")
    .filter((r) => r.costSource === "oc" || r.odooIntakeKind === "purchase")
    .map((r) => Number(r.odooUnitPrice));
}

export function effectiveDryReferential(setting: DryReferentialSetting, computed: number | null): number | null {
  if (setting.amount && setting.amount > 0) return setting.amount;
  return computed && computed > 0 ? computed : null;
}
