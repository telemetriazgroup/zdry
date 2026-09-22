import {
  averageOcUnitPrices,
  buildReferentialBuckets,
  effectiveDryReferential,
  lookupDryReferential,
  normalizeDryReferential,
  pricesFromOriginRows,
  referentialUsage,
} from "./dry-referential";

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

  it("agrupa nuevo vs segundo uso y no mezcla 20 con 40", () => {
    expect(referentialUsage("1TRIP")).toBe("nuevo");
    expect(referentialUsage("CW")).toBe("segundo_uso");
    const buckets = buildReferentialBuckets([
      { type: "40HC", cat: "CW", warehouse: "ZGROU", productCode: "CDD40H0004", odooUnitPrice: 1325, costSource: "oc", odooIntakeKind: "purchase" },
      { type: "40HC", cat: "CW", warehouse: "ZGROU", productCode: "CDD40H0004", odooUnitPrice: 1325, costSource: "oc", odooIntakeKind: "purchase" },
      { type: "20GP", cat: "CW", warehouse: "PIURA", productCode: "CDD20F0003", odooUnitPrice: 900, costSource: "oc", odooIntakeKind: "purchase" },
      { type: "20GP", cat: "1TRIP", warehouse: "ZGROU", productCode: "CDE0031", odooUnitPrice: 2100, costSource: "oc", odooIntakeKind: "purchase" },
      { type: "40HC", cat: "ASIS", warehouse: "ZGROU", odooUnitPrice: 9999, costSource: "referential", odooIntakeKind: "adjustment" },
    ]);
    const adj40 = lookupDryReferential({ type: "40HC", cat: "ASIS", odooWarehouse: "ZGROU", productCode: "CDD40H0004" }, buckets, 1288.55);
    expect(adj40).toMatchObject({ source: "sku", amount: 1325 });
    const piura20 = lookupDryReferential({ type: "20GP", cat: "CW", odooWarehouse: "PIURA" }, buckets, 1288.55);
    expect(piura20).toMatchObject({ source: "typeUsageWh", amount: 900 });
    const nuevo = lookupDryReferential({ type: "20GP", cat: "1TRIP", odooWarehouse: "ZGROU" }, buckets, 1288.55);
    expect(nuevo).toMatchObject({ amount: 2100 });
    const nuevoOtraPlaza = lookupDryReferential({ type: "20GP", cat: "1TRIP", odooWarehouse: "PIURA" }, buckets, 1288.55);
    expect(nuevoOtraPlaza).toMatchObject({ source: "typeUsage", amount: 2100 });
    const sinOc = lookupDryReferential({ type: "45HC", cat: "CW", odooWarehouse: "ZGROU" }, buckets, 1288.55);
    expect(sinOc).toMatchObject({ source: "global", amount: 1288.55 });
  });

  it("la ventana descarta OC viejas de la cubeta", () => {
    const now = new Date("2026-09-22");
    const buckets = buildReferentialBuckets(
      [
        { type: "40HC", cat: "CW", warehouse: "ZGROU", odooUnitPrice: 1325, costSource: "oc", odooIntakeKind: "purchase", at: "2026-08-01" },
        { type: "40HC", cat: "CW", warehouse: "ZGROU", odooUnitPrice: 800, costSource: "oc", odooIntakeKind: "purchase", at: "2023-01-01" },
      ],
      24,
      now,
    );
    const hit = lookupDryReferential({ type: "40HC", cat: "CW", odooWarehouse: "ZGROU" }, buckets, 1000);
    expect(hit).toMatchObject({ amount: 1325, sample: 1 });
  });
});
