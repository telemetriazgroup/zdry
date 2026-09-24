import { assertConfirmMatch, catalogPublishBlock, isPendingValuation, proposeMatch, reconcileContainerPatch } from "./odoo-reconcile";

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
    expect(catalogPublishBlock({ odooPoId: null, invoicePending: true, intakeType: "pendiente_factura", status: "Disponible" })).toMatch(/no se publica/);
    expect(catalogPublishBlock({ odooPoId: 12, invoicePending: true, intakeType: "compra" })).toBeNull();
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
