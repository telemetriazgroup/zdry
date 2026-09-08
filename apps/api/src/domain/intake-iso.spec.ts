import { inspectIntakeIso } from "./intake-iso";
import { completeIso } from "./iso6346";

describe("inspectIntakeIso", () => {
  it("no bloquea un dígito de control incorrecto", () => {
    const good = completeIso("CAIU123456");
    const wrong = good.slice(0, 10) + String((Number(good[10]) + 1) % 10);
    const r = inspectIntakeIso(wrong);
    expect(r.ok).toBe(true);
    expect(r.isoException).toBe(true);
    expect(r.isoNormalized).toBe(wrong);
  });

  it("no bloquea un formato inválido si hay serial", () => {
    const r = inspectIntakeIso("ABC12345");
    expect(r.ok).toBe(true);
    expect(r.isoException).toBe(true);
    expect(r.isoNormalized).toBe("ABC12345");
  });

  it("rechaza serial demasiado corto", () => {
    const r = inspectIntakeIso("AB");
    expect(r.ok).toBe(false);
  });
});
