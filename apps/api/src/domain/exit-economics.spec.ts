import { exitOriginLabel, judgeExitDeal, saleMargin } from "./exit-economics";

describe("exit economics", () => {
  it("nombra la OC o el ajuste", () => {
    expect(exitOriginLabel({ odooIntakeKind: "purchase", odooPoName: "OC-0010010493" })).toBe("OC-0010010493");
    expect(exitOriginLabel({ odooIntakeKind: "adjustment", costSource: "referential" })).toBe("Ajuste");
    expect(exitOriginLabel({ odooIntakeKind: "fabrication" })).toBe("Fabricación");
  });

  it("compara la venta con el rango calculado cuando el precio no se fijó a mano", () => {
    const below = judgeExitDeal({ priceSource: "rule", soldNet: 800, kind: "venta", ruleMin: 860, ruleList: 888, inventoryList: 888 });
    expect(below.verdict).toBe("debajo");
    expect(below.comparedTo).toBe("regla");
    expect(saleMargin(800, 799, "venta")).toBe(1);
    const inside = judgeExitDeal({ priceSource: "rule", soldNet: 870, kind: "venta", ruleMin: 860, ruleList: 888, inventoryList: null });
    expect(inside.verdict).toBe("en_rango");
  });

  it("si el inventario fijó el precio, compara contra ese precio y no contra la regla", () => {
    const row = judgeExitDeal({ priceSource: "manual", soldNet: 900, kind: "venta", ruleMin: 860, ruleList: 888, inventoryList: 950 });
    expect(row.verdict).toBe("bajo_inventario");
    expect(row.comparedTo).toBe("inventario");
  });

  it("el alquiler informa el ingreso del contrato y no resta el costo del equipo", () => {
    const row = judgeExitDeal({ priceSource: "rule", soldNet: 2400, kind: "alquiler", ruleMin: 860, ruleList: 888, inventoryList: null });
    expect(row.verdict).toBe("alquiler");
    expect(saleMargin(2400, 799, "alquiler")).toBe(2400);
  });

  it("una salida sin cotización no inventa ganancia", () => {
    const row = judgeExitDeal({ priceSource: "rule", soldNet: null, kind: null, ruleMin: 860, ruleList: 888, inventoryList: 888 });
    expect(row.verdict).toBe("sin_cotizacion");
    expect(saleMargin(null, 799, null)).toBeNull();
  });
});