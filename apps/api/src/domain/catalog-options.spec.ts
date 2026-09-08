import { mergeCatalogOptions, normalizeDocumentConcept, normalizeOptionLabel } from "./catalog-options";

describe("catalog options", () => {
  it("agrega un color nuevo sin duplicar mayúsculas", () => {
    const merged = mergeCatalogOptions(["Azul", "Rojo"], ["crema", "AZUL"]);
    expect(merged).toEqual(["Azul", "Rojo", "crema"]);
  });

  it("normaliza espacios", () => {
    expect(normalizeOptionLabel("  Crema  extra ")).toBe("Crema extra");
  });

  it("acepta un concepto de documento libre y mapea los ids viejos", () => {
    expect(normalizeDocumentConcept("  Guía de remisión ")).toBe("Guía de remisión");
    expect(normalizeDocumentConcept("eir")).toBe("Recibo de intercambio de equipo (EIR)");
  });
});
