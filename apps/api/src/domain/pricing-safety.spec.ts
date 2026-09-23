import { computeListPrices, DEFAULT_PRICING_RULES, describeOffer, normalizeSafetyMarginRules } from "./pricing";
import { DEFAULT_VISIBILITY_RULES } from "./visibility";

const unit = { iso: "X", type: "40HC", cat: "ASIS", fobCif: 1000 };
const global20 = { type: null, cat: null, supplier: null, origin: null, warehouse: null, marginPct: 20 };

describe("margen de seguridad", () => {
  it("suma el porcentaje al costo: 1000 + 20% = 1200", () => {
    const p = computeListPrices(unit, [{ scope: "global", marginPct: 22, maxDiscountPct: 10 }], null, null, [
      global20,
    ]);
    expect(p.safetyPct).toBe(20);
    expect(p.safetyAdd).toBe(200);
    expect(p.securedBase).toBe(1200);
    expect(p.priceList).toBe(Math.round(1200 / (1 - 0.22)));
    expect(p.priceMin).toBe(Math.round(p.priceList * 0.9));
  });

  it("el grupo con más criterios reemplaza al global", () => {
    const rules = normalizeSafetyMarginRules([
      { scope: "global", marginPct: 20 },
      { scope: "category", target: "ASIS", marginPct: 5 },
      { type: "40HC", cat: "ASIS", supplier: "MAERSK", marginPct: 8 },
      { type: "40HC", cat: "ASIS", supplier: "MAERSK", origin: "CHINA", warehouse: "PIURA", marginPct: 12 },
      { scope: "category", target: "1TRIP", marginPct: 50 },
    ]);
    const asis = computeListPrices(unit, DEFAULT_PRICING_RULES, null, null, rules);
    expect(asis.safetyPct).toBe(5);
    expect(asis.securedBase).toBe(1050);

    const nested = computeListPrices(
      { ...unit, odooVendorName: "Maersk", originCountry: "China", odooWarehouse: "PIURA" },
      DEFAULT_PRICING_RULES,
      null,
      null,
      rules,
    );
    expect(nested.safetyPct).toBe(12);
    expect(nested.securedBase).toBe(1120);
    expect(nested.safetyLines).toHaveLength(1);
    expect(nested.marginPct).toBe(35);
    expect(nested.priceList).toBe(Math.round(1120 / 0.65));

    const other = computeListPrices({ ...unit, cat: "CW" }, DEFAULT_PRICING_RULES, null, null, rules);
    expect(other.safetyPct).toBe(20);
  });

  it("sin reglas el costo base es el costo y el precio no cambia", () => {
    const p = computeListPrices(
      { iso: "X", type: "40HC", cat: "CW", manufacturer: "CIMC", fobCif: 2500 },
      DEFAULT_PRICING_RULES,
    );
    expect(p.safetyPct).toBe(0);
    expect(p.securedBase).toBe(2500);
    expect(p.priceList).toBe(Math.round(2500 / 0.8));
  });

  it("la ficha explica costo base, regla y piso", () => {
    const d = describeOffer(unit, DEFAULT_PRICING_RULES, DEFAULT_VISIBILITY_RULES, {
      priceList: null,
      priceMin: null,
      priceSource: "rule",
    }, null, null, [global20]);
    expect(d.detail).toMatch(/costo base/);
    expect(d.detail).toMatch(/35%/);
    expect(d.detail).toMatch(/sin gerencia/);
    expect(d.securedBase).toBe(1200);
    expect(d.priceList).toBe(d.suggestedList);
  });

  it("un precio de regla viejo no pisa el cálculo; uno manual sí", () => {
    const stale = describeOffer(unit, DEFAULT_PRICING_RULES, DEFAULT_VISIBILITY_RULES, {
      priceList: 462,
      priceMin: 393,
      priceSource: "rule",
    }, null, null, [global20]);
    expect(stale.outdated).toBe(true);
    expect(stale.storedList).toBe(462);
    expect(stale.priceList).toBe(stale.suggestedList);
    expect(stale.priceList).not.toBe(462);

    const manual = describeOffer(unit, DEFAULT_PRICING_RULES, DEFAULT_VISIBILITY_RULES, {
      priceList: 500,
      priceMin: 400,
      priceSource: "manual",
    });
    expect(manual.outdated).toBe(false);
    expect(manual.priceList).toBe(500);
  });
});
