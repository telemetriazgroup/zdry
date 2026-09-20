import { assimilateLogCsv, dayEnd, dayStart, errorDetail, isStaleRunning, presentAssimilateRun } from "./odoo-assimilate-log";

describe("assimilate log", () => {
  it("errorDetail guarda mensaje y stack", () => {
    const err = new Error("Odoo 500 purchase.order");
    const out = errorDetail(err);
    expect(out.message).toMatch(/purchase.order/);
    expect(out.detail).toMatch(/Error: Odoo 500/);
  });

  it("presenta un run con contadores", () => {
    const p = presentAssimilateRun({
      id: "r1",
      kind: "sync",
      status: "done",
      startedAt: "2026-09-20T12:00:00.000Z",
      endedAt: "2026-09-20T12:05:00.000Z",
      startedBy: "Ana",
      okCount: 10,
      errorCount: 2,
      skipCount: 1,
      message: "Listo",
    });
    expect(p.okCount).toBe(10);
    expect(p.errorCount).toBe(2);
    expect(p.startedBy).toBe("Ana");
  });

  it("run running viejo es stale", () => {
    expect(isStaleRunning(new Date(Date.now() - 41 * 60 * 1000))).toBe(true);
    expect(isStaleRunning(new Date())).toBe(false);
  });
});

describe("rango y csv", () => {
  it("dayStart / dayEnd", () => {
    expect(dayStart("2026-09-20")?.toISOString()).toMatch(/2026-09-20/);
    expect(dayEnd("2026-09-20")?.getTime()).toBeGreaterThan(dayStart("2026-09-20")?.getTime() || 0);
    expect(dayStart("")).toBeNull();
  });

  it("csv escapa comillas y une filas", () => {
    const csv = assimilateLogCsv([
      {
        createdAt: "2026-09-20T12:00:00.000Z",
        level: "error",
        step: "dossier",
        iso: "BMOU4349332",
        serialRaw: "BMOU434933-2",
        odooLotId: 1,
        product: 'DRY 40; "HC"',
        message: "Falló",
        detail: "stack",
      },
    ]);
    expect(csv).toMatch(/fecha;nivel/);
    expect(csv).toMatch(/BMOU4349332/);
    expect(csv).toMatch(/"DRY 40; ""HC"""/);
  });
});
