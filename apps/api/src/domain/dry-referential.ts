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

/** Nuevo vs segundo uso. CW/WWT/ASIS se agrupan como segundo uso. */
export function referentialUsage(cat: string | null | undefined): "nuevo" | "segundo_uso" {
  const c = String(cat || "").trim().toUpperCase();
  if (c === "1TRIP" || c === "NUEVO" || c === "NEW" || c.includes("NUEVO")) return "nuevo";
  return "segundo_uso";
}

export type OcPriceRow = {
  type?: string | null;
  cat?: string | null;
  warehouse?: string | null;
  productCode?: string | null;
  odooUnitPrice?: number | null;
  costSource?: string | null;
  odooIntakeKind?: string | null;
  at?: Date | string | null;
};

export type ReferentialBucket = {
  kind: "sku" | "typeUsageWh" | "typeUsage" | "typeWh" | "type";
  type: string;
  usage: "nuevo" | "segundo_uso" | "";
  warehouse: string;
  productCode: string;
  average: number;
  sample: number;
};

export type ReferentialHit = {
  amount: number;
  source: ReferentialBucket["kind"] | "global";
  sample: number;
  type: string;
  usage: "nuevo" | "segundo_uso";
  warehouse: string;
};

function normType(v: string | null | undefined): string {
  return String(v || "").trim().toUpperCase();
}

function normSku(v: string | null | undefined): string {
  return String(v || "").trim().toUpperCase().replace(/[\[\]]/g, "");
}

function normWh(v: string | null | undefined): string {
  return String(v || "").trim().toUpperCase();
}

function inWindow(at: Date | string | null | undefined, windowMonths: number, now = new Date()): boolean {
  if (!at || !windowMonths) return true;
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return true;
  const from = new Date(now.getTime());
  from.setMonth(from.getMonth() - windowMonths);
  return d.getTime() >= from.getTime();
}

export function ocRowsForAverage(rows: OcPriceRow[], windowMonths = 0, now = new Date()): OcPriceRow[] {
  return rows.filter((r) => {
    if (r.odooIntakeKind === "adjustment" || r.costSource === "referential") return false;
    if (!(r.costSource === "oc" || r.odooIntakeKind === "purchase")) return false;
    const p = Number(r.odooUnitPrice);
    if (!Number.isFinite(p) || p <= 0) return false;
    return inWindow(r.at, windowMonths, now);
  });
}

function pushAvg(map: Map<string, number[]>, key: string, price: number) {
  const cur = map.get(key) || [];
  cur.push(price);
  map.set(key, cur);
}

function toBuckets(map: Map<string, number[]>, kind: ReferentialBucket["kind"], parse: (key: string) => Partial<ReferentialBucket>): ReferentialBucket[] {
  const out: ReferentialBucket[] = [];
  for (const [key, prices] of map) {
    const average = averageOcUnitPrices(prices);
    if (average == null) continue;
    out.push({
      kind,
      type: "",
      usage: "",
      warehouse: "",
      productCode: "",
      ...parse(key),
      average,
      sample: prices.length,
    } as ReferentialBucket);
  }
  return out;
}

export function buildReferentialBuckets(rows: OcPriceRow[], windowMonths = 0, now = new Date()): ReferentialBucket[] {
  const oc = ocRowsForAverage(rows, windowMonths, now);
  const sku = new Map<string, number[]>();
  const typeUsageWh = new Map<string, number[]>();
  const typeUsage = new Map<string, number[]>();
  const typeWh = new Map<string, number[]>();
  const typeOnly = new Map<string, number[]>();
  for (const r of oc) {
    const type = normType(r.type);
    const usage = referentialUsage(r.cat);
    const warehouse = normWh(r.warehouse);
    const productCode = normSku(r.productCode);
    const price = Number(r.odooUnitPrice);
    if (productCode && warehouse) pushAvg(sku, `${productCode}|${warehouse}`, price);
    if (type && warehouse) {
      pushAvg(typeUsageWh, `${type}|${usage}|${warehouse}`, price);
      pushAvg(typeWh, `${type}|${warehouse}`, price);
    }
    if (type) {
      pushAvg(typeUsage, `${type}|${usage}`, price);
      pushAvg(typeOnly, type, price);
    }
  }
  return [
    ...toBuckets(sku, "sku", (k) => {
      const [productCode, warehouse] = k.split("|");
      return { productCode, warehouse };
    }),
    ...toBuckets(typeUsageWh, "typeUsageWh", (k) => {
      const [type, usage, warehouse] = k.split("|");
      return { type, usage: usage as ReferentialBucket["usage"], warehouse };
    }),
    ...toBuckets(typeUsage, "typeUsage", (k) => {
      const [type, usage] = k.split("|");
      return { type, usage: usage as ReferentialBucket["usage"] };
    }),
    ...toBuckets(typeWh, "typeWh", (k) => {
      const [type, warehouse] = k.split("|");
      return { type, warehouse };
    }),
    ...toBuckets(typeOnly, "type", (k) => ({ type: k })),
  ];
}

export function lookupDryReferential(
  unit: { type?: string | null; cat?: string | null; odooWarehouse?: string | null; productCode?: string | null },
  buckets: ReferentialBucket[],
  global: number | null,
): ReferentialHit | null {
  const type = normType(unit.type);
  const usage = referentialUsage(unit.cat);
  const warehouse = normWh(unit.odooWarehouse);
  const productCode = normSku(unit.productCode);
  const skuHit = productCode && warehouse
    ? buckets.find((b) => b.kind === "sku" && b.productCode === productCode && b.warehouse === warehouse)
    : undefined;
  if (skuHit) return { amount: skuHit.average, source: "sku", sample: skuHit.sample, type, usage, warehouse };
  const tuw = type && warehouse
    ? buckets.find((b) => b.kind === "typeUsageWh" && b.type === type && b.usage === usage && b.warehouse === warehouse)
    : undefined;
  if (tuw) return { amount: tuw.average, source: "typeUsageWh", sample: tuw.sample, type, usage, warehouse };
  const tu = type
    ? buckets.find((b) => b.kind === "typeUsage" && b.type === type && b.usage === usage)
    : undefined;
  if (tu) return { amount: tu.average, source: "typeUsage", sample: tu.sample, type, usage, warehouse };
  const tw = type && warehouse
    ? buckets.find((b) => b.kind === "typeWh" && b.type === type && b.warehouse === warehouse)
    : undefined;
  if (tw) return { amount: tw.average, source: "typeWh", sample: tw.sample, type, usage, warehouse };
  const t = type ? buckets.find((b) => b.kind === "type" && b.type === type) : undefined;
  if (t) return { amount: t.average, source: "type", sample: t.sample, type, usage, warehouse };
  if (global && global > 0) return { amount: global, source: "global", sample: 0, type, usage, warehouse };
  return null;
}

