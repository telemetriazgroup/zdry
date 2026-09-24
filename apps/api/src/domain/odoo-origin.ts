export const ODOO_INTAKE_KINDS = ["adjustment", "purchase", "fabrication", "unknown"] as const;
export type OdooIntakeKind = (typeof ODOO_INTAKE_KINDS)[number];

export const ODOO_COST_SOURCES = ["oc", "referential", "mo", "none"] as const;
export type OdooCostSource = (typeof ODOO_COST_SOURCES)[number];

export type LotMoveFact = {
  state?: string | null;
  origin?: string | null;
  reference?: string | null;
  pickingCode?: string | null;
  pickingState?: string | null;
  pickingName?: string | null;
  purchaseId?: number | null;
  purchaseName?: string | null;
  purchaseLineId?: number | null;
  srcUsage?: string | null;
  destUsage?: string | null;
  srcName?: string | null;
  destName?: string | null;
  date?: string | null;
};

export type LotOrigin = {
  odooIntakeKind: OdooIntakeKind;
  odooPickingName: string | null;
  purchaseName: string | null;
  costSource: OdooCostSource;
  odooMoName: string | null;
};

export type FabricationLineage = {
  odooMoName: string | null;
  odooSourceLotId: number | null;
  odooSourceProductCode: string | null;
  odooSourceProductName: string | null;
  odooSourceIntakeKind: OdooIntakeKind | null;
  odooSourcePoName: string | null;
  odooSourceUnitPrice: number | null;
};

const ADJ_RE = /inventory adjustment|ajuste inventario/i;
const MO_RE = /([A-Z0-9]+\/MO\/\d+)/i;

export function moNameFromText(...parts: Array<string | null | undefined>): string | null {
  const hit = parts.filter(Boolean).join(" ").match(MO_RE);
  return hit ? hit[1].toUpperCase() : null;
}

export function splitOdooProductLabel(label?: string | null): { code: string; name: string } {
  const raw = String(label || "").trim();
  const m = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) return { code: m[1].trim(), name: (m[2] || "").trim() };
  return { code: "", name: raw };
}

function textOf(m: LotMoveFact): string {
  return [m.origin, m.reference, m.pickingName, m.srcName, m.destName].filter(Boolean).join(" ");
}

function isOutgoing(m: LotMoveFact): boolean {
  return m.pickingCode === "outgoing" || m.destUsage === "customer";
}

function isDone(m: LotMoveFact): boolean {
  return m.state === "done" || m.pickingState === "done";
}

function isPurchaseInbound(m: LotMoveFact): boolean {
  if (isOutgoing(m) || !isDone(m)) return false;
  const hasPo = Boolean(m.purchaseId || m.purchaseLineId || m.purchaseName);
  if (!hasPo) return false;
  const incoming = m.pickingCode === "incoming" || m.srcUsage === "supplier";
  return incoming;
}

function isAdjustment(m: LotMoveFact): boolean {
  if (isOutgoing(m) || isFabricationInbound(m)) return false;
  const src = String(m.srcUsage || "");
  const dest = String(m.destUsage || "");
  if (src === "inventory" || dest === "inventory") return true;
  return ADJ_RE.test(textOf(m));
}

function isFabricationInbound(m: LotMoveFact): boolean {
  if (isOutgoing(m) || !isDone(m)) return false;
  const toStock = m.destUsage === "internal" || m.destUsage === "transit";
  if (!toStock) return false;
  if (m.srcUsage === "production") return true;
  if (m.srcUsage === "supplier" || m.srcUsage === "customer" || m.srcUsage === "inventory") return false;
  return Boolean(moNameFromText(m.reference, m.origin, m.pickingName));
}

const EMPTY_ORIGIN: LotOrigin = {
  odooIntakeKind: "unknown",
  odooPickingName: null,
  purchaseName: null,
  costSource: "none",
  odooMoName: null,
};

export function classifyLotOrigin(moves: LotMoveFact[] | null | undefined): LotOrigin {
  const list = Array.isArray(moves) ? moves : [];
  if (!list.length) return { ...EMPTY_ORIGIN };

  const purchase = list.find(isPurchaseInbound);
  if (purchase) {
    return {
      odooIntakeKind: "purchase",
      odooPickingName: purchase.pickingName || purchase.reference || null,
      purchaseName: purchase.purchaseName || null,
      costSource: "oc",
      odooMoName: moNameFromText(purchase.reference, purchase.origin, purchase.pickingName),
    };
  }

  const fab = list.find(isFabricationInbound);
  if (fab) {
    const mo = moNameFromText(fab.reference, fab.origin, fab.pickingName);
    return {
      odooIntakeKind: "fabrication",
      odooPickingName: mo || fab.reference || fab.pickingName || null,
      purchaseName: null,
      costSource: "mo",
      odooMoName: mo,
    };
  }

  const adj = list.find(isAdjustment);
  if (adj) {
    return {
      odooIntakeKind: "adjustment",
      odooPickingName: adj.pickingName || adj.reference || null,
      purchaseName: null,
      costSource: "referential",
      odooMoName: null,
    };
  }

  return { ...EMPTY_ORIGIN };
}

export type LotDocKind = "picking_in" | "picking_out" | "transfer" | "repair" | "sale";
export type LotAvailability = "stock" | "reserved" | "left";

function moveText(m: LotMoveFact): string {
  return `${m.pickingName || ""} ${m.reference || ""} ${m.origin || ""}`;
}

export function isRepairMove(m: LotMoveFact): boolean {
  return /\/RO\//i.test(moveText(m));
}

export function dossierKindForMove(m: LotMoveFact): LotDocKind {
  if (isRepairMove(m)) return "repair";
  if (m.destUsage === "customer" || (m.pickingCode === "outgoing" && m.destUsage !== "internal" && m.destUsage !== "supplier")) {
    return "picking_out";
  }
  if (m.pickingCode === "incoming" || m.srcUsage === "supplier") return "picking_in";
  return "transfer";
}

function moveStamp(m: LotMoveFact): number {
  const t = Date.parse(String(m.date || ""));
  return Number.isFinite(t) ? t : 0;
}

function isOpen(m: LotMoveFact): boolean {
  const state = String(m.pickingState || m.state || "").toLowerCase();
  return state !== "done" && state !== "cancel" && state !== "cancelled";
}

/** La salida a cliente más reciente cierra el equipo. Un retorno posterior lo vuelve a stock. */
export function lotAvailability(moves: LotMoveFact[] | null | undefined): {
  availability: LotAvailability;
  pickingName: string | null;
  destName: string | null;
} {
  const list = (Array.isArray(moves) ? moves : []).filter((m) => m.pickingName || m.reference);
  const departures = list.filter((m) => dossierKindForMove(m) === "picking_out");
  const done = departures.filter(isDone).sort((a, b) => moveStamp(b) - moveStamp(a));
  const latestOut = done[0];
  if (latestOut) {
    const back = list
      .filter((m) => isDone(m) && m.srcUsage === "customer" && (m.destUsage === "internal" || m.pickingCode === "incoming"))
      .sort((a, b) => moveStamp(b) - moveStamp(a))[0];
    if (!back || moveStamp(back) <= moveStamp(latestOut)) {
      return { availability: "left", pickingName: latestOut.pickingName || latestOut.reference || null, destName: latestOut.destName || null };
    }
  }
  const open = departures.filter(isOpen).sort((a, b) => moveStamp(b) - moveStamp(a))[0];
  if (open) {
    return { availability: "reserved", pickingName: open.pickingName || open.reference || null, destName: open.destName || null };
  }
  return { availability: "stock", pickingName: null, destName: null };
}

export function inferKindFallback(kind: string | null | undefined, poName?: string | null): OdooIntakeKind {
  if (kind === "adjustment" || kind === "purchase" || kind === "fabrication" || kind === "unknown") return kind;
  return poName ? "purchase" : "unknown";
}

export function assimilateCostPlan(input: {
  odooIntakeKind?: string | null;
  odooUnitPrice?: number | null;
  odooBillName?: string | null;
  odooPoName?: string | null;
  moUnitCost?: number | null;
}): {
  intakeType: string;
  invoicePending: boolean;
  fobCif: number;
  costSource: OdooCostSource;
  odooIntakeKind: OdooIntakeKind;
} {
  const kind = inferKindFallback(input.odooIntakeKind, input.odooPoName);
  if (kind === "purchase") {
    const price = Number(input.odooUnitPrice);
    return {
      odooIntakeKind: "purchase",
      intakeType: input.odooBillName ? "compra" : "pendiente_factura",
      invoicePending: !input.odooBillName,
      fobCif: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0,
      costSource: "oc",
    };
  }
  if (kind === "adjustment") {
    return {
      odooIntakeKind: "adjustment",
      intakeType: "ajuste_odoo",
      invoicePending: false,
      fobCif: 0,
      costSource: "referential",
    };
  }
  if (kind === "fabrication") {
    const mo = Number(input.moUnitCost);
    const fob = Number.isFinite(mo) && mo > 0 ? Math.round(mo * 100) / 100 : 0;
    return {
      odooIntakeKind: "fabrication",
      intakeType: "fabricacion_odoo",
      invoicePending: false,
      fobCif: fob,
      costSource: "mo",
    };
  }
  return {
    odooIntakeKind: "unknown",
    intakeType: "pendiente_factura",
    invoicePending: true,
    fobCif: 0,
    costSource: "none",
  };
}

export function isDryContainerProduct(name?: string | null, code?: string | null): boolean {
  const n = String(name || "").toLowerCase();
  if (/flat\s*pack|flat\s*rack|modulo|módulo/.test(n)) return false;
  if (n.includes("contenedor dry")) return true;
  return /^cd[den]/i.test(String(code || ""));
}

export function originBadgeLabel(kind?: string | null, poName?: string | null, pickingName?: string | null): string {
  if (kind === "purchase") return poName || pickingName || "OC";
  if (kind === "fabrication") return pickingName || "Fabricación";
  if (kind === "adjustment") return "Ajuste";
  return "Sin origen";
}
