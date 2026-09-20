import { applyZdryLineCosts, buildMoOverhead, inferMoOverheadPlan, moCostBreakdown, moLineKey, penToUsd, pickComponentUnitCost } from "./odoo-mo-cost";
import { assimilateCostPlan } from "./odoo-origin";
import { resolveAcquisition } from "./pricing";

describe("pickComponentUnitCost", () => {
  it("prioriza OC, luego costo promedio (como el reporte Odoo), no price_unit 0", () => {
    expect(pickComponentUnitCost({ movePrice: 0, standardPrice: 17.4, valuationCost: 1.48 })).toEqual({
      unitCost: 17.4,
      origin: "standard",
    });
    expect(pickComponentUnitCost({ ocPrice: 1325, valuationCost: 8155, standardPrice: 8000 })).toMatchObject({
      unitCost: 1325,
      origin: "oc",
    });
    expect(pickComponentUnitCost({ movePrice: 0, standardPrice: 0 })).toEqual({ unitCost: null, origin: "missing" });
    expect(pickComponentUnitCost({ zdryPrice: 12.5, standardPrice: 0 })).toEqual({ unitCost: 12.5, origin: "zdry" });
  });

  it("applyZdryLineCosts solo rellena los sin costo Odoo", () => {
    expect(moLineKey("[INDND2467] TOMA EMPOTRABLE")).toBe("INDND2467");
    const out = applyZdryLineCosts(
      [
        { name: "[INDND2467] TOMA", qty: 1, unitCost: null, costOrigin: "missing" },
        { name: "[CDD40H0058] DRY", qty: 1, unitCost: 2421, costOrigin: "standard" },
      ],
      { INDND2467: 8.4 },
    );
    expect(out[0]).toMatchObject({ unitCost: 8.4, costOrigin: "zdry" });
    expect(out[1].costOrigin).toBe("standard");
    const b = moCostBreakdown({ components: out, finishedQty: 1 });
    expect(b.missingCount).toBe(0);
    expect(b.total).toBe(2429.4);
    expect(b.complete).toBe(true);
  });
});

describe("overhead referencial", () => {
  it("9 días Odoo: admin 9×20=180; ZDRY 4 días recalcula", () => {
    const odoo = inferMoOverheadPlan({
      diasTrabajados: 9,
      costoAgua: 36,
      costoHerramientas: 180,
      costoGastosAdmin: 180,
      costoMaquinaria: 60,
    });
    expect(odoo.days).toBe(9);
    expect(odoo.daysSource).toBe("odoo");
    expect(odoo.adminPerDay).toBe(20);
    const lines = buildMoOverhead(odoo);
    expect(lines.find((l) => l.name.startsWith("Gastos administrativos"))?.amountUsd).toBe(180);
    const zdry = inferMoOverheadPlan(
      { diasTrabajados: 9, costoAgua: 36, costoHerramientas: 180, costoGastosAdmin: 180, costoMaquinaria: 60 },
      { days: 4, daysSource: "zdry" },
    );
    expect(zdry.days).toBe(4);
    expect(buildMoOverhead(zdry).find((l) => l.name.startsWith("Gastos administrativos"))?.amountUsd).toBe(80);
    expect(buildMoOverhead(zdry).find((l) => l.name.startsWith("Movimiento"))?.amountUsd).toBe(60);
  });
});

describe("penToUsd", () => {
  it("convierte costo promedio PEN con rate Odoo", () => {
    expect(penToUsd(8155.16, 0.29691211401425177)).toBeCloseTo(2421.37, 0);
  });
});

describe("moCostBreakdown", () => {
  it("precursor 900 + 2×50 = 1000; qty terminada 1 → unit 1000", () => {
    const b = moCostBreakdown({
      precursorCost: 900,
      components: [
        { name: "Soldadura", qty: 2, unitCost: 50 },
      ],
      finishedQty: 1,
    });
    expect(b.total).toBe(1000);
    expect(b.unitCost).toBe(1000);
    expect(b.complete).toBe(true);
    expect(b.components[0].lineCost).toBe(100);
  });

  it("suma extras USD y deja incompleto si falta un insumo", () => {
    const b = moCostBreakdown({
      components: [
        { name: "DRY origen", qty: 1, unitCost: 2421, costOrigin: "standard", role: "precursor" },
        { name: "Toma", qty: 1, unitCost: null, costOrigin: "missing" },
      ],
      overhead: [{ name: "Agua", amountUsd: 36 }],
      finishedQty: 1,
    });
    expect(b.precursorCost).toBe(2421);
    expect(b.overheadTotal).toBe(36);
    expect(b.total).toBe(2457);
    expect(b.complete).toBe(false);
    expect(b.missingCount).toBe(1);
  });

  it("sin precios → complete=false, total 0, no se finge el referencial", () => {
    const b = moCostBreakdown({
      precursorCost: null,
      components: [
        { name: "Pintura", qty: 4, unitCost: null },
        { name: "Perfil", qty: 2, unitCost: 0 },
      ],
    });
    expect(b.total).toBe(0);
    expect(b.unitCost).toBe(0);
    expect(b.complete).toBe(false);
  });
});

describe("resolveAcquisition + MO", () => {
  it("fobCif de MO gana al promedio / referencial", () => {
    expect(
      resolveAcquisition(
        { iso: "LATU9011171", type: "40HC", cat: "ASIS", fobCif: 1000, costSource: "mo", dryReferential: 1224.69 },
        [{ type: "40HC", cat: null, amount: 4200 }],
      ),
    ).toMatchObject({ amount: 1000, kind: "fobCif" });
  });

  it("assimilateCostPlan usa moUnitCost si total>0", () => {
    const p = assimilateCostPlan({ odooIntakeKind: "fabrication", moUnitCost: 1000 });
    expect(p.fobCif).toBe(1000);
    expect(p.costSource).toBe("mo");
    expect(p.intakeType).toBe("fabricacion_odoo");
    expect(assimilateCostPlan({ odooIntakeKind: "fabrication" }).fobCif).toBe(0);
  });
});
