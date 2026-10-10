import { exceptionPriceError } from "./price-exception";

describe("exceptionPriceError", () => {
  it("solo acepta un precio debajo del mínimo", () => {
    expect(exceptionPriceError(800, 1000)).toBeNull();
    expect(exceptionPriceError(1000, 1000)).toMatch(/dentro del rango/);
    expect(exceptionPriceError(0, 1000)).toMatch(/mayor que cero/);
  });
});
