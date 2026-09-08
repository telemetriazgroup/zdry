import { parseBuildYear, YEAR_MIN } from "./year";

describe("parseBuildYear", () => {
  it("acepta 1980 y el año actual", () => {
    expect(parseBuildYear(YEAR_MIN, 2026)).toEqual({ ok: true, year: 1980 });
    expect(parseBuildYear(2026, 2026)).toEqual({ ok: true, year: 2026 });
  });

  it("rechaza 1979 con error claro", () => {
    const r = parseBuildYear(1979, 2026);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/1980 y 2026/);
  });

  it("acepta vacío", () => {
    expect(parseBuildYear(null)).toEqual({ ok: true, year: null });
    expect(parseBuildYear("")).toEqual({ ok: true, year: null });
  });
});
