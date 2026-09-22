import { auditDateRange } from "./audit.service";

describe("auditDateRange", () => {
  it("interpreta YYYY-MM-DD en hora de Lima", () => {
    const r = auditDateRange("2026-09-01", "2026-09-22");
    expect(r.fromDay).toBe("2026-09-01");
    expect(r.toDay).toBe("2026-09-22");
    expect(r.from?.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-09-23T04:59:59.999Z");
  });

  it("ignora valores inválidos", () => {
    const r = auditDateRange("ayer", "");
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });
});
