/** Q4: el voucher registra el pedido en ZDRY. No es purchase.order. No confirma la SO. */

import { shouldEnqueueOdoo, type DealStatus } from "../deal-close/deal-close.types";

export const PEDIDO_EVENT = "pedido_registrado";

/** Estados en los que el cliente deja el pedido (PDF Odoo + voucher interbancario). */
export const PEDIDO_VOUCHER_STATUSES: DealStatus[] = [
  "reservada",
  "en_negociacion",
  "pago_rechazado",
  "comprobante_subido",
];

export const PEDIDO_VOUCHER_TRANSITIONS: [DealStatus, DealStatus][] = [
  ["reservada", "comprobante_subido"],
  ["en_negociacion", "comprobante_subido"],
  ["pago_rechazado", "comprobante_subido"],
  ["comprobante_subido", "en_verificacion"],
  ["comprobante_subido", "pago_validado"],
  ["comprobante_subido", "pago_rechazado"],
  ["en_verificacion", "pago_validado"],
  ["en_verificacion", "pago_rechazado"],
];

export class QuotePedidoError extends Error {
  constructor(
    message: string,
    public readonly code: "needs_odoo" | "too_early" | "closes_odoo",
  ) {
    super(message);
  }
}

export function canRegisterPedido(status: DealStatus): boolean {
  return PEDIDO_VOUCHER_STATUSES.includes(status);
}

export function requiresOdooQuoteForPedido(kind: string, demo: boolean): boolean {
  return (kind === "venta" || kind === "alquiler") && !demo;
}

export function clientOrderDisplay(odooSaleName?: string | null, zdryNumber?: string | null): string {
  const odoo = String(odooSaleName || "").trim();
  if (odoo) return odoo;
  return String(zdryNumber || "").trim();
}

export function pedidoRegistered(voucherCount: number): boolean {
  return voucherCount > 0;
}

export function assertOdooQuoteForPedido(
  kind: string,
  demo: boolean,
  odooSaleName?: string | null,
): void {
  if (!requiresOdooQuoteForPedido(kind, demo)) return;
  if (String(odooSaleName || "").trim()) return;
  throw new QuotePedidoError(
    "El pedido se registra sobre la cotización Odoo. Espera el número 10020… (no se crea otra cotización).",
    "needs_odoo",
  );
}

export function assertCanRegisterPedido(status: DealStatus): void {
  if (canRegisterPedido(status)) return;
  throw new QuotePedidoError(
    "Cuando el comercial reserve la cotización (hold 48 h) podrás adjuntar el voucher y registrar el pedido.",
    "too_early",
  );
}

/** Q4: ninguna transición de voucher/pago encola sale_close. */
export function assertPedidoKeepsOdooDraft(from: DealStatus, to: DealStatus): void {
  if (!shouldEnqueueOdoo(from, to)) return;
  throw new QuotePedidoError(
    "El voucher registra el pedido en ZDRY; no confirma ni cierra la SO de Odoo.",
    "closes_odoo",
  );
}

export function pedidoEventDetail(odooSaleName: string | null | undefined, bank: string, operation: string): string {
  const op = [bank, operation].filter(Boolean).join(" ").trim();
  const ref = String(odooSaleName || "").trim();
  const tail = op ? ` Comprobante ${op}.` : "";
  if (ref) {
    return `Pedido ZDRY sobre cotización Odoo ${ref}.${tail} No es purchase.order. La SO sigue draft hasta confirmar.`;
  }
  return `Pedido ZDRY registrado.${tail} Sin SO Odoo (demo).`;
}
