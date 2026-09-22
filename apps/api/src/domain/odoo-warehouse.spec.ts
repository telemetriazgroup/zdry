import {
  defaultPatioCode,
  isZgrouAssignablePatio,
  needsPatioChoice,
  PATIO_CALLAO_PENDING,
  PATIO_GAMBETA_1,
  PATIO_PIURA,
  PATIO_PRINCIPAL,
  warehouseFromLocation,
  warehouseLabel,
} from "./odoo-warehouse";

describe("odoo-warehouse", () => {
  it("extrae plaza Odoo del path de existencias", () => {
    expect(warehouseFromLocation("ZGROU/Existencias")).toBe("ZGROU");
    expect(warehouseFromLocation("Piura/Existencias")).toBe("PIURA");
    expect(warehouseFromLocation("PIURA / Existencias")).toBe("PIURA");
    expect(warehouseFromLocation("")).toBe("");
  });

  it("mapea patio por defecto: Piura 1:1, ZGROU pendiente", () => {
    expect(defaultPatioCode("PIURA")).toBe(PATIO_PIURA);
    expect(defaultPatioCode("ZGROU")).toBe(PATIO_CALLAO_PENDING);
    expect(defaultPatioCode("")).toBeNull();
  });

  it("ZGROU exige elegir Principal o Gambeta si aún está pendiente", () => {
    expect(needsPatioChoice("ZGROU", PATIO_CALLAO_PENDING)).toBe(true);
    expect(needsPatioChoice("ZGROU", PATIO_PRINCIPAL)).toBe(false);
    expect(needsPatioChoice("ZGROU", PATIO_GAMBETA_1)).toBe(false);
    expect(needsPatioChoice("PIURA", PATIO_PIURA)).toBe(false);
    expect(isZgrouAssignablePatio(PATIO_PRINCIPAL)).toBe(true);
    expect(isZgrouAssignablePatio(PATIO_CALLAO_PENDING)).toBe(false);
  });

  it("etiqueta plazas", () => {
    expect(warehouseLabel("PIURA")).toMatch(/Piura/);
    expect(warehouseLabel("ZGROU")).toMatch(/ZGROU/);
  });
});
