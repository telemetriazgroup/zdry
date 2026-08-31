/** ISO 6346 — copiado 1:1 de zdry_prototype_26.html (parseIso6346 / iso6346CheckDigit). */

export const ISO6346_LETTER_VALUES: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  let v = 10;
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    if (v % 11 === 0) v++;
    map[ch] = v;
    v++;
  }
  return map;
})();

export function iso6346CheckDigit(code10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = code10[i];
    const val = /[0-9]/.test(ch) ? parseInt(ch, 10) : ISO6346_LETTER_VALUES[ch];
    sum += val * Math.pow(2, i);
  }
  const rem = sum % 11;
  return rem === 10 ? 0 : rem;
}

export type IsoParse = {
  valid: boolean;
  code: string;
  reason?: string;
  code10?: string;
  checkDigit?: number;
  expectedCheckDigit?: number;
  checkOk?: boolean;
  suggested?: string;
};

export function parseIso6346(raw: string): IsoParse {
  const code = String(raw || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  const m = code.match(/^([A-Z]{3})U(\d{6})(\d)$/);
  if (!m) {
    return {
      valid: false,
      code,
      reason: "Formato inválido — debe ser 3 letras + U, 6 dígitos y 1 dígito de control (ej. ZDRU1234565).",
    };
  }
  const code10 = m[1] + "U" + m[2];
  const expected = iso6346CheckDigit(code10);
  const given = parseInt(m[3], 10);
  return {
    valid: true,
    code,
    code10,
    checkDigit: given,
    expectedCheckDigit: expected,
    checkOk: given === expected,
    suggested: code10 + String(expected),
  };
}

export function completeIso(code10: string): string {
  const n = String(code10 || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (!/^[A-Z]{3}U\d{6}$/.test(n)) {
    throw new Error("code10 debe ser 3 letras + U + 6 dígitos");
  }
  return n + String(iso6346CheckDigit(n));
}

export const DAM_REGEX = /^\d{3}-\d{4}-\d{2}-\d{5}$/;

export function damFormatOk(dam: string): boolean {
  return DAM_REGEX.test(String(dam || "").trim());
}

export function requiresNationalization(intakeType: string): boolean {
  return intakeType === "compra" || intakeType === "pendiente_factura";
}

/** Stock propio de ZDRY (compra facturada o reentrega aún sin factura). No es custodia de cliente. */
export function isOwnSaleStock(intakeType: string | null | undefined): boolean {
  return intakeType === "compra" || intakeType === "pendiente_factura";
}

export function isNationalized(intakeType: string, damNumber: string | null | undefined): boolean {
  return !requiresNationalization(intakeType) || !!damNumber;
}
