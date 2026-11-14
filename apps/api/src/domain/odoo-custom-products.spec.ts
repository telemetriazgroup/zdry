import { countCustomProducts, customSearchTerms, normalizeOdooCustomProducts, odooNamePattern, phraseHitsName, phraseHitsProduct } from "./odoo-custom-products";

describe("productos personalizados de Odoo", () => {
  it("acepta un nombre sin DRY y no repite el mismo texto", () => {
    const state = normalizeOdooCustomProducts({
      phrases: ["  modulo de revestimiento ", "Módulo de revestimiento", "ab", ""],
    });
    expect(state.phrases).toEqual(["modulo de revestimiento"]);
  });

  it("encuentra el módulo aunque el nombre lleve tilde", () => {
    expect(phraseHitsName("modulo de revestimiento", "MÓDULO DE REVESTIMIENTO 20")).toBe(true);
    expect(phraseHitsName("modulo de revestimiento", "CONTENEDOR DRY 40")).toBe(false);
    expect(odooNamePattern("módulo")).toBe("m_d_l_");
  });

  it("cuenta productos y series de cada texto", () => {
    const counts = countCustomProducts(
      [
        { id: 1, name: "MODULO DE REVESTIMIENTO" },
        { id: 2, name: "Módulo de revestimiento 40" },
        { id: 3, name: "CONTENEDOR DRY 40" },
      ],
      [
        { productId: 1, lotId: 10 },
        { productId: 1, lotId: 10 },
        { productId: 2, lotId: 11 },
        { productId: 3, lotId: 12 },
      ],
      ["modulo de revestimiento"],
    );
    expect(counts).toEqual([{ phrase: "modulo de revestimiento", products: 2, series: 2 }]);
  });

  it("separa el código del nombre que muestra Odoo", () => {
    expect(customSearchTerms("[MDND0004] MODULO CON REVESTIMIENTO 20 DC REV")).toEqual({
      code: "MDND0004",
      name: "MODULO CON REVESTIMIENTO 20 DC REV",
    });
    expect(phraseHitsProduct("[MDND0004] MODULO CON REVESTIMIENTO 20 DC REV", "MODULO CON REVESTIMIENTO 20 DC REV", "MDND0004")).toBe(true);
  });
});