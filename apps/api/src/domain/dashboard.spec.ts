import { addCostBucket, countByDay, limaLastDays, limaYmd, rankCostBuckets } from "./dashboard";

describe("dashboard series", () => {
  it("arma 14 días Lima y cuenta solo los del rango", () => {
    const days = limaLastDays(7);
    expect(days).toHaveLength(7);
    expect(days[days.length - 1]).toBe(limaYmd());
    const today = new Date();
    const old = new Date(today.getTime() - 20 * 86400000);
    const series = countByDay([today, today, old], 7);
    expect(series).toHaveLength(7);
    expect(series[series.length - 1].count).toBe(2);
    expect(series.reduce((s, d) => s + d.count, 0)).toBe(2);
  });

  it("agrupa costo por tipo y ordena por base", () => {
    const map = new Map();
    addCostBucket(map, "40HC", 1200, 100);
    addCostBucket(map, "40HC", 800, 0);
    addCostBucket(map, "20GP", 300, 50);
    const ranked = rankCostBuckets(map);
    expect(ranked[0]).toMatchObject({ key: "40HC", units: 2, cost: 2000, extras: 100, base: 2100 });
    expect(ranked[1].key).toBe("20GP");
  });
});
