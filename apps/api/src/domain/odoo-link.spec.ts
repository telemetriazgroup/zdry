import { decryptOdooKey, encryptOdooKey, odooGateRequired, odooLoginMatches, odooProbeModel, redactOdooSecret, sameOdooOrigin } from "./odoo-link";

describe("vínculo Odoo por usuario", () => {
  it("exige la puerta solo a admin, comercial y despacho", () => {
    expect(odooGateRequired("admin")).toBe(true);
    expect(odooGateRequired("vendedor")).toBe(true);
    expect(odooGateRequired("coordinador")).toBe(true);
    expect(odooGateRequired("compras")).toBe(false);
    expect(odooGateRequired("gerente")).toBe(false);
    expect(odooGateRequired("superadmin")).toBe(false);
  });

  it("el correo de ZDRY tiene que ser el login de Odoo", () => {
    expect(odooLoginMatches("Ana@Zdry.pe", "ana@zdry.pe")).toBe(true);
    expect(odooLoginMatches("ana@zdry.pe", "ana")).toBe(false);
  });

  it("el comercial prueba pedidos y despacho prueba lotes", () => {
    expect(odooProbeModel("vendedor")).toBe("sale.order");
    expect(odooProbeModel("coordinador")).toBe("stock.lot");
    expect(odooProbeModel("admin")).toBe("stock.lot");
  });

  it("cifra la clave y no la deja en el mensaje de error", () => {
    const enc = encryptOdooKey("secreto-api");
    expect(enc).not.toContain("secreto-api");
    expect(decryptOdooKey(enc)).toBe("secreto-api");
    expect(redactOdooSecret("Odoo rechazó secreto-api", "secreto-api")).not.toContain("secreto-api");
  });

  it("otra URL o base es otro origen", () => {
    expect(sameOdooOrigin({ url: "https://odoo.test/", db: "stg" }, { url: "https://odoo.test", db: "stg" })).toBe(true);
    expect(sameOdooOrigin({ url: "https://odoo.test", db: "stg" }, { url: "https://odoo.prod", db: "stg" })).toBe(false);
    expect(sameOdooOrigin({ url: "https://odoo.test", db: "stg" }, { url: "https://odoo.test", db: "prod" })).toBe(false);
  });
});
