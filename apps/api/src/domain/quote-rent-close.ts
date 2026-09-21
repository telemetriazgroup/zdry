/** Q6 cierre alquiler: confirma la SO de suscripción. No factura producto. No valida OUT. No es Q5. */

import { partnerVatOk } from "./quote-sale-close";

export const RENT_CLOSE_EVENT = "rent_close";
export const RENT_CLOSE_MAX_ATTEMPTS = 5;
export const RENT_CLOSE_SOURCE = "zdry" as const;

export class QuoteRentCloseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_sale"
      | "no_vat"
      | "sale"
      | "demo"
      | "empty"
      | "missing_lot"
      | "creates_so"
      | "invoices"
      | "validates_out",
  ) {
    super(message);
  }
}

export function assertRentCloseable(input: {
  kind: string;
  demo: boolean;
  odooSaleId?: number | null;
  vat?: string | null;
  lines: Array<{ iso: string }>;
}): void {
  if (input.demo) throw new QuoteRentCloseError("Las cotizaciones demo no se cierran en Odoo.", "demo");
  if (input.kind !== "alquiler") {
    throw new QuoteRentCloseError("Q6 solo cierra alquiler. La venta entra en Q5.", "sale");
  }
  if (!input.odooSaleId) {
    throw new QuoteRentCloseError(
      "No hay cotización Odoo de alquiler que confirmar. Q6 no crea una SO nueva (eso fue rent_issue).",
      "missing_sale",
    );
  }
  if (!partnerVatOk(input.vat)) {
    throw new QuoteRentCloseError("El cliente no tiene RUC (11 dígitos). No se confirma la SO.", "no_vat");
  }
  if (!input.lines.length) throw new QuoteRentCloseError("La cotización no tiene líneas DRY.", "empty");
}

export function assertRentCloseDoesNotCreateSale(payload: Record<string, unknown>): void {
  if (payload.model === "sale.order" && payload.method === "create") {
    throw new QuoteRentCloseError("Q6 cierre no crea sale.order.", "creates_so");
  }
}

export function assertRentCloseDoesNotInvoice(method: string): void {
  const m = String(method || "");
  if (m === "_create_invoices" || m === "action_post") {
    throw new QuoteRentCloseError(
      "Q6 no publica la cuota: el cron de sale_subscription factura el servicio.",
      "invoices",
    );
  }
}

export function assertRentCloseDoesNotValidatePicking(method: string): void {
  const m = String(method || "");
  if (m === "button_validate" || m === "_action_done") {
    throw new QuoteRentCloseError("Q6 no valida el OUT; el patio ZDRY sigue ocupado.", "validates_out");
  }
}

export function rentCloseKwargs(): { context: { zdry_sync: true } } {
  return { context: { zdry_sync: true } };
}

export type RentSemaphore = {
  quoted: boolean;
  confirmed: boolean;
  invoiced: boolean;
  dispatchedOdoo: boolean;
  returnedOdoo: boolean;
};

export function rentSemaphore(input: {
  odooSaleId?: number | null;
  odooState?: string | null;
  odooInvoiceName?: string | null;
  installmentCount?: number;
  odooPickingState?: string | null;
  odooPickingInState?: string | null;
}): RentSemaphore {
  const state = String(input.odooState || "").toLowerCase();
  const pick = String(input.odooPickingState || "").toLowerCase();
  const inn = String(input.odooPickingInState || "").toLowerCase();
  return {
    quoted: Boolean(input.odooSaleId),
    confirmed: state === "sale" || state === "done",
    invoiced: Boolean(input.odooInvoiceName) || (input.installmentCount || 0) > 0,
    dispatchedOdoo: pick === "done",
    returnedOdoo: inn === "done",
  };
}
