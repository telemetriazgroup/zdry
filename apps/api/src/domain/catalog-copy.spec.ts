import { normalizeCatalogCopy } from "./catalog-copy";

describe("normalizeCatalogCopy", () => {
  it("deja 40 segundos y 32 por página, y acepta otro valor dentro del rango", () => {
    expect(normalizeCatalogCopy({}).gallerySeconds).toBe(40);
    expect(normalizeCatalogCopy({}).pageSize).toBe(32);
    expect(normalizeCatalogCopy({ gallerySeconds: 55, pageSize: 16 })).toMatchObject({
      gallerySeconds: 55,
      pageSize: 16,
    });
    expect(normalizeCatalogCopy({ gallerySeconds: 1, pageSize: 400 })).toMatchObject({
      gallerySeconds: 5,
      pageSize: 96,
    });
  });
});
