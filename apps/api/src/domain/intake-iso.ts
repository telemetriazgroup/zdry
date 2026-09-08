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
  const reason = inspected.isoException
    ? inspected.check.reason || "ISO 6346 no válido (formato o dígito de control)."
    : null;
  return {
    ...inspected,
    isoNormalized: iso,
    ok: true as const,
    isoException: inspected.isoException,
    isoExceptionReason: reason,
  };
}
