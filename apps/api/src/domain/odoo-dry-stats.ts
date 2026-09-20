/** Clasifica SO Odoo con DRY en venta / alquiler / otros y arma el semáforo cotización → ingreso. */

export type DryKind = "venta" | "alquiler" | "otros";
export type DryPipeline = "cotizacion" | "confirmada" | "por_facturar" | "ingreso" | "cancelada";

export type DryDealRow = {
  odooId: number;
  name: string;
  kind: DryKind;
  year: number;
  month: string;
  dateOrder: string;
  partnerName: string;
  vendorName: string;
  amountTotal: number;
  amountUntaxed: number;
  currency: string;
  state: string;
  invoiceStatus: string;
  isSubscription: boolean;
  pipeline: DryPipeline;
  asunto: string;
  otherReason: string;
};

export type DryMoney = { USD: number; PEN: number };

export type DryKindBlock = {
  quotes: number;
  confirmadas: number;
  porFacturar: number;
  ingresos: number;
  canceladas: number;
  amountQuoted: DryMoney;
  amountIngreso: DryMoney;
  confirmRate: number;
  invoiceRate: number;
};

export type DryVendorRow = {
  name: string;
  venta: number;
  alquiler: number;
  otros: number;
  cotizacion: number;
  proceso: number;
  canceladas: number;
  ingresos: number;
  amountQuoted: DryMoney;
  amountIngreso: DryMoney;
  confirmRate: number;
  invoiceRate: number;
  shareIngreso: number;
  shareMontoUsd: number;
  ticketUsd: number;
  rank: number;
};

export type DryMonthFlow = {
  month: string;
  venta: number;
  alquiler: number;
  otros: number;
  cotizacion: number;
  proceso: number;
  facturado: number;
  cancelada: number;
  ingresos: number;
  amountQuoted: DryMoney;
  amountIngreso: DryMoney;
  conversionFactura: number;
  deltaFacturado: number | null;
  deltaCotizacion: number | null;
  deltaProceso: number | null;
  deltaIngresoUsd: number | null;
};

export type DryStatsPresent = {
  dealCount: number;
  excludedCount: number;
  excludedByReason: Record<string, number>;
  years: Record<string, { venta: DryKindBlock; alquiler: DryKindBlock; otros: DryKindBlock }>;
  pipeline: Record<DryPipeline, number>;
  vendors: DryVendorRow[];
  months: DryMonthFlow[];
  leader: { name: string; ingresos: number; amountIngreso: DryMoney } | null;
  otrosByReason: Record<string, number>;
  allowedYears: number[];
  fetchedAt: string | null;
  baselineAt: string | null;
  baselineLabel: string | null;
  delta: {
    ventaIngresos: number;
    alquilerIngresos: number;
    otrosIngresos: number;
    amountIngresoUsd: number;
    amountIngresoPen: number;
  } | null;
};

const OTROS: { re: RegExp; reason: string }[] = [
  { re: /GARANT[IÍ]A\s+POR/, reason: "garantia" },
  { re: /FALSO\s+FLETE/, reason: "falso_flete" },
  { re: /PROYECTO\s*MODULAR|SEGUN\s+PLANO|SEGÚN\s+PLANO/, reason: "modular" },
  { re: /FURG[OÓ]N|DRY\s*STORE|OPEN\s*TOP|FLAT\s*RACK|BLAST\s*CHILLER/, reason: "derivado" },
  { re: /ACONDICIONAMIENTO|ALMACENAMIENTO\s+DE/, reason: "servicio_patio" },
  { re: /\bREEFER\b|\b40\s*RH\b|\b20\s*RH\b|\b10\s*RH\b/, reason: "mixto_reefer" },
  { re: /COLD\s*TREATMENT|TELEMETR|MANTENIMIENTO/, reason: "servicio_reefer" },
];

export const DRY_STATS_YEARS = [2023, 2024, 2025, 2026];

export function normalizeAsunto(raw: unknown): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyDryAsunto(asunto: unknown): { kind: DryKind | null; reason: string } {
  const a = normalizeAsunto(asunto);
  if (!a) return { kind: "otros", reason: "sin_asunto" };
  if (!/\bDRY\b/.test(a)) return { kind: null, reason: "no_dry" };
  for (const row of OTROS) {
    if (row.re.test(a)) return { kind: "otros", reason: row.reason };
  }
  const venta = /\bVENTA\b/.test(a);
  const alquiler = /\bALQUILER\b/.test(a);
  if (venta && alquiler) return { kind: "otros", reason: "mixto" };
  if (alquiler) return { kind: "alquiler", reason: "ok" };
  if (venta) return { kind: "venta", reason: "ok" };
  if (/SERVICIO\s+DE\s+TRANSPORTE|MANIPULEO|RECOJO/.test(a)) return { kind: "otros", reason: "solo_logistica" };
  return { kind: "otros", reason: "otro" };
}

export function dryPipeline(state: unknown, invoiceStatus: unknown): DryPipeline {
  const st = String(state || "").toLowerCase();
  const inv = String(invoiceStatus || "").toLowerCase();
  if (st === "cancel") return "cancelada";
  if (inv === "invoiced") return "ingreso";
  if (st === "sale" || st === "done") {
    if (inv === "to invoice" || inv === "upselling") return "por_facturar";
    return "confirmada";
  }
  return "cotizacion";
}

export function limaYearMonth(dateRaw: unknown): { year: number; month: string; iso: string } {
  const s = String(dateRaw || "").trim();
  const iso = s.includes("T") ? s : s ? s.replace(" ", "T") + (s.length === 10 ? "T12:00:00" : "") : "";
  const d = iso ? new Date(iso) : new Date(NaN);
  if (Number.isNaN(d.getTime())) {
    return { year: 0, month: "0000-00", iso: "" };
  }
  const lima = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(d);
  const [y, m] = lima.split("-");
  return { year: Number(y), month: `${y}-${m}`, iso: d.toISOString() };
}

export function moneyPair(): DryMoney {
  return { USD: 0, PEN: 0 };
}

export function addMoney(into: DryMoney, currency: string, amount: number) {
  const cur = currency.toUpperCase().includes("PEN") ? "PEN" : "USD";
  into[cur] = Math.round((into[cur] + (Number(amount) || 0)) * 100) / 100;
}

function emptyBlock(): DryKindBlock {
  return {
    quotes: 0,
    confirmadas: 0,
    porFacturar: 0,
    ingresos: 0,
    canceladas: 0,
    amountQuoted: moneyPair(),
    amountIngreso: moneyPair(),
    confirmRate: 0,
    invoiceRate: 0,
  };
}

function emptyVendor(name: string): DryVendorRow {
  return {
    name,
    venta: 0,
    alquiler: 0,
    otros: 0,
    cotizacion: 0,
    proceso: 0,
    canceladas: 0,
    ingresos: 0,
    amountQuoted: moneyPair(),
    amountIngreso: moneyPair(),
    confirmRate: 0,
    invoiceRate: 0,
    shareIngreso: 0,
    shareMontoUsd: 0,
    ticketUsd: 0,
    rank: 0,
  };
}

function emptyMonth(month: string): DryMonthFlow {
  return {
    month,
    venta: 0,
    alquiler: 0,
    otros: 0,
    cotizacion: 0,
    proceso: 0,
    facturado: 0,
    cancelada: 0,
    ingresos: 0,
    amountQuoted: moneyPair(),
    amountIngreso: moneyPair(),
    conversionFactura: 0,
    deltaFacturado: null,
    deltaCotizacion: null,
    deltaProceso: null,
    deltaIngresoUsd: null,
  };
}

function rankVendors(rows: DryVendorRow[]): DryVendorRow[] {
  const ingresoTotal = rows.reduce((s, v) => s + v.ingresos, 0);
  const usdTotal = rows.reduce((s, v) => s + v.amountIngreso.USD, 0);
  const ranked = [...rows].sort(
    (a, b) =>
      b.amountIngreso.USD - a.amountIngreso.USD ||
      b.ingresos - a.ingresos ||
      b.amountIngreso.PEN - a.amountIngreso.PEN ||
      b.venta + b.alquiler - (a.venta + a.alquiler),
  );
  ranked.forEach((v, i) => {
    const open = v.cotizacion + v.proceso + v.ingresos;
    const firmes = v.proceso + v.ingresos;
    v.confirmRate = open ? Math.round((firmes / open) * 1000) / 10 : 0;
    v.invoiceRate = firmes ? Math.round((v.ingresos / firmes) * 1000) / 10 : 0;
    v.shareIngreso = ingresoTotal ? Math.round((v.ingresos / ingresoTotal) * 1000) / 10 : 0;
    v.shareMontoUsd = usdTotal ? Math.round((v.amountIngreso.USD / usdTotal) * 1000) / 10 : 0;
    v.ticketUsd = v.ingresos ? Math.round((v.amountIngreso.USD / v.ingresos) * 100) / 100 : 0;
    v.rank = i + 1;
  });
  return ranked;
}

function finishMonths(rows: DryMonthFlow[]): DryMonthFlow[] {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  sorted.forEach((m, i) => {
    const open = m.cotizacion + m.proceso + m.facturado;
    m.conversionFactura = open ? Math.round((m.facturado / open) * 1000) / 10 : 0;
    const prev = sorted[i - 1];
    if (!prev) return;
    m.deltaFacturado = m.facturado - prev.facturado;
    m.deltaCotizacion = m.cotizacion - prev.cotizacion;
    m.deltaProceso = m.proceso - prev.proceso;
    m.deltaIngresoUsd = Math.round((m.amountIngreso.USD - prev.amountIngreso.USD) * 100) / 100;
  });
  return sorted;
}

function finishBlock(b: DryKindBlock) {
  const open = b.quotes + b.confirmadas + b.porFacturar + b.ingresos;
  const firmes = b.confirmadas + b.porFacturar + b.ingresos;
  b.confirmRate = open ? Math.round((firmes / open) * 1000) / 10 : 0;
  b.invoiceRate = firmes ? Math.round((b.ingresos / firmes) * 1000) / 10 : 0;
}

function manyName(v: unknown): string {
  if (Array.isArray(v) && v.length > 1) return String(v[1] || "");
  if (v && typeof v === "object" && "name" in v) return String((v as { name?: unknown }).name || "");
  return String(v || "").trim();
}

export function rowFromOdoo(raw: Record<string, unknown>): { row: DryDealRow | null; reason: string } {
  const asunto = String(raw.x_studio_asunto_cotizacion || raw.origin || "");
  const cls = classifyDryAsunto(asunto);
  if (!cls.kind) return { row: null, reason: cls.reason };
  const ym = limaYearMonth(raw.date_order);
  const currency = manyName(raw.currency_id) || "USD";
  const pipeline = dryPipeline(raw.state, raw.invoice_status);
  return {
    reason: "ok",
    row: {
      odooId: Number(raw.id),
      name: String(raw.name || ""),
      kind: cls.kind,
      year: ym.year,
      month: ym.month,
      dateOrder: ym.iso,
      partnerName: manyName(raw.partner_id),
      vendorName: manyName(raw.user_id) || "(sin comercial)",
      amountTotal: Number(raw.amount_total) || 0,
      amountUntaxed: Number(raw.amount_untaxed) || 0,
      currency,
      state: String(raw.state || ""),
      invoiceStatus: String(raw.invoice_status || ""),
      isSubscription: Boolean(raw.is_subscription),
      pipeline,
      asunto,
      otherReason: cls.reason === "ok" ? "" : cls.reason,
    },
  };
}

export function presentDryStats(
  deals: DryDealRow[],
  extras: {
    excludedByReason?: Record<string, number>;
    fetchedAt?: string | null;
    baseline?: {
      at: string;
      label: string;
      ventaIngresos: number;
      alquilerIngresos: number;
      otrosIngresos?: number;
      amountIngresoUsd: number;
      amountIngresoPen: number;
    } | null;
  } = {},
): DryStatsPresent {
  const years: DryStatsPresent["years"] = {};
  const pipeline: Record<DryPipeline, number> = {
    cotizacion: 0,
    confirmada: 0,
    por_facturar: 0,
    ingreso: 0,
    cancelada: 0,
  };
  const vendorMap = new Map<string, DryVendorRow>();
  const monthMap = new Map<string, DryMonthFlow>();

  for (const d of deals) {
    const y = String(d.year || 0);
    if (!years[y]) years[y] = { venta: emptyBlock(), alquiler: emptyBlock(), otros: emptyBlock() };
    const block = years[y][d.kind];
    pipeline[d.pipeline] += 1;
    if (d.pipeline === "cancelada") block.canceladas += 1;
    else if (d.pipeline === "cotizacion") block.quotes += 1;
    else if (d.pipeline === "confirmada") block.confirmadas += 1;
    else if (d.pipeline === "por_facturar") block.porFacturar += 1;
    else block.ingresos += 1;
    if (d.pipeline !== "cancelada") addMoney(block.amountQuoted, d.currency, d.amountTotal);
    if (d.pipeline === "ingreso") addMoney(block.amountIngreso, d.currency, d.amountTotal);

    const v = vendorMap.get(d.vendorName) || emptyVendor(d.vendorName);
    v[d.kind] += 1;
    if (d.pipeline === "cancelada") v.canceladas += 1;
    else if (d.pipeline === "cotizacion") v.cotizacion += 1;
    else if (d.pipeline === "ingreso") v.ingresos += 1;
    else v.proceso += 1;
    if (d.pipeline !== "cancelada") addMoney(v.amountQuoted, d.currency, d.amountTotal);
    if (d.pipeline === "ingreso") addMoney(v.amountIngreso, d.currency, d.amountTotal);
    vendorMap.set(d.vendorName, v);

    const m = monthMap.get(d.month) || emptyMonth(d.month);
    m[d.kind] += 1;
    if (d.pipeline === "cancelada") m.cancelada += 1;
    else if (d.pipeline === "cotizacion") m.cotizacion += 1;
    else if (d.pipeline === "ingreso") {
      m.facturado += 1;
      m.ingresos += 1;
      addMoney(m.amountIngreso, d.currency, d.amountTotal);
    } else m.proceso += 1;
    if (d.pipeline !== "cancelada") addMoney(m.amountQuoted, d.currency, d.amountTotal);
    monthMap.set(d.month, m);
  }

  for (const y of Object.values(years)) {
    finishBlock(y.venta);
    finishBlock(y.alquiler);
    finishBlock(y.otros);
  }

  let ventaIngresos = 0;
  let alquilerIngresos = 0;
  let otrosIngresos = 0;
  let amountIngresoUsd = 0;
  let amountIngresoPen = 0;
  const otrosByReason: Record<string, number> = {};
  for (const d of deals) {
    if (d.kind === "otros") {
      const r = d.otherReason || "otro";
      otrosByReason[r] = (otrosByReason[r] || 0) + 1;
    }
  }
  for (const y of Object.values(years)) {
    ventaIngresos += y.venta.ingresos;
    alquilerIngresos += y.alquiler.ingresos;
    otrosIngresos += y.otros.ingresos;
    amountIngresoUsd += y.venta.amountIngreso.USD + y.alquiler.amountIngreso.USD + y.otros.amountIngreso.USD;
    amountIngresoPen += y.venta.amountIngreso.PEN + y.alquiler.amountIngreso.PEN + y.otros.amountIngreso.PEN;
  }

  const baseline = extras.baseline || null;
  const delta = baseline
    ? {
        ventaIngresos: ventaIngresos - baseline.ventaIngresos,
        alquilerIngresos: alquilerIngresos - baseline.alquilerIngresos,
        otrosIngresos: otrosIngresos - (baseline.otrosIngresos || 0),
        amountIngresoUsd: Math.round((amountIngresoUsd - baseline.amountIngresoUsd) * 100) / 100,
        amountIngresoPen: Math.round((amountIngresoPen - baseline.amountIngresoPen) * 100) / 100,
      }
    : null;

  const excludedByReason = extras.excludedByReason || {};
  const excludedCount = Object.values(excludedByReason).reduce((s, n) => s + n, 0);
  const vendors = rankVendors([...vendorMap.values()]);

  return {
    dealCount: deals.length,
    excludedCount,
    excludedByReason,
    years,
    pipeline,
    vendors,
    months: finishMonths([...monthMap.values()]),
    leader: vendors[0]
      ? { name: vendors[0].name, ingresos: vendors[0].ingresos, amountIngreso: vendors[0].amountIngreso }
      : null,
    otrosByReason,
    allowedYears: DRY_STATS_YEARS,
    fetchedAt: extras.fetchedAt || null,
    baselineAt: baseline?.at || null,
    baselineLabel: baseline?.label || null,
    delta,
  };
}

export function baselineFromPresent(p: DryStatsPresent, label = "Antes de ZDRY") {
  let ventaIngresos = 0;
  let alquilerIngresos = 0;
  let otrosIngresos = 0;
  let amountIngresoUsd = 0;
  let amountIngresoPen = 0;
  for (const y of Object.values(p.years)) {
    ventaIngresos += y.venta.ingresos;
    alquilerIngresos += y.alquiler.ingresos;
    otrosIngresos += y.otros.ingresos;
    amountIngresoUsd += y.venta.amountIngreso.USD + y.alquiler.amountIngreso.USD + y.otros.amountIngreso.USD;
    amountIngresoPen += y.venta.amountIngreso.PEN + y.alquiler.amountIngreso.PEN + y.otros.amountIngreso.PEN;
  }
  return {
    at: new Date().toISOString(),
    label,
    ventaIngresos,
    alquilerIngresos,
    otrosIngresos,
    amountIngresoUsd: Math.round(amountIngresoUsd * 100) / 100,
    amountIngresoPen: Math.round(amountIngresoPen * 100) / 100,
  };
}

export const DRY_STATS_FIELDS = [
  "name",
  "date_order",
  "partner_id",
  "user_id",
  "amount_total",
  "amount_untaxed",
  "state",
  "invoice_status",
  "currency_id",
  "x_studio_asunto_cotizacion",
  "is_subscription",
  "origin",
] as const;
