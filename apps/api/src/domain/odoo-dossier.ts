import type { DocDraft } from "./odoo-expediente";
import type { OdooDocAccess } from "./odoo-doc-present";
import type { MoCostBreakdown, MoOverheadPlan } from "./odoo-mo-cost";
import { moLineKey } from "./odoo-mo-cost";

export function purchaseDossierDraft(input: {
  odooId: number;
  name: string;
  partner?: string | null;
  state?: string | null;
  currency?: string | null;
  amountTotal?: number | null;
  date?: string | null;
  unitPrice?: number | null;
  qtyReceived?: number | null;
  lines?: Array<{ label: string; qty?: string; amount?: string }>;
  pickings?: Array<{ name: string; date?: string | null; isos: string[] }>;
}): DocDraft {
  const pickings = input.pickings || [];
  const isos = [...new Set(pickings.flatMap((p) => p.isos))];
  return {
    kind: "purchase",
    odooModel: "purchase.order",
    odooId: input.odooId,
    name: input.name,
    summary: [input.partner, input.amountTotal != null ? `USD ${input.amountTotal}` : "", `${pickings.length} IN`].filter(Boolean).join(" · "),
    data: {
      name: input.name,
      partner: input.partner || null,
      state: input.state || null,
      currency: input.currency || null,
      amountTotal: input.amountTotal ?? null,
      date: input.date || null,
      unitPrice: input.unitPrice ?? null,
      qtyReceived: input.qtyReceived ?? null,
      lines: input.lines || [],
      pickings,
      isos,
    },
  };
}

export function billDossierDraft(input: {
  odooId?: number;
  name: string;
  access: OdooDocAccess;
  partner?: string | null;
  state?: string | null;
  amountTotal?: number | null;
  date?: string | null;
  poNames?: string[];
  lines?: Array<{ label: string; qty?: string; amount?: string }>;
}): DocDraft {
  return {
    kind: "bill",
    odooModel: "account.move",
    odooId: input.odooId || 0,
    name: input.name || "Factura",
    summary: input.access === "ok" ? [input.partner, input.amountTotal != null ? `USD ${input.amountTotal}` : ""].filter(Boolean).join(" · ") : input.access,
    data: {
      name: input.name,
      access: input.access,
      partner: input.partner || null,
      state: input.state || null,
      amountTotal: input.amountTotal ?? null,
      date: input.date || null,
      poNames: input.poNames || [],
      lines: input.lines || [],
    },
  };
}

export function pickingDossierDraft(input: {
  odooId: number;
  name: string;
  origin?: string | null;
  date?: string | null;
  locationSrc?: string | null;
  locationDest?: string | null;
  isos: string[];
}): DocDraft {
  return {
    kind: "picking_in",
    odooModel: "stock.picking",
    odooId: input.odooId,
    name: input.name,
    summary: [input.origin, `${input.isos.length} serie(s)`].filter(Boolean).join(" · "),
    data: {
      name: input.name,
      pickingType: "Entrada",
      origin: input.origin || null,
      date: input.date || null,
      locationSrc: input.locationSrc || null,
      locationDest: input.locationDest || null,
      isos: input.isos,
    },
  };
}

export function moDossierDraft(input: {
  odooId: number;
  name: string;
  productFinished?: string | null;
  productCode?: string | null;
  sourceProduct?: string | null;
  date?: string | null;
  breakdown: MoCostBreakdown;
  needs?: string[];
  overhead?: MoOverheadPlan | null;
}): DocDraft {
  const b = input.breakdown;
  return {
    kind: "mo",
    odooModel: "mrp.production",
    odooId: input.odooId,
    name: input.name,
    summary: [input.productFinished, b.total > 0 ? `USD ${b.unitCost}` : "costo incompleto"].filter(Boolean).join(" · "),
    data: {
      name: input.name,
      productFinished: input.productFinished || null,
      productCode: input.productCode || null,
      sourceProduct: input.sourceProduct || null,
      date: input.date || null,
      complete: b.complete,
      missingCount: b.missingCount,
      precursorCost: b.precursorCost,
      componentsTotal: b.componentsTotal,
      overheadTotal: b.overheadTotal,
      total: b.total,
      unitCost: b.unitCost,
      finishedQty: b.finishedQty,
      currency: b.currency,
      companyCurrency: b.companyCurrency,
      needs: input.needs || [],
      overhead: input.overhead || null,
      components: b.components.map((c) => ({
        key: moLineKey(c.name),
        name: c.name,
        qty: c.qty,
        unitCost: c.unitCost,
        lineCost: c.lineCost,
        origin: c.origin,
        category: c.category,
        lot: c.lot,
        role: c.role,
        cost: c.unitCost == null ? "—" : `USD ${c.lineCost.toLocaleString("en-US")}`,
      })),
    },
  };
}
