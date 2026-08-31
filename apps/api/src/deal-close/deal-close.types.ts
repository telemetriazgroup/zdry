/**
 * Máquina de cierre comercial (plan v1.1 §8.2b).
 * El prototipo marcaba "Ganada" con un clic. En producción el comercial
 * valida el comprobante (el interbancario demora), informa movimientos
 * de patio, ofrece transporte, confirma el ISO y programa el despacho.
 * Recién ahí se encola el sync a Odoo. ZDRY no se integra a SUNAT.
 */

export const DEAL_STATUSES = [
  "nueva",
  "cotizada",
  "reservada",
  "en_negociacion",
  "comprobante_subido",
  "en_verificacion",
  "pago_rechazado",
  "pago_validado",
  "asignacion_confirmada",
  "despacho_programado",
  "perdida",
  "expirada",
] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

export const HOLD_PAUSING_STATUSES: DealStatus[] = [
  "en_negociacion",
  "comprobante_subido",
  "en_verificacion",
];

const ALLOWED: Record<DealStatus, DealStatus[]> = {
  nueva: ["cotizada", "perdida"],
  cotizada: ["reservada", "perdida", "expirada"],
  reservada: ["en_negociacion", "comprobante_subido", "perdida", "expirada"],
  en_negociacion: ["reservada", "comprobante_subido", "perdida"],
  comprobante_subido: ["en_verificacion", "pago_validado", "pago_rechazado"],
  en_verificacion: ["pago_validado", "pago_rechazado"],
  pago_rechazado: ["comprobante_subido", "perdida", "expirada"],
  pago_validado: ["asignacion_confirmada"],
  asignacion_confirmada: ["despacho_programado"],
  despacho_programado: [],
  perdida: [],
  expirada: [],
};

export class IllegalDealTransitionError extends Error {
  constructor(
    public readonly from: DealStatus,
    public readonly to: DealStatus,
  ) {
    super(`Transición ilegal de cierre: ${from} → ${to}`);
  }
}

export function canTransition(from: DealStatus, to: DealStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: DealStatus, to: DealStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalDealTransitionError(from, to);
  }
}

export function holdClockPaused(status: DealStatus): boolean {
  return HOLD_PAUSING_STATUSES.includes(status);
}

/** Asignar ISO o programar despacho exige pago validado por un comercial. */
export function canAssignProduct(status: DealStatus): boolean {
  return status === "pago_validado" || status === "asignacion_confirmada";
}

export function shouldEnqueueOdoo(from: DealStatus, to: DealStatus): boolean {
  return from === "pago_validado" && to === "asignacion_confirmada";
}
