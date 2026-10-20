import { odooInstantToLima } from "./odoo-time";
import { presentOdooDocument } from "./odoo-doc-present";

describe("hora de Odoo a Lima", () => {
  it("resta 5 horas: las 16:00 GMT son las 11:00 en el sistema", () => {
    expect(odooInstantToLima("2026-10-18 16:00:00")).toBe("2026-10-18 11:00:00");
    expect(odooInstantToLima("2026-09-29 21:20:43")).toBe("2026-09-29 16:20:43");
  });

  it("cruza al día anterior cuando el GMT cae antes de las 05:00", () => {
    expect(odooInstantToLima("2026-10-18 02:30:00")).toBe("2026-10-17 21:30:00");
  });

  it("una fecha sin hora se queda igual", () => {
    expect(odooInstantToLima("2026-09-24")).toBe("2026-09-24");
    expect(odooInstantToLima("")).toBe("");
  });

  it("el expediente muestra la salida en hora de Lima", () => {
    const view = presentOdooDocument({
      kind: "picking_out",
      name: "ZGROU/OUT/08622",
      data: {
        date: "2026-09-29 21:20:43",
        state: "done",
        locationSrc: "ZGROU/Existencias",
        locationDest: "Partners/Customers",
        pickings: [{ name: "ZGROU/OUT/08622", date: "2026-09-29 21:20:43", isos: ["LATU9011211"] }],
      },
    });
    expect(view.rows.find((row) => row.label === "Fecha")?.value).toBe("2026-09-29 16:20:43");
    expect(view.pickings[0].date).toBe("2026-09-29 16:20:43");
  });
});
