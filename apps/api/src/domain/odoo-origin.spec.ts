import {
  assimilateCostPlan,
  classifyLotOrigin,
  dossierKindForMove,
  isDryContainerProduct,
  availabilityAfterStock,
  statusWhenLotsConflict,
  catalogAfterDispatch,
  lotAvailability,
  serialSearchForms,
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

describe("lotAvailability", () => {
  const msku: LotMoveFact[] = [
    {
      state: "done",
      pickingState: "done",
      pickingCode: "incoming",
      pickingName: "ZGROU/IN/07808",
      srcUsage: "supplier",
      destUsage: "internal",
      date: "2026-09-24 11:20:57",
    },
    {
      state: "done",
      pickingState: "done",
      pickingCode: "outgoing",
      pickingName: "ZGROU/OUT/08515",
      origin: "10020263940",
      srcUsage: "internal",
      destUsage: "customer",
      destName: "FLOWEN S.A.C.",
      date: "2026-09-24 11:32:49",
    },
    {
      state: "done",
      pickingState: "done",
      pickingName: "ZGROU/RO/01560",
      srcUsage: "internal",
      destUsage: "internal",
      date: "2026-09-24 16:23:13",
    },
  ];

  it("una OUT hecha a cliente cierra la serie aunque haya una reparación posterior", () => {
    expect(dossierKindForMove(msku[1])).toBe("picking_out");
    expect(dossierKindForMove(msku[2])).toBe("repair");
    expect(lotAvailability(msku)).toMatchObject({ availability: "left", pickingName: "ZGROU/OUT/08515" });
  });

  it("una OUT asignada reserva y no da por vendido", () => {
    expect(lotAvailability(aphuMoves).availability).toBe("reserved");
  });

  it("una entrada posterior a existencias lo deja a la mano aunque el despacho viejo no tenga cliente", () => {
    const jxlu: LotMoveFact[] = [
      { state: "done", pickingState: "done", pickingCode: "incoming", pickingName: "ZGROU/IN/04674", srcUsage: "supplier", destUsage: "internal", destName: "ZGROU/Existencias", date: "2026-05-16 17:55:15" },
      { state: "done", pickingState: "done", pickingCode: "outgoing", pickingName: "ZGROU/OUT/04471", srcUsage: "internal", srcName: "ZGROU/Existencias", destUsage: "customer", date: "2026-05-16 17:57:48" },
      { state: "done", pickingState: "done", pickingCode: "incoming", pickingName: "ZGROU/IN/04691", destUsage: "internal", destName: "ZGROU/Existencias", date: "2026-05-16 18:27:07" },
      { state: "done", pickingState: "done", pickingCode: "outgoing", pickingName: "ZGROU/OUT/04476", srcUsage: "internal", srcName: "ZGROU/Existencias", destName: "", date: "2026-05-16 18:29:46" },
      { state: "done", pickingState: "done", pickingCode: "incoming", pickingName: "ZGROU/IN/07534", destName: "ZGROU/Existencias", date: "2026-09-14 09:56:37" },
      { state: "done", pickingState: "done", pickingCode: "internal", pickingName: "ZGROU/INT/00157", srcUsage: "internal", srcName: "ZGROU/Existencias", destUsage: "internal", destName: "Piura/Existencias", date: "2026-09-14 10:00:52" },
    ];
    expect(lotAvailability(jxlu)).toMatchObject({ availability: "stock" });
    expect(availabilityAfterStock(jxlu, 1).availability).toBe("stock");
  });

  it("un retorno posterior a existencias vuelve a stock", () => {
    const back: LotMoveFact = {
      state: "done",
      pickingState: "done",
      pickingCode: "incoming",
      pickingName: "ZGROU/IN/09999",
      srcUsage: "customer",
      destUsage: "internal",
      date: "2026-09-25 09:00:00",
    };
    expect(lotAvailability([...msku, back]).availability).toBe("stock");
  });

  it("sin existencia interna cierra la serie aunque el único movimiento sea el ajuste", () => {
    const adjustment = [msku[0]];
    expect(availabilityAfterStock(adjustment, 0)).toMatchObject({ availability: "left", pickingName: "sin existencia interna" });
    expect(availabilityAfterStock(adjustment, 1).availability).toBe("stock");
    expect(availabilityAfterStock(adjustment, null).availability).toBe("stock");
  });

  it("un lote viejo en cero no cierra la serie si otro lote de la misma serie sigue en stock", () => {
    const stale = { qty: 0, availability: "left" as const, pickingName: "sin existencia interna", destName: null };
    const decided = statusWhenLotsConflict(stale, [{ qty: 1 }]);
    expect(decided.keepExpediente).toBe(true);
    expect(decided.apply.availability).toBe("stock");
    expect(statusWhenLotsConflict(stale, [{ qty: 0 }])).toMatchObject({
      keepExpediente: false,
      apply: { availability: "left" },
    });
  });

  it("una OUT del lote que sigue con cantidad no la reabre el lote viejo", () => {
    const sold = { qty: 1, availability: "left" as const, pickingName: "ZGROU/OUT/08515", destName: "FLOWEN S.A.C." };
    expect(statusWhenLotsConflict(sold, [{ qty: 0 }]).apply).toMatchObject({
      availability: "left",
      pickingName: "ZGROU/OUT/08515",
    });
  });

  it("una OUT hecha sigue cerrando aunque el quant interno siga en 1", () => {
    expect(availabilityAfterStock(msku, 1)).toMatchObject({ availability: "left", pickingName: "ZGROU/OUT/08515" });
  });

  it("arma el serial con y sin guion para buscar la venta", () => {
    expect(serialSearchForms("CLVU1055646")).toEqual(["CLVU1055646", "CLVU105564-6"]);
  });

  it("si ya está en el catálogo, el despacho la deja en no publicar", () => {
    const patch = catalogAfterDispatch(
      { status: "Disponible", mediaStatus: "aprobado", gateOut: false },
      "left",
      "ZGROU/OUT/08515",
    );
    expect(patch).toMatchObject({ status: "Vendido", mediaStatus: "oculto", clearApproval: true, gateOut: true });
    expect(patch?.detail).toMatch(/no publicar/);
    expect(catalogAfterDispatch({ status: "Vendido", mediaStatus: "oculto", gateOut: true }, "left", "OUT")).toBeNull();
    expect(catalogAfterDispatch({ status: "Vendido", mediaStatus: "aprobado", gateOut: true }, "left", "OUT")?.mediaStatus).toBe("oculto");
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
