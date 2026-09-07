import { parseCondition, parseSerialsFromPoText, purchaseRefFromOrder } from "./odoo-purchase";

describe("odoo-purchase", () => {
  it("extrae seriales del texto libre de la línea OC", () => {
    const text = "CAIU822565-9 // CAIU830527-1 // INKU252806-7\nCAIU8629352  // CAIU854490-7";
    const isos = parseSerialsFromPoText(text);
    expect(isos).toContain("CAIU8225659");
    expect(isos).toContain("INKU2528067");
    expect(isos).toContain("CAIU8629352");
  });

  it("guarda precio unitario solo si es positivo", () => {
    expect(purchaseRefFromOrder({ unitPrice: 1325 }).odooUnitPrice).toBe(1325);
    expect(purchaseRefFromOrder({ unitPrice: 0 }).odooUnitPrice).toBeNull();
  });

  it("acepta grados de evaluación admin", () => {
    expect(parseCondition("Bueno")).toBe("bueno");
    expect(parseCondition("excelente")).toBeNull();
  });
});
