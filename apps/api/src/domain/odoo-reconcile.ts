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

/** Lo que el comercial puede vender: lo mismo que el catálogo público. */
export function publishedStockWhere() {
  return {
    intakeType: { in: ["compra", "pendiente_factura", "ajuste_odoo", "fabricacion_odoo"] },
    physicallyReceived: true,
    status: { in: ["Disponible", "Reservado"] },
    mediaStatus: "aprobado",
    lado: { not: null },
    ruma: { not: null },
    columna: { not: null },
    nivel: { not: null },
    NOT: [pendingValuationWhere(), { lado: "PASILLO" }],
  };
}

export const UNRECONCILED_PUBLISH_MESSAGE =
  "Reentrega sin conciliar: no se publica en el catálogo hasta el match con una orden de compra. Sin OC no hay precio.";

export const LEFT_PUBLISH_MESSAGE =
  "Ya vendida o con salida: no se publica. Abre la fila para ver sus datos.";

export const MISSING_LOCATION_PUBLISH_MESSAGE =
  "No se puede publicar porque falta definir ubicación.";

export const PREPUBLISHED_STATUS = "prepublicado";

export const PREPUBLISHED_WAITING_MESSAGE =
  "Prepublicada. Falta confirmar la posición en un depósito. Se publica sola cuando el puesto quede definido.";

export const LOCATION_PUBLISHED_MESSAGE =
  "Se publicó al confirmar la posición en el depósito.";

export type CatalogHoldPatch = {
  mediaStatus: "aprobado" | "prepublicado" | "oculto";
  clearApproval: boolean;
  detail: string;
};

/** Publicado con fotos y sin puesto queda prepublicado. Al confirmar el puesto vuelve a publicado. Sin fotos, se oculta. */
export function catalogHoldPatch(c: {
  mediaStatus?: string | null;
  photoCount: number;
  lado?: string | null;
  ruma?: number | null;
  columna?: number | null;
  nivel?: number | null;
  status?: string | null;
  gateOut?: boolean | null;
  commercialStatus?: string | null;
}): CatalogHoldPatch | null {
  const left = c.status === "Vendido" || !!c.gateOut || c.commercialStatus === "vendido";
  if (left) return null;
  const located = hasCatalogLocation(c);
  const photos = Number(c.photoCount) >= 1;
  const status = c.mediaStatus || "";
  if (located && status === PREPUBLISHED_STATUS && photos) {
    return { mediaStatus: "aprobado", clearApproval: false, detail: LOCATION_PUBLISHED_MESSAGE };
  }
  if (!located && status === "aprobado" && photos) {
    return { mediaStatus: PREPUBLISHED_STATUS, clearApproval: false, detail: PREPUBLISHED_WAITING_MESSAGE };
  }
  if (!located && (status === "aprobado" || status === PREPUBLISHED_STATUS) && !photos) {
    return { mediaStatus: "oculto", clearApproval: true, detail: `Se quitó del catálogo. ${MISSING_LOCATION_PUBLISH_MESSAGE}` };
  }
  return null;
}

/** Recupera un publicado con fotos que el barrido anterior pasó a oculto solo por falta de ubicación. */
export function recoverPrepublished(details: string[]): boolean {
  let published = false;
  let waiting = false;
  for (const raw of details) {
    const detail = String(raw || "");
    if (detail.includes("Ficha publicada") || detail.includes(LOCATION_PUBLISHED_MESSAGE)) {
      published = true;
      waiting = false;
    }
    if (detail.includes("Ficha oculta")) {
      published = false;
      waiting = false;
    }
    if (detail.includes("Se quitó del catálogo") && detail.includes("ubicación")) waiting = published;
    if (detail.startsWith("Prepublicada.")) {
      published = true;
      waiting = true;
    }
  }
  return published && waiting;
}

/** Puesto en una zona o en el cerco de un depósito. El pasillo y sin sitio no alcanzan. */
export function hasCatalogLocation(c: {
  lado?: string | null;
  ruma?: number | null;
  columna?: number | null;
  nivel?: number | null;
}): boolean {
  const lado = String(c.lado || "").trim();
  if (!lado || lado === "PASILLO") return false;
  return Number(c.ruma) >= 1 && Number(c.columna) >= 1 && Number(c.nivel) >= 1;
}

export function catalogPublishBlock(c: {
  odooPoId?: number | null;
  status?: string | null;
  invoicePending?: boolean | null;
  intakeType?: string | null;
  gateOut?: boolean | null;
  commercialStatus?: string | null;
  lado?: string | null;
  ruma?: number | null;
  columna?: number | null;
  nivel?: number | null;
}): string | null {
  if (c.status === "Vendido" || c.gateOut || c.commercialStatus === "vendido") return LEFT_PUBLISH_MESSAGE;
  if (!hasCatalogLocation(c)) return MISSING_LOCATION_PUBLISH_MESSAGE;
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

export type ReconcileLotRef = {
  id: string;
  odooLotId: number;
  isoNormalized?: string | null;
  serialRaw?: string | null;
  odooPickingName?: string | null;
  odooPoId?: number | null;
};

/**
 * Un IN puede traer varias series. El lote que se liga es el de esta serie,
 * no el primero del picking. Si el IN no trae esa serie, no hay candidato.
 */
export function pickReconcileCandidate<T extends ReconcileLotRef>(
  iso: string,
  lots: T[],
  chosen?: { candidateId?: string | null; rightId?: string | null },
): T | null {
  const want = inspectOdooIso(iso).isoNormalized;
  if (!want) return null;
  const sameSerial = (lot: T) => inspectOdooIso(lot.isoNormalized || lot.serialRaw || "").isoNormalized === want;
  const rightId = String(chosen?.rightId || "").trim();
  const onChosenIn = (lot: T) => {
    if (!rightId) return true;
    return lot.id === rightId || lot.odooPickingName === rightId || (lot.odooPoId != null && `po:${lot.odooPoId}` === rightId);
  };
  const scoped = lots.filter((lot) => sameSerial(lot) && onChosenIn(lot));
  if (!scoped.length) return null;
  const hinted = chosen?.candidateId ? scoped.find((lot) => lot.id === chosen.candidateId) : null;
  return hinted || scoped[0];
}

export type RelinkCandidate = {
  id: string;
  odooLotId: number;
  isoNormalized?: string | null;
  serialRaw?: string | null;
  containerIso?: string | null;
  qtyOnHand?: number | null;
};

export type RelinkContainer = {
  iso: string;
  odooLotId?: number | null;
};

/**
 * La serie queda ligada a su lote. Si otro candidato tenía esta serie como
 * containerIso, se le devuelve la suya. No se cambia el lote ni la ficha del otro equipo.
 */
export function planOdooRelink(input: {
  iso: string;
  candidates: RelinkCandidate[];
  containers: RelinkContainer[];
}):
  | { ok: false; message: string }
  | {
      ok: true;
      candidateId: string;
      odooLotId: number;
      restore: Array<{ candidateId: string; containerIso: string | null }>;
    } {
  const want = inspectOdooIso(input.iso).isoNormalized;
  if (!want) return { ok: false, message: "La serie no es válida." };
  const serialOf = (row: { isoNormalized?: string | null; serialRaw?: string | null }) =>
    inspectOdooIso(row.isoNormalized || row.serialRaw || "").isoNormalized;
  const matches = input.candidates.filter((row) => serialOf(row) === want);
  const own = [...matches].sort((a, b) => (b.qtyOnHand ?? 0) - (a.qtyOnHand ?? 0))[0];
  if (!own) {
    return { ok: false, message: "No hay un lote Odoo con esta serie. No se creó un duplicado ni se tocó el otro equipo." };
  }
  const restore: Array<{ candidateId: string; containerIso: string | null }> = [];
  for (const row of input.candidates) {
    if (row.id === own.id || row.containerIso !== input.iso) continue;
    const back = input.containers.find((unit) => unit.iso !== input.iso && serialOf({ isoNormalized: unit.iso }) === serialOf(row));
    restore.push({ candidateId: row.id, containerIso: back?.iso || null });
  }
  return { ok: true, candidateId: own.id, odooLotId: own.odooLotId, restore };
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
