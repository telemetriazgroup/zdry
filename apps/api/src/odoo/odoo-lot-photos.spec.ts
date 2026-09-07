import { limaDayRange } from "./odoo-lot-photos";

describe("limaDayRange", () => {
  it("usa el día indicado y cierra el rango en UTC-5", () => {
    const r = limaDayRange("2026-09-07");
    expect(r.date).toBe("2026-09-07");
    expect(r.start.toISOString()).toBe("2026-09-07T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-08T04:59:59.999Z");
  });
});
