/** Q5 / J5: confirmar la SO que Q2 ya creó. No crea otra. No valida el OUT. */

import { shouldEnqueueOdoo, type DealStatus } from "../deal-close/deal-close.types";

export const SALE_CLOSE_EVENT = "sale_close";
export const SALE_CLOSE_MAX_ATTEMPTS = 5;
export const SALE_CLOSE_SOURCE = "zdry" as const;

export class QuoteSaleCloseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_sale"
      | "no_vat"
      | "rental"
      | "demo"
      | "empty"
      | "missing_lot"
      | "creates_so"
      | "validates_out",
  ) {
    super(message);
  }
}

export function assertShouldEnqueueOnlyOnAssign(from: DealStatus, to: DealStatus): boolean {
  return shouldEnqueueOdoo(from, to);
}

export function partnerVatOk(vat?: string | null): boolean {
  return /^\d{11}$/.test(String(vat || "").replace(/\D/g, ""));
}

export function assertCloseable(input: {
  kind: string;
  demo: boolean;
  odooSaleId?: number | null;
  vat?: string | null;
  lines: Array<{ iso: string }>;
}): void {
  if (input.demo) throw new QuoteSaleCloseError("Las cotizaciones demo no se cierran en Odoo.", "demo");
  if (input.kind === "alquiler") {
    throw new QuoteSaleCloseError("Alquiler: el cierre Odoo entra en Q6, no en Q5.", "rental");
  }
  if (!input.odooSaleId) {
    throw new QuoteSaleCloseError(
      "No hay cotización Odoo que confirmar. Q5 no crea una SO nueva (eso fue Q2).",
      "missing_sale",
    );
  }
  if (!partnerVatOk(input.vat)) {
    throw new QuoteSaleCloseError("El cliente no tiene RUC (11 dígitos). No se confirma la SO.", "no_vat");
  }
  if (!input.lines.length) throw new QuoteSaleCloseError("La cotización no tiene líneas DRY.", "empty");
}

export type EquipoBind = { lineId: number; iso: string; lotId: number | null; equipoValue: number | string };

export function matchSolToIso(
  lines: Array<{ id: number; name?: string | null; x_studio_tipo?: string | null }>,
  isos: string[],
): Array<{ lineId: number; iso: string }> {
  const used = new Set<number>();
  const out: Array<{ lineId: number; iso: string }> = [];
  for (const iso of isos) {
    const needle = iso.trim().toUpperCase();
    const hit = lines.find((l) => {
      if (used.has(l.id)) return false;
      const tipo = String(l.x_studio_tipo || "");
      if (tipo.includes("FLETE") || tipo.includes("SERVICIO")) return false;
      return String(l.name || "").toUpperCase().includes(needle);
    });
    if (hit) {
      used.add(hit.id);
      out.push({ lineId: hit.id, iso });
    }
  }
  return out;
}

export function equipoWriteValue(
  fieldType: string | undefined,
  lotId: number | null,
  iso: string,
): number | string | null {
  const t = String(fieldType || "").toLowerCase();
  if (t === "many2one") return lotId && lotId > 0 ? lotId : null;
  return iso;
}

export function assertHasLots(binds: Array<{ iso: string; lotId: number | null }>): void {
  const missing = binds.filter((b) => !b.lotId || b.lotId <= 0).map((b) => b.iso);
  if (missing.length) {
    throw new QuoteSaleCloseError(
      `ISO sin lote Odoo: ${missing.join(", ")}. No se confirma a medias.`,
      "missing_lot",
    );
  }
}

/** Q5 escribe líneas existentes y llama action_confirm. Nunca sale.order.create. */
export function assertCloseDoesNotCreateSale(payload: Record<string, unknown>): void {
  if ("partner_id" in payload && payload.create_sale) {
    throw new QuoteSaleCloseError("Q5 no crea sale.order.", "creates_so");
  }
  if (payload.model === "sale.order" && payload.method === "create") {
    throw new QuoteSaleCloseError("Q5 no crea sale.order.", "creates_so");
  }
}

export function assertCloseDoesNotValidatePicking(method: string): void {
  const m = String(method || "");
  if (m === "button_validate" || m === "_action_done") {
    throw new QuoteSaleCloseError("Q5 no valida el OUT; el patio ZDRY sigue ocupado.", "validates_out");
  }
}

export function closeKwargs(): { context: { zdry_sync: true } } {
  return { context: { zdry_sync: true } };
}

export type QuoteSemaphore = {
  quoted: boolean;
  confirmed: boolean;
  invoiced: boolean;
  dispatchedOdoo: boolean;
};

export function quoteSemaphore(input: {
  odooSaleId?: number | null;
  odooState?: string | null;
  odooInvoiceStatus?: string | null;
  odooInvoiceName?: string | null;
  odooPickingState?: string | null;
}): QuoteSemaphore {
  const state = String(input.odooState || "").toLowerCase();
  const inv = String(input.odooInvoiceStatus || "").toLowerCase();
  const pick = String(input.odooPickingState || "").toLowerCase();
  return {
    quoted: Boolean(input.odooSaleId),
    confirmed: state === "sale" || state === "done",
    invoiced: Boolean(input.odooInvoiceName) || inv === "invoiced",
    dispatchedOdoo: pick === "done",
  };
}
