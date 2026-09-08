import { applyShowPrice, DEFAULT_VISIBILITY_RULES } from "./visibility";
import {
  DEFAULT_PRICING_RULES,
  describeOffer,
  grossOf,
  igvOf,
  netFromGross,
  overrideFromVisibilityMode,
  parseMoneyAmount,
  resolveAcquisition,
  visibilityModeOf,
} from "./pricing";

describe("oferta neta / IGV", () => {
  it("redondea IGV 18% y vuelve al neto", () => {
    expect(igvOf(3500)).toBe(630);
    expect(grossOf(3500)).toBe(4130);
    expect(netFromGross(4130)).toBe(3500);
  });

  it("parsea montos y rechaza cero", () => {
    expect(parseMoneyAmount("3500.2")).toBe(3500.2);
    expect(parseMoneyAmount("0")).toBeNull();
    expect(parseMoneyAmount("abc")).toBeNull();
  });
});

describe("origen y visibilidad de oferta", () => {
  const unit = { iso: "HHXU3466119", type: "20GP", cat: "1TRIP", manufacturer: "CIMC", fobCif: 2800, depotId: "d1" };

  it("explica el cálculo por regla y FOB", () => {
    const d = describeOffer(unit, DEFAULT_PRICING_RULES, DEFAULT_VISIBILITY_RULES, {
      priceList: 3256,
      priceMin: 3093,
      priceSource: "rule",
    });
    expect(d.source).toBe("rule");
    expect(d.baseKind).toBe("fobCif");
    expect(d.title).toMatch(/calculado/i);
    expect(d.detail).toMatch(/FOB\/CIF/);
    expect(d.showPrice).toBe(true);
    expect(d.visibility).toBe("inherit");
  });

  it("oferta manual conserva el neto y anota quién lo fijó", () => {
    const d = describeOffer(unit, DEFAULT_PRICING_RULES, DEFAULT_VISIBILITY_RULES, {
      priceList: 4000,
      priceMin: 3800,
      priceSource: "manual",
      adjustedByName: "Ana Admin",
    });
    expect(d.source).toBe("manual");
    expect(d.priceList).toBe(4000);
    expect(d.gross).toBe(grossOf(4000));
    expect(d.title).toMatch(/Ana Admin/);
    expect(d.suggestedList).toBeGreaterThan(0);
  });

  it("referencia por tipo+condición gana sobre el tipo", () => {
    const refs = [
      { type: "20FR", cat: null, amount: 2800 },
      { type: "20FR", cat: "1TRIP", amount: 2500 },
    ];
    expect(resolveAcquisition({ iso: "A", type: "20FR", cat: "1TRIP" }, refs)).toMatchObject({ amount: 2500, kind: "refTypeCat" });
    expect(resolveAcquisition({ iso: "B", type: "20FR", cat: "CW" }, refs)).toMatchObject({ amount: 2800, kind: "refType" });
  });

  it("ocultar precio manda a solicitar", () => {
    expect(visibilityModeOf(false)).toBe("request");
    expect(overrideFromVisibilityMode("request")).toBe(false);
    expect(applyShowPrice({ ...unit, priceVisibilityOverride: false }, DEFAULT_VISIBILITY_RULES)).toBe(false);
  });
});
