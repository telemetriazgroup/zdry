import { completeIso } from "./iso6346";
import { assertPriceFloor, computeListPrices, DEFAULT_PRICING_RULES } from "./pricing";
import { applyShowPrice, DEFAULT_VISIBILITY_RULES } from "./visibility";
import { freightConsolidatedEstimate, trucksNeededFor } from "./freight-stub";
import { canAssignProduct, canTransition, holdClockPaused } from "../deal-close/deal-close.types";

describe("pricing jerárquico y piso de lista", () => {
  it("CIMC gana sobre global", () => {
    const p = computeListPrices({ iso: "X", type: "40HC", cat: "CW", manufacturer: "CIMC", fobCif: 2500 }, DEFAULT_PRICING_RULES);
    expect(p.marginPct).toBe(20);
    expect(p.priceList).toBe(Math.round(2500 / 0.8));
    expect(p.priceMin).toBe(Math.round(p.priceList * 0.92));
  });

  it("regla 19: debajo del piso 422 salvo override gerente", () => {
    expect(assertPriceFloor(100, 200, false).ok).toBe(false);
    expect(assertPriceFloor(100, 200, true).ok).toBe(true);
    expect(assertPriceFloor(200, 200, false).ok).toBe(true);
  });
});

describe("visibilidad de catálogo", () => {
  it("global oculto + fabricante CIMC visible", () => {
    const cimc = applyShowPrice({ iso: "A", type: "40HC", cat: "CW", manufacturer: "CIMC" }, DEFAULT_VISIBILITY_RULES);
    const other = applyShowPrice({ iso: "B", type: "40HC", cat: "CW", manufacturer: "Singamas" }, DEFAULT_VISIBILITY_RULES);
    expect(cimc).toBe(true);
    expect(other).toBe(false);
  });
});

describe("flete stub", () => {
  it("Cusco (sierra) es más caro y lento que Ica (costa) a 300 km de Ica vs 1100 de Cusco", () => {
    const units = [{ type: "40HC" }];
    const ica = freightConsolidatedEstimate(units, "fz20")!;
    const cusco = freightConsolidatedEstimate(units, "fz17")!;
    expect(cusco.cost).toBeGreaterThan(ica.cost);
    expect(cusco.days).toBeGreaterThanOrEqual(ica.days);
    expect(trucksNeededFor([{ type: "20GP" }, { type: "20GP" }])).toBe(1);
    expect(trucksNeededFor([{ type: "40HC" }, { type: "20GP" }])).toBe(2);
  });
});

describe("máquina de cierre", () => {
  it("no se asigna sin pago validado", () => {
    expect(canAssignProduct("reservada")).toBe(false);
    expect(canAssignProduct("en_verificacion")).toBe(false);
    expect(canAssignProduct("pago_validado")).toBe(true);
    expect(canTransition("pago_validado", "asignacion_confirmada")).toBe(true);
    expect(canTransition("reservada", "asignacion_confirmada")).toBe(false);
    expect(holdClockPaused("en_verificacion")).toBe(true);
    expect(holdClockPaused("reservada")).toBe(false);
  });
});

describe("iso helper still works", () => {
  it("completeIso", () => {
    expect(completeIso("ZDRU000040")).toHaveLength(11);
  });
});
