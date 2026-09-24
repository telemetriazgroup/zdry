import { inspectOdooIso } from "./odoo-lot-map";
import { parseSerialsFromPoText } from "./odoo-purchase";

export type ReentregaRef = {
  iso: string;
};

export type OdooInRef = {
  lotIsos: string[];
  lineTexts?: string[];
  pickingState?: string | null;
};

export type MatchMode = "auto" | "proposal" | "none";
export type MatchReason = "iso" | "line_text" | "draft" | "no_overlap";

export type MatchProposal = {
  mode: MatchMode;
  reason: MatchReason;
  isoNormalized: string;
};

export const PENDING_VALUATION_EXCLUDE = ["ajuste_odoo", "fabricacion_odoo", "almacenaje_cliente"] as const;

/** Reentrega (u OC sin valor) pendiente de conciliar con una OC para tener precio y proveedor. */
export function isPendingValuation(c: {
  odooPoId?: number | null;
  status?: string | null;
  invoicePending?: boolean | null;
  intakeType?: string | null;
}): boolean {
  if (c.status === "Vendido") return false;
  if (c.odooPoId != null) return false;
  if (!c.invoicePending && c.intakeType !== "pendiente_factura") return false;
  return !PENDING_VALUATION_EXCLUDE.includes((c.intakeType || "") as (typeof PENDING_VALUATION_EXCLUDE)[number]);
}

export function pendingValuationWhere() {
  return {
    odooPoId: null,
    status: { not: "Vendido" as const },
    OR: [{ invoicePending: true }, { intakeType: "pendiente_factura" }],
    NOT: { intakeType: { in: [...PENDING_VALUATION_EXCLUDE] } },
  };
}

export const UNRECONCILED_PUBLISH_MESSAGE =
  "Reentrega sin conciliar: no se publica en el catálogo hasta el match con una orden de compra. Sin OC no hay precio.";

export function catalogPublishBlock(c: {
  odooPoId?: number | null;
  status?: string | null;
  invoicePending?: boolean | null;
  intakeType?: string | null;
}): string | null {
  return isPendingValuation(c) ? UNRECONCILED_PUBLISH_MESSAGE : null;
}

export function isPickingDone(state?: string | null): boolean {
  const s = String(state || "").trim().toLowerCase();
  if (!s) return true;
  return s === "done";
}

export function proposeMatch(reentrega: ReentregaRef, odoo: OdooInRef): MatchProposal {
  const isoNormalized = inspectOdooIso(reentrega.iso).isoNormalized;
  if (!isoNormalized) return { mode: "none", reason: "no_overlap", isoNormalized: "" };
  if (odoo.pickingState && !isPickingDone(odoo.pickingState)) {
    return { mode: "none", reason: "draft", isoNormalized };
  }
  const lotIsos = (odoo.lotIsos || []).map((s) => inspectOdooIso(s).isoNormalized).filter(Boolean);
  if (lotIsos.includes(isoNormalized)) {
    return { mode: "auto", reason: "iso", isoNormalized };
  }
  const mentioned = (odoo.lineTexts || []).flatMap((t) => parseSerialsFromPoText(t));
  if (mentioned.includes(isoNormalized)) {
    return { mode: "proposal", reason: "line_text", isoNormalized };
  }
  return { mode: "none", reason: "no_overlap", isoNormalized };
}

export function assertConfirmMatch(input: { alreadyPoId?: number | null; pickingState?: string | null }): {
  ok: true;
} | { ok: false; status: 409 | 400; message: string } {
  if (input.alreadyPoId) return { ok: false, status: 409, message: "Esta serie ya está conciliada." };
  if (input.pickingState && !isPickingDone(input.pickingState)) {
    return { ok: false, status: 400, message: "El IN está en borrador. Solo se concilia un incoming done." };
  }
  return { ok: true };
}

export function reconcileContainerPatch(odoo: {
  odooPoId: number | null;
  odooPoName?: string | null;
  odooPickingName?: string | null;
  odooVendorName?: string | null;
  odooBillName?: string | null;
  odooUnitPrice?: number | null;
  odooLotId?: number | null;
}) {
  const price = Number(odoo.odooUnitPrice);
  const fob = Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0;
  return {
    odooPoId: odoo.odooPoId,
    odooPoName: odoo.odooPoName || null,
    odooPickingName: odoo.odooPickingName || null,
    odooVendorName: odoo.odooVendorName || null,
    odooBillName: odoo.odooBillName || null,
    odooUnitPrice: fob || null,
    odooLotId: odoo.odooLotId || undefined,
    fobCif: fob,
    intakeType: "compra" as const,
    costSource: "oc" as const,
    odooIntakeKind: "purchase" as const,
    intakeOrigin: "odoo" as const,
    invoicePending: true,
  };
}
