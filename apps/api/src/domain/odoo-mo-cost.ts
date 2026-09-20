export type MoCostOrigin = "oc" | "valuation" | "standard" | "move" | "overhead" | "zdry" | "missing";

export function moLineKey(name: string) {
  const t = String(name || "").replace(/\s+/g, " ").trim();
  const code = t.match(/^\[([^\]]+)\]/);
  return (code ? code[1] : t).toUpperCase().slice(0, 80);
}

export function applyZdryLineCosts<T extends MoComponentIn>(components: T[], overrides?: Record<string, number> | null): T[] {
  const map = overrides && typeof overrides === "object" ? overrides : {};
  return components.map((c) => {
    const key = moLineKey(c.name);
    const usd = Number(map[key]);
    const empty = !c.unitCost || c.costOrigin === "missing" || c.costOrigin === "zdry";
    if (empty && Number.isFinite(usd) && usd > 0) {
      return { ...c, unitCost: Math.round(usd * 100) / 100, costOrigin: "zdry" as const };
    }
    return c;
  });
}

export type MoComponentIn = {
  name: string;
  qty: number;
  unitCost?: number | null;
  costOrigin?: MoCostOrigin | null;
  lot?: string | null;
  category?: string | null;
  role?: "precursor" | "component" | "overhead";
};

export type MoOverheadIn = {
  name: string;
  amountUsd: number;
};

/** Default del módulo Odoo `zg_costo_producto_transformado`: no se calcula de fechas. */
export const ODOO_MO_OVERHEAD_DEFAULTS = {
  days: 9,
  aguaPerDay: 4,
  herramientasPerDay: 20,
  adminPerDay: 20,
  maquinaria: 60,
};

export type MoOverheadPlan = {
  odooDays: number;
  days: number;
  daysSource: "odoo" | "zdry";
  aguaPerDay: number;
  herramientasPerDay: number;
  adminPerDay: number;
  maquinaria: number;
  energia: number;
  otros: number;
};

function rateOrDefault(total: number, days: number, fallback: number) {
  if (days > 0 && total > 0) return money(total / days);
  return fallback;
}

export function inferMoOverheadPlan(odoo: {
  diasTrabajados?: number | null;
  costoAgua?: number | null;
  costoHerramientas?: number | null;
  costoGastosAdmin?: number | null;
  costoMaquinaria?: number | null;
  costoEnergia?: number | null;
  otros?: number | null;
}, zdry?: Partial<MoOverheadPlan> | null): MoOverheadPlan {
  const odooDays = Number(odoo.diasTrabajados);
  const baseDays = Number.isFinite(odooDays) && odooDays > 0 ? odooDays : ODOO_MO_OVERHEAD_DEFAULTS.days;
  const aguaPerDay = zdry?.aguaPerDay ?? rateOrDefault(Number(odoo.costoAgua) || 0, baseDays, ODOO_MO_OVERHEAD_DEFAULTS.aguaPerDay);
  const herramientasPerDay = zdry?.herramientasPerDay ?? rateOrDefault(Number(odoo.costoHerramientas) || 0, baseDays, ODOO_MO_OVERHEAD_DEFAULTS.herramientasPerDay);
  const adminPerDay = zdry?.adminPerDay ?? rateOrDefault(Number(odoo.costoGastosAdmin) || 0, baseDays, ODOO_MO_OVERHEAD_DEFAULTS.adminPerDay);
  const zdryDays = Number(zdry?.days);
  const useZdry = Number.isFinite(zdryDays) && zdryDays > 0 && zdry?.daysSource !== "odoo";
  return {
    odooDays: baseDays,
    days: useZdry ? money(zdryDays) : baseDays,
    daysSource: useZdry ? "zdry" : "odoo",
    aguaPerDay: money(Number(aguaPerDay) || ODOO_MO_OVERHEAD_DEFAULTS.aguaPerDay),
    herramientasPerDay: money(Number(herramientasPerDay) || ODOO_MO_OVERHEAD_DEFAULTS.herramientasPerDay),
    adminPerDay: money(Number(adminPerDay) || ODOO_MO_OVERHEAD_DEFAULTS.adminPerDay),
    maquinaria: money(Number(zdry?.maquinaria ?? odoo.costoMaquinaria) || 0) || ODOO_MO_OVERHEAD_DEFAULTS.maquinaria,
    energia: money(Number(odoo.costoEnergia) || 0),
    otros: money(Number(odoo.otros) || 0),
  };
}

export function buildMoOverhead(plan: MoOverheadPlan, extras: MoOverheadIn[] = []): MoOverheadIn[] {
  const d = plan.days;
  const src = plan.daysSource === "zdry" ? "ajuste ZDRY" : "referencial Odoo (default 9 días, no sale de fechas)";
  return [
    { name: `Agua (${d} días × USD ${plan.aguaPerDay}/día) — ${src}`, amountUsd: money(d * plan.aguaPerDay) },
    { name: `Herramientas (${d} días × USD ${plan.herramientasPerDay}/día) — ${src}`, amountUsd: money(d * plan.herramientasPerDay) },
    { name: `Gastos administrativos (${d} días × USD ${plan.adminPerDay}/día) — ${src}. El trámite puede empezar antes de ejecutar; ajusta los días en ZDRY.`, amountUsd: money(d * plan.adminPerDay) },
    { name: "Movimiento de maquinaria — monto fijo Odoo (no depende de días)", amountUsd: plan.maquinaria },
    { name: "Energía (horas × watts en Odoo)", amountUsd: plan.energia },
    { name: "Otros adicionales Odoo", amountUsd: plan.otros },
    ...extras,
  ].filter((o) => o.amountUsd > 0);
}

export type MoCostLine = {
  name: string;
  qty: number;
  unitCost: number | null;
  lineCost: number;
  origin: MoCostOrigin;
  lot: string;
  category: string;
  role: "precursor" | "component" | "overhead";
};

export type MoCostBreakdown = {
  precursorCost: number;
  components: MoCostLine[];
  componentsTotal: number;
  overheadTotal: number;
  total: number;
  unitCost: number;
  finishedQty: number;
  complete: boolean;
  missingCount: number;
  currency: "USD";
  companyCurrency: string;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

export function pickComponentUnitCost(input: {
  ocPrice?: number | null;
  valuationCost?: number | null;
  standardPrice?: number | null;
  movePrice?: number | null;
  zdryPrice?: number | null;
}): { unitCost: number | null; origin: MoCostOrigin } {
  const zdry = Number(input.zdryPrice);
  if (Number.isFinite(zdry) && zdry > 0) return { unitCost: money(zdry), origin: "zdry" };
  const oc = Number(input.ocPrice);
  if (Number.isFinite(oc) && oc > 0) return { unitCost: money(oc), origin: "oc" };
  const std = Number(input.standardPrice);
  if (Number.isFinite(std) && std > 0) return { unitCost: money(std), origin: "standard" };
  const val = Number(input.valuationCost);
  if (Number.isFinite(val) && val > 0) return { unitCost: money(val), origin: "valuation" };
  const move = Number(input.movePrice);
  if (Number.isFinite(move) && move > 0) return { unitCost: money(move), origin: "move" };
  return { unitCost: null, origin: "missing" };
}

/** Compañía PEN: `res.currency` USD.rate es PEN→USD (1 PEN * rate = USD). */
export function penToUsd(amountPen: number, ratePenToUsd: number) {
  const rate = Number(ratePenToUsd);
  const n = Number(amountPen);
  if (!Number.isFinite(n) || !Number.isFinite(rate) || rate <= 0) return 0;
  return money(n * rate);
}

export function moCostBreakdown(input: {
  precursorCost?: number | null;
  components?: MoComponentIn[];
  overhead?: MoOverheadIn[];
  finishedQty?: number | null;
  companyCurrency?: string | null;
}): MoCostBreakdown {
  const finishedQty = Number(input.finishedQty);
  const qtyOut = Number.isFinite(finishedQty) && finishedQty > 0 ? finishedQty : 1;
  const components = (input.components || []).map((c) => {
    const qty = Number(c.qty);
    const q = Number.isFinite(qty) && qty > 0 ? qty : 0;
    const picked = pickComponentUnitCost({
      zdryPrice: c.costOrigin === "zdry" ? c.unitCost : null,
      ocPrice: c.costOrigin === "oc" ? c.unitCost : null,
      valuationCost: c.costOrigin === "valuation" ? c.unitCost : null,
      standardPrice: c.costOrigin === "standard" ? c.unitCost : null,
      movePrice: c.costOrigin === "move" ? c.unitCost : c.costOrigin ? null : c.unitCost,
    });
    const unitCost = picked.unitCost;
    const origin = (c.costOrigin && c.costOrigin !== "missing" ? c.costOrigin : picked.origin) as MoCostOrigin;
    const has = unitCost != null && unitCost > 0;
    return {
      name: String(c.name || "Insumo").trim() || "Insumo",
      qty: q,
      unitCost: has ? unitCost : null,
      lineCost: has ? money(q * (unitCost as number)) : 0,
      origin: has ? origin : "missing",
      lot: String(c.lot || ""),
      category: String(c.category || ""),
      role: (c.role === "precursor" || c.role === "overhead" ? c.role : "component") as MoCostLine["role"],
    };
  });
  const overhead = (input.overhead || [])
    .map((o) => {
      const amount = Number(o.amountUsd);
      const n = Number.isFinite(amount) && amount > 0 ? money(amount) : 0;
      return {
        name: String(o.name || "Costo adicional").trim() || "Costo adicional",
        qty: 1,
        unitCost: n || null,
        lineCost: n,
        origin: "overhead" as const,
        lot: "",
        category: "Costos adicionales MO",
        role: "overhead" as const,
      };
    })
    .filter((o) => o.lineCost > 0);

  const lines = [...components, ...overhead];
  const missingCount = components.filter((c) => c.origin === "missing").length;
  const precursorFromLines = money(components.filter((c) => c.role === "precursor").reduce((s, c) => s + c.lineCost, 0));
  const extraPrecursor = precursorFromLines > 0
    ? 0
    : (Number.isFinite(Number(input.precursorCost)) && Number(input.precursorCost) > 0 ? money(Number(input.precursorCost)) : 0);
  const precursorCost = precursorFromLines || extraPrecursor;
  const componentsTotal = money(components.reduce((s, c) => s + c.lineCost, 0));
  const overheadTotal = money(overhead.reduce((s, c) => s + c.lineCost, 0));
  const total = money(componentsTotal + extraPrecursor + overheadTotal);
  const complete = total > 0 && missingCount === 0;
  return {
    precursorCost,
    components: lines,
    componentsTotal,
    overheadTotal,
    total,
    unitCost: money(total / qtyOut),
    finishedQty: qtyOut,
    complete,
    missingCount,
    currency: "USD",
    companyCurrency: String(input.companyCurrency || "PEN"),
  };
}
