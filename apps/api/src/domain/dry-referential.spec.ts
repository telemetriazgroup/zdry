import { averageOcUnitPrices, effectiveDryReferential, normalizeDryReferential, pricesFromOriginRows } from "./dry-referential";

describe("dry referential", () => {
  it("promedia solo precios OC positivos", () => {
    expect(averageOcUnitPrices([1325, 1325, 900, 0, null])).toBe(1183.33);
    expect(averageOcUnitPrices([])).toBeNull();
  });

  it("ignora ajustes aunque tengan precio espurio", () => {
    const prices = pricesFromOriginRows([
      { odooIntakeKind: "adjustment", costSource: "referential", odooUnitPrice: 9999 },
      { odooIntakeKind: "purchase", costSource: "oc", odooUnitPrice: 1325 },
      { odooIntakeKind: "purchase", costSource: "oc", odooUnitPrice: 900 },
    ]);
    expect(averageOcUnitPrices(prices)).toBe(1112.5);
  });

  it("el monto admin gana sobre el promedio", () => {
    const setting = normalizeDryReferential({ amount: 1500, windowMonths: 12 });
    expect(setting.windowMonths).toBe(12);
    expect(effectiveDryReferential(setting, 1110.19)).toBe(1500);
    expect(effectiveDryReferential(normalizeDryReferential({}), 1110.19)).toBe(1110.19);
  });
});
