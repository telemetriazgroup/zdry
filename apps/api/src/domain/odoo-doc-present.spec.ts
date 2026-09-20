import { billAccess, presentOdooDocument } from "./odoo-doc-present";

const OC_DATA = {
  name: "OC-0010009472",
  partner: "ECONTAINERS",
  state: "purchase",
  currency: "USD",
  amountTotal: 27825,
  date: "2026-03-12",
  unitPrice: 1325,
  qtyReceived: 21,
  lines: [{ label: "CONTENEDOR DRY 40 HC", qty: "21", amount: "27825" }],
  pickings: [
    { name: "ZGROU/IN/06302", isos: ["BMOU4335489"] },
    { name: "ZGROU/IN/06435", isos: ["INKU1234560"] },
    { name: "ZGROU/IN/06460", isos: ["BMOU4349332", "CAIU1234567"] },
  ],
  isos: ["BMOU4335489", "INKU1234560", "BMOU4349332", "CAIU1234567"],
};

describe("presentOdooDocument", () => {
  it("OC rica se lee por filas, no por JSON crudo", () => {
    const v = presentOdooDocument({ kind: "purchase", name: "OC-0010009472", data: OC_DATA });
    expect(v.title).toBe("OC-0010009472");
    expect(v.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Proveedor", value: "ECONTAINERS" }),
        expect.objectContaining({ label: "Total", value: expect.stringContaining("27,825") }),
      ]),
    );
    expect(v.pickings).toHaveLength(3);
    expect(v.lines[0].label).toMatch(/DRY/);
    expect(JSON.stringify(v)).not.toMatch(/"source":"j1_backfill"/);
  });

  it("IN parcial: pickings[IN/06460].isos no incluye series de IN/06302", () => {
    const v = presentOdooDocument({ kind: "purchase", name: "OC-0010009472", data: OC_DATA });
    const a = v.pickings.find((p) => p.name === "ZGROU/IN/06460");
    const b = v.pickings.find((p) => p.name === "ZGROU/IN/06302");
    expect(a?.isos).toEqual(["BMOU4349332", "CAIU1234567"]);
    expect(a?.isos).not.toContain("BMOU4335489");
    expect(b?.isos).toEqual(["BMOU4335489"]);
  });

  it("bill sin líneas → pending / name_only", () => {
    expect(billAccess({})).toBe("pending");
    expect(billAccess({ name: "C 3303" })).toBe("name_only");
    expect(billAccess({ name: "C 3303", access: "pending" })).toBe("pending");
    const nameOnly = presentOdooDocument({ kind: "bill", name: "C 3303", data: { name: "C 3303", access: "name_only" } });
    expect(nameOnly.pending).toMatch(/C 3303/);
    expect(nameOnly.pending).toMatch(/pendiente/i);
    const pending = presentOdooDocument({ kind: "bill", data: { access: "pending" } });
    expect(pending.pending).toMatch(/sin acceso/i);
  });

  it("MO muestra totales, fuente y aviso si falta un costo", () => {
    const v = presentOdooDocument({
      kind: "mo",
      name: "ZGROU/MO/00292",
      data: {
        name: "ZGROU/MO/00292",
        complete: false,
        missingCount: 1,
        componentsTotal: 2600,
        overheadTotal: 456,
        unitCost: 3056,
        companyCurrency: "PEN",
        needs: ["costo promedio en 1 producto"],
        components: [
          { name: "DRY origen", qty: 1, unitCost: 2421, lineCost: 2421, origin: "standard", category: "Contenedor Dry" },
          { name: "Toma", qty: 1, origin: "missing", category: "Insumos" },
        ],
      },
    });
    expect(v.totals.find((t) => t.label === "Costo unidad")?.value).toMatch(/3,056/);
    expect(v.components[0].origin).toMatch(/promedio/i);
    expect(v.components.some((c) => c.missing)).toBe(true);
    expect(v.pending).toMatch(/incompleto/i);
  });
});
