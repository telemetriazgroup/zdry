import { inspectOdooIso } from "./odoo-lot-map";

const MIN_SERIAL = 4;

export function inspectIntakeIso(raw: string) {
  const inspected = inspectOdooIso(raw);
  const iso = inspected.isoNormalized;
  if (!iso || iso.length < MIN_SERIAL) {
    return {
      ...inspected,
      isoNormalized: iso,
      ok: false as const,
      message: "Ingresa el código de la placa (mínimo 4 caracteres).",
    };
  }
  const check = inspected.check;
  const reason = inspected.isoException
    ? check.reason
      || (check.expectedCheckDigit != null
        ? `El último dígito debería ser ${check.expectedCheckDigit}. Código que lo complementa: ${check.suggested}.`
        : "ISO 6346 no válido (formato o dígito de control).")
    : null;
  return {
    ...inspected,
    isoNormalized: iso,
    ok: true as const,
    isoException: inspected.isoException,
    isoExceptionReason: reason,
  };
}
