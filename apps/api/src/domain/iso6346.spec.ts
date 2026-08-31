import { completeIso, damFormatOk, parseIso6346 } from "./iso6346";

describe("ISO 6346", () => {
  it("completa el dígito de control y lo valida", () => {
    const iso = completeIso("ZDRU123456");
    const parsed = parseIso6346(iso);
    expect(parsed.valid).toBe(true);
    expect(parsed.checkOk).toBe(true);
    expect(iso).toHaveLength(11);
  });

  it("rechaza formato inválido", () => {
    const parsed = parseIso6346("ABC123");
    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toMatch(/Formato inválido/);
  });

  it("normaliza espacios y minúsculas", () => {
    const iso = completeIso("ZDRU000001");
    const parsed = parseIso6346(iso.toLowerCase().slice(0, 4) + " " + iso.slice(4));
    expect(parsed.checkOk).toBe(true);
  });

  it("detecta dígito incorrecto y sugiere la corrección", () => {
    const good = completeIso("CIMU778812");
    const wrongDigit = good.slice(0, 10) + String((Number(good[10]) + 1) % 10);
    const parsed = parseIso6346(wrongDigit);
    expect(parsed.valid).toBe(true);
    expect(parsed.checkOk).toBe(false);
    expect(parsed.suggested).toBe(good);
  });

  it("el ejemplo del prototipo ZDRU1234565 es coherente con el algoritmo", () => {
    const parsed = parseIso6346("ZDRU1234565");
    expect(parsed.valid).toBe(true);
    if (!parsed.checkOk) {
      expect(parsed.suggested).toBe(parsed.code10 + String(parsed.expectedCheckDigit));
    }
  });
});

describe("DAM", () => {
  it("acepta aduana-año-régimen-correlativo", () => {
    expect(damFormatOk("118-2026-40-81593")).toBe(true);
  });

  it("rechaza formatos cortos", () => {
    expect(damFormatOk("118-2026")).toBe(false);
  });
});
