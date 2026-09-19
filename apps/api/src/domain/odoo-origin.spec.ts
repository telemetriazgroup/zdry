import {
  assimilateCostPlan,
  classifyLotOrigin,
  isDryContainerProduct,
  moNameFromText,
  originBadgeLabel,
  splitOdooProductLabel,
  type LotMoveFact,
} from "./odoo-origin";

const aphuMoves: LotMoveFact[] = [
  {
    state: "done",
    reference: "Ajuste Inventario Inicial al 31/05/2025",
    srcUsage: "inventory",
    srcName: "Virtual Locations/Inventory adjustment",
    destUsage: "internal",
    destName: "ZGROU/Existencias",
  },
  {
    state: "assigned",
    origin: "10020262121",
    reference: "ZGROU/OUT/04956",
    pickingCode: "outgoing",
    pickingState: "assigned",
    pickingName: "ZGROU/OUT/04956",
    srcUsage: "internal",
    destUsage: "customer",
  },
];

const bmouMoves: LotMoveFact[] = [
  {
    state: "done",
    origin: "OC-0010009472",
    reference: "ZGROU/IN/06302",
    pickingCode: "incoming",
    pickingState: "done",
    pickingName: "ZGROU/IN/06302",
    purchaseId: 9707,
    purchaseName: "OC-0010009472",
    purchaseLineId: 23011,
    srcUsage: "supplier",
    destUsage: "internal",
  },
  {
    state: "assigned",
    origin: "10020262925",
    reference: "ZGROU/OUT/07588",
    pickingCode: "outgoing",
    pickingState: "assigned",
    pickingName: "ZGROU/OUT/07588",
    srcUsage: "internal",
    destUsage: "customer",
  },
];

describe("classifyLotOrigin", () => {
  it("APHU: ajuste gana; ignora OUT asignado", () => {
    const r = classifyLotOrigin(aphuMoves);
    expect(r.odooIntakeKind).toBe("adjustment");
    expect(r.costSource).toBe("referential");
    expect(r.odooPickingName).toMatch(/Ajuste Inventario/i);
    expect(r.purchaseName).toBeNull();
  });

  it("BMOU: IN done + purchase_id → purchase", () => {
    const r = classifyLotOrigin(bmouMoves);
    expect(r.odooIntakeKind).toBe("purchase");
    expect(r.costSource).toBe("oc");
    expect(r.odooPickingName).toBe("ZGROU/IN/06302");
    expect(r.purchaseName).toBe("OC-0010009472");
  });

  it("sin moves → unknown", () => {
    expect(classifyLotOrigin([])).toEqual({
      odooIntakeKind: "unknown",
      odooPickingName: null,
      purchaseName: null,
      costSource: "none",
      odooMoName: null,
    });
  });

  it("IN de devolución de cliente sin OC no es purchase", () => {
    const r = classifyLotOrigin([
      {
        state: "done",
        reference: "Ajuste Inventario Inicial al 31/05/2025",
        srcUsage: "inventory",
        destUsage: "internal",
      },
      {
        state: "done",
        reference: "ZGROU/IN/04970",
        pickingCode: "incoming",
        pickingState: "done",
        pickingName: "ZGROU/IN/04970",
        srcUsage: "customer",
        destUsage: "internal",
      },
    ]);
    expect(r.odooIntakeKind).toBe("adjustment");
    expect(r.costSource).toBe("referential");
  });

  it("purchase gana si coexisten ajuste e IN con OC", () => {
    const r = classifyLotOrigin([...aphuMoves, ...bmouMoves]);
    expect(r.odooIntakeKind).toBe("purchase");
    expect(r.odooPickingName).toBe("ZGROU/IN/06302");
  });

  it("LATU terminado: Production → Existencias es fabricación, no ajuste", () => {
    const r = classifyLotOrigin([
      {
        state: "done",
        origin: "ZGROU/MO/00292",
        reference: "ZGROU/MO/00292",
        srcUsage: "production",
        srcName: "Physical Locations/Production",
        destUsage: "internal",
        destName: "ZGROU/Existencias",
      },
    ]);
    expect(r.odooIntakeKind).toBe("fabrication");
    expect(r.costSource).toBe("mo");
    expect(r.odooMoName).toBe("ZGROU/MO/00292");
    expect(r.odooPickingName).toBe("ZGROU/MO/00292");
  });

  it("precursor ajuste + MO del terminado: el terminado no se pinta como ajuste", () => {
    const r = classifyLotOrigin([
      {
        state: "done",
        reference: "Ajuste Inventario Inicial al 31/05/2025",
        srcUsage: "inventory",
        destUsage: "internal",
      },
      {
        state: "done",
        origin: "ZGROU/MO/00292",
        reference: "ZGROU/MO/00292",
        srcUsage: "production",
        destUsage: "internal",
      },
    ]);
    expect(r.odooIntakeKind).toBe("fabrication");
    expect(r.odooMoName).toBe("ZGROU/MO/00292");
  });

  it("IN+OC del SKU actual gana sobre fabricación", () => {
    const r = classifyLotOrigin([
      {
        state: "done",
        origin: "ZGROU/MO/00292",
        reference: "ZGROU/MO/00292",
        srcUsage: "production",
        destUsage: "internal",
      },
      ...bmouMoves,
    ]);
    expect(r.odooIntakeKind).toBe("purchase");
  });

  it("IN assigned con OC no clasifica hasta done", () => {
    const r = classifyLotOrigin([
      {
        state: "assigned",
        pickingCode: "incoming",
        pickingState: "assigned",
        pickingName: "ZGROU/IN/07700",
        purchaseName: "OC-0010009472",
        purchaseId: 9707,
        srcUsage: "supplier",
        destUsage: "internal",
      },
    ]);
    expect(r.odooIntakeKind).toBe("unknown");
  });

  it("precursor: ajuste + consumo a Production sigue siendo ajuste", () => {
    const r = classifyLotOrigin([
      {
        state: "done",
        reference: "Ajuste Inventario Inicial al 31/05/2025",
        srcUsage: "inventory",
        destUsage: "internal",
      },
      {
        state: "done",
        origin: "ZGROU/MO/00292",
        reference: "ZGROU/MO/00292",
        srcUsage: "internal",
        destUsage: "production",
      },
    ]);
    expect(r.odooIntakeKind).toBe("adjustment");
    expect(r.odooMoName).toBeNull();
  });
});

describe("assimilateCostPlan", () => {
  it("ajuste no inventa factura ni FOB", () => {
    const p = assimilateCostPlan({ odooIntakeKind: "adjustment", odooUnitPrice: 1325, odooPoName: "OC-X" });
    expect(p.intakeType).toBe("ajuste_odoo");
    expect(p.invoicePending).toBe(false);
    expect(p.fobCif).toBe(0);
    expect(p.costSource).toBe("referential");
  });

  it("compra con factura → fobCif y compra", () => {
    const p = assimilateCostPlan({
      odooIntakeKind: "purchase",
      odooUnitPrice: 1325,
      odooPoName: "OC-0010009472",
      odooBillName: "C 3303",
    });
    expect(p.intakeType).toBe("compra");
    expect(p.invoicePending).toBe(false);
    expect(p.fobCif).toBe(1325);
    expect(p.costSource).toBe("oc");
  });

  it("fabricación no inventa factura ni FOB; el precursor se documenta aparte", () => {
    const bare = assimilateCostPlan({ odooIntakeKind: "fabrication" });
    expect(bare.intakeType).toBe("fabricacion_odoo");
    expect(bare.invoicePending).toBe(false);
    expect(bare.fobCif).toBe(0);
    expect(bare.costSource).toBe("mo");
  });

  it("compra sin factura → pendiente_factura", () => {
    const p = assimilateCostPlan({ odooIntakeKind: "purchase", odooUnitPrice: 1900, odooPoName: "OC-1" });
    expect(p.intakeType).toBe("pendiente_factura");
    expect(p.invoicePending).toBe(true);
    expect(p.fobCif).toBe(1900);
  });
});

describe("isDryContainerProduct", () => {
  it("acepta contenedor DRY y rechaza flat pack", () => {
    expect(isDryContainerProduct("CONTENEDOR DRY 40 HC SEGUNDO USO", "CDD40H0004")).toBe(true);
    expect(isDryContainerProduct("MODULO FLAT PACK DRY 20 FT DE SEGUNDO USO", "MDN20F0001")).toBe(false);
  });
});

describe("moNameFromText / splitOdooProductLabel", () => {
  it("extrae MO y código de producto Odoo", () => {
    expect(moNameFromText("ZGROU/MO/00292")).toBe("ZGROU/MO/00292");
    expect(splitOdooProductLabel("[CDD40H0058] CONTENEDOR DRY 40 HC NUEVO")).toEqual({
      code: "CDD40H0058",
      name: "CONTENEDOR DRY 40 HC NUEVO",
    });
  });
});

describe("originBadgeLabel", () => {
  it("muestra OC, Ajuste o Sin origen", () => {
    expect(originBadgeLabel("purchase", "OC-0010009472", "ZGROU/IN/06302")).toBe("OC-0010009472");
    expect(originBadgeLabel("adjustment", null, "Ajuste")).toBe("Ajuste");
    expect(originBadgeLabel("unknown")).toBe("Sin origen");
    expect(originBadgeLabel("fabrication", null, "ZGROU/MO/00292")).toBe("ZGROU/MO/00292");
  });
});
