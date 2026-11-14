import { assertConfirmMatch, catalogHoldPatch, catalogPublishBlock, isPendingValuation, pendingValuationWhere, pickReconcileCandidate, planOdooRelink, proposeMatch, publishedStockWhere, reconcileContainerPatch, recoverPrepublished } from "./odoo-reconcile";

const BMOU = { iso: "BMOU433548-9" };
const IN_06302 = {
  lotIsos: ["BMOU433548-9", "CAIU807254-0"],
  lineTexts: ["DRY 40HC"],
  pickingState: "done",
};

describe("proposeMatch", () => {
  it("auto-enlaza solo si el ISO del IN coincide", () => {
    expect(proposeMatch(BMOU, IN_06302)).toMatchObject({ mode: "auto", reason: "iso", isoNormalized: "BMOU4335489" });
  });

  it("el serial solo en el texto de la línea OC es propuesta, no auto", () => {
    expect(
      proposeMatch(BMOU, {
        lotIsos: ["CAIU807254-0"],
        lineTexts: ["Contenedor BMOU433548-9 según packing"],
        pickingState: "done",
      }),
    ).toMatchObject({ mode: "proposal", reason: "line_text", isoNormalized: "BMOU4335489" });
  });

  it("IN en borrador no concilia", () => {
    expect(proposeMatch(BMOU, { ...IN_06302, pickingState: "assigned", pickingName: "ZGROU/IN/07700" } as typeof IN_06302)).toMatchObject({
      mode: "none",
      reason: "draft",
    });
    expect(proposeMatch(BMOU, { lotIsos: ["BMOU433548-9"], pickingState: "draft" })).toMatchObject({
      mode: "none",
      reason: "draft",
    });
  });

  it("IN parcial: otra serie del mismo OC no auto-linkeá esta reentrega", () => {
    expect(proposeMatch(BMOU, { lotIsos: ["CAIU807254-0"], pickingState: "done" })).toMatchObject({
      mode: "none",
      reason: "no_overlap",
    });
  });
});

describe("assertConfirmMatch", () => {
  it("segundo match del mismo ISO → 409", () => {
    expect(assertConfirmMatch({ alreadyPoId: 9707, pickingState: "done" })).toEqual({
      ok: false,
      status: 409,
      message: "Esta serie ya está conciliada.",
    });
  });

  it("IN borrador → 400", () => {
    expect(assertConfirmMatch({ alreadyPoId: null, pickingState: "draft" }).ok).toBe(false);
  });
});

describe("isPendingValuation", () => {
  it("reentrega sin OC espera valor y proveedor", () => {
    expect(isPendingValuation({ odooPoId: null, invoicePending: true, intakeType: "pendiente_factura", status: "Disponible" })).toBe(true);
    expect(isPendingValuation({ odooPoId: 12, invoicePending: true, intakeType: "pendiente_factura" })).toBe(false);
    expect(isPendingValuation({ odooPoId: null, invoicePending: true, intakeType: "ajuste_odoo" })).toBe(false);
    expect(isPendingValuation({ odooPoId: null, invoicePending: false, intakeType: "compra" })).toBe(false);
    expect(catalogPublishBlock({ odooPoId: null, invoicePending: true, intakeType: "pendiente_factura", status: "Disponible", lado: "Zona A", ruma: 1, columna: 1, nivel: 1 })).toMatch(/no se publica/);
    expect(publishedStockWhere().NOT).toEqual([pendingValuationWhere(), { lado: "PASILLO" }]);
    expect(publishedStockWhere().mediaStatus).toBe("aprobado");
    expect(catalogPublishBlock({ odooPoId: 12, invoicePending: true, intakeType: "compra", lado: "Zona A", ruma: 1, columna: 1, nivel: 1 })).toBeNull();
    expect(catalogPublishBlock({ odooPoId: 12, invoicePending: true, intakeType: "compra", lado: "Zona A", ruma: 1, columna: 1, nivel: 1, status: "Disponible" })).toBeNull();
    expect(catalogPublishBlock({ odooPoId: 12, intakeType: "compra", status: "Disponible" })).toMatch(/ubicación/);
    expect(catalogPublishBlock({ odooPoId: 12, intakeType: "compra", status: "Disponible", lado: "PASILLO", ruma: 1, columna: 1, nivel: 1 })).toMatch(/ubicación/);
    expect(catalogPublishBlock({ status: "Vendido", odooPoId: 12, intakeType: "compra" })).toMatch(/salida/);
    expect(catalogPublishBlock({ status: "Disponible", gateOut: true, odooPoId: 12, intakeType: "compra" })).toMatch(/salida/);
  });
});

describe("catalogHoldPatch", () => {
  const placed = { lado: "Zona A", ruma: 1, columna: 2, nivel: 1, status: "Disponible" };

  it("publicado con fotos y sin puesto queda prepublicado", () => {
    expect(catalogHoldPatch({ mediaStatus: "aprobado", photoCount: 2, status: "Disponible" })).toMatchObject({
      mediaStatus: "prepublicado",
      clearApproval: false,
    });
    expect(catalogHoldPatch({ mediaStatus: "aprobado", photoCount: 1, status: "Disponible", lado: "PASILLO", ruma: 1, columna: 1, nivel: 1 })?.mediaStatus).toBe("prepublicado");
  });

  it("publicado sin fotos y sin puesto se oculta", () => {
    expect(catalogHoldPatch({ mediaStatus: "aprobado", photoCount: 0, status: "Disponible" })).toMatchObject({
      mediaStatus: "oculto",
      clearApproval: true,
    });
  });

  it("prepublicado con puesto y fotos vuelve a publicado", () => {
    expect(catalogHoldPatch({ mediaStatus: "prepublicado", photoCount: 3, ...placed })).toMatchObject({
      mediaStatus: "aprobado",
      clearApproval: false,
    });
  });

  it("nunca publicado no cambia al definir o no la ubicación", () => {
    expect(catalogHoldPatch({ mediaStatus: "pendiente", photoCount: 2, status: "Disponible" })).toBeNull();
    expect(catalogHoldPatch({ mediaStatus: "pendiente", photoCount: 2, ...placed })).toBeNull();
    expect(catalogHoldPatch({ mediaStatus: "oculto", photoCount: 2, ...placed })).toBeNull();
  });

  it("la venta no se republica desde este paso", () => {
    expect(catalogHoldPatch({ mediaStatus: "prepublicado", photoCount: 2, ...placed, status: "Vendido" })).toBeNull();
  });

  it("recupera el publicado que se ocultó solo por falta de ubicación", () => {
    expect(recoverPrepublished([
      "Ficha publicada en el catálogo por Ana.",
      "Se quitó del catálogo. No se puede publicar porque falta definir ubicación.",
    ])).toBe(true);
    expect(recoverPrepublished([
      "Ficha publicada en el catálogo por Ana.",
      "Ficha oculta del catálogo por Ana.",
    ])).toBe(false);
    expect(recoverPrepublished(["Se quitó del catálogo. No se puede publicar porque falta definir ubicación."])).toBe(false);
  });
});

describe("pickReconcileCandidate", () => {
  const sameIn = [
    {
      id: "dryu",
      odooLotId: 2608,
      isoNormalized: "DRYU9437735",
      serialRaw: "DRYU9437735-5",
      odooPickingName: "ZGROU/IN/07700",
      odooPoId: 100,
    },
    {
      id: "fscu",
      odooLotId: 2610,
      isoNormalized: "FSCU6139800",
      serialRaw: "FSCU6139800-0",
      odooPickingName: "ZGROU/IN/07700",
      odooPoId: 100,
    },
  ];

  it("el mismo IN no liga la segunda serie al lote de la primera", () => {
    const picked = pickReconcileCandidate("FSCU6139800", sameIn, {
      candidateId: "dryu",
      rightId: "ZGROU/IN/07700",
    });
    expect(picked?.odooLotId).toBe(2610);
    expect(picked?.id).toBe("fscu");
  });

  it("la primera serie del IN conserva su propio lote", () => {
    const picked = pickReconcileCandidate("DRYU9437735", sameIn, {
      candidateId: "dryu",
      rightId: "ZGROU/IN/07700",
    });
    expect(picked?.odooLotId).toBe(2608);
  });

  it("un IN que no trae la serie no devuelve el lote de otro equipo", () => {
    expect(
      pickReconcileCandidate("FSCU6139800", sameIn, { rightId: "ZGROU/IN/09999" }),
    ).toBeNull();
  });
});

describe("planOdooRelink", () => {
  const candidates = [
    { id: "dryu", odooLotId: 2608, isoNormalized: "DRYU9437735", serialRaw: "DRYU9437735-5", containerIso: "FSCU6139800" },
    { id: "fscu", odooLotId: 2610, isoNormalized: "FSCU6139800", serialRaw: "FSCU6139800-0", containerIso: null },
  ];
  const containers = [
    { iso: "FSCU6139800", odooLotId: 2608 },
    { iso: "DRYU9437735", odooLotId: 2608 },
  ];

  it("enlaza la serie a su lote y devuelve el otro candidato sin mover su equipo", () => {
    expect(planOdooRelink({ iso: "FSCU6139800", candidates, containers })).toEqual({
      ok: true,
      candidateId: "fscu",
      odooLotId: 2610,
      restore: [{ candidateId: "dryu", containerIso: "DRYU9437735" }],
    });
  });

  it("si hay dos lotes de la misma serie, liga el que Odoo todavía tiene en stock", () => {
    const duplicated = [
      { id: "viejo", odooLotId: 100, isoNormalized: "CBHU414989", serialRaw: "CBHU414989", containerIso: "CBHU414989", qtyOnHand: 0 },
      { id: "vivo", odooLotId: 200, isoNormalized: "CBHU414989", serialRaw: "CBHU414989", containerIso: "CBHU414989", qtyOnHand: 1 },
    ];
    expect(planOdooRelink({ iso: "CBHU414989", candidates: duplicated, containers: [{ iso: "CBHU414989", odooLotId: 100 }] })).toMatchObject({
      ok: true,
      candidateId: "vivo",
      odooLotId: 200,
    });
  });

  it("sin lote de esa serie no crea uno ni propone otro equipo", () => {
    expect(planOdooRelink({ iso: "MSKU0225553", candidates, containers })).toMatchObject({ ok: false });
  });
});

describe("reconcileContainerPatch", () => {
  it("pasa a compra OC y deja de usar referencial", () => {
    expect(
      reconcileContainerPatch({
        odooPoId: 9707,
        odooPoName: "OC-0010009472",
        odooPickingName: "ZGROU/IN/06302",
        odooUnitPrice: 1325,
      }),
    ).toMatchObject({
      odooPoId: 9707,
      odooPickingName: "ZGROU/IN/06302",
      fobCif: 1325,
      intakeType: "compra",
      costSource: "oc",
    });
  });
});
