import { catalogPageSize } from "./quotes.service";

describe("catalogPageSize", () => {
  it("trae 32 por defecto y acepta otro tamaño dentro del rango", () => {
    expect(catalogPageSize()).toBe(32);
    expect(catalogPageSize("")).toBe(32);
    expect(catalogPageSize("16")).toBe(16);
    expect(catalogPageSize("4")).toBe(8);
    expect(catalogPageSize("200")).toBe(96);
  });
});
