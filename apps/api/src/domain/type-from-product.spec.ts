import { auditEquipment, canonicalTypeFromProduct, parseProductEquipment } from "./type-from-product";
import { mergeDimensionError } from "./type-merge";

const masters = [
  { code: "20GP", dims: "20'×8'×8'6\"" },
  { code: "20DC", dims: "20'×8'×8'6\"" },
  { code: "40GP", dims: "40'×8'×8'6\"" },
  { code: "40DC", dims: "40'×8'×8'6\"" },
  { code: "40HC", dims: "40'×8'×9'6\"" },
  { code: "40OT", dims: "40'×8'×8'6\"" },
  { code: "20OT", dims: "20'×8'×8'6\"" },
  { code: "HT", dims: "20'/40'×8'×8'6\"" },
];

describe("parseProductEquipment", () => {
  it("lee 20 DC aunque el código de producto parezca de 40", () => {
    const shape = parseProductEquipment("CONTENEDOR DRY 20 DC NUEVO", "CDE040");
    expect(shape.feet).toBe(20);
    expect(shape.family).toBe("standard");
    expect(shape.condition).toBe("1TRIP");
    expect(shape.namedCode).toBe("20DC");
  });

  it("no toma open side como open top", () => {
    const shape = parseProductEquipment("CONTENEDOR DRY 20 DC OPEN SIDE NUEVO", "CDE040");
    expect(shape.openSide).toBe(true);
    expect(shape.family).toBe("standard");
    expect(shape.feet).toBe(20);
  });

  it("lee 40 OT y no le asigna condición por segundo uso", () => {
    const shape = parseProductEquipment("CONTENEDOR DRY 40 OT SEGUNDO USO", "");
    expect(shape.feet).toBe(40);
    expect(shape.family).toBe("ot");
    expect(shape.condition).toBeNull();
  });
});

describe("canonicalTypeFromProduct", () => {
  it("mantiene 40 HC y corrige 40 OT y open side", () => {
    expect(canonicalTypeFromProduct("CONTENEDOR DRY 40 HC SEGUNDO US", "CDD40HC004")).toBe("40HC");
    expect(canonicalTypeFromProduct("CONTENEDOR DRY 40 OT SEGUNDO USO", "")).toBe("40OT");
    expect(canonicalTypeFromProduct("CONTENEDOR DRY 20 DC OPEN SIDE NUEVO", "CDE040")).toBe("20GP");
    expect(canonicalTypeFromProduct("CONTENEDOR DRY 20 DC NUEVO", "")).toBe("20GP");
  });
});

describe("auditEquipment", () => {
  it("sugiere 20DC cuando el tipo actual es 40DC y el producto dice 20 DC", () => {
    const row = auditEquipment({
      id: "FSCU1",
      iso: "FSCU1",
      source: "contenedor",
      currentType: "40DC",
      currentCat: "1TRIP",
      productName: "CONTENEDOR DRY 20 DC NUEVO",
      productCode: "CDE031",
    }, masters);
    expect(row?.suggestedType).toBe("20DC");
    expect(row?.suggestedCat).toBeNull();
    expect(row?.typeReason).toContain("20 pies");
  });

  it("no marca 20GP cuando el producto dice 20 DC: es la misma medida", () => {
    const row = auditEquipment({
      id: "A",
      iso: "A",
      source: "contenedor",
      currentType: "20GP",
      currentCat: "1TRIP",
      productName: "CONTENEDOR DRY 20 DC NUEVO",
      productCode: "",
    }, masters);
    expect(row).toBeNull();
  });

  it("sugiere 40OT y deja la condición ASIS", () => {
    const row = auditEquipment({
      id: "B",
      iso: "B",
      source: "contenedor",
      currentType: "40GP",
      currentCat: "ASIS",
      productName: "CONTENEDOR DRY 40 OT SEGUNDO USO",
      productCode: "",
    }, masters);
    expect(row?.suggestedType).toBe("40OT");
    expect(row?.suggestedCat).toBeNull();
  });

  it("corrige open side mal clasificado como open top", () => {
    const row = auditEquipment({
      id: "C",
      iso: "C",
      source: "contenedor",
      currentType: "20OT",
      currentCat: "1TRIP",
      productName: "CONTENEDOR DRY 20 DC OPEN SIDE NUEVO",
      productCode: "CDE040",
    }, masters);
    expect(row?.suggestedType).toBe("20DC");
    expect(row?.typeReason).toContain("Open side");
    expect(row?.suggestedCat).toBeNull();
  });

  it("la condición distinta queda aparte y no cambia el tipo si la medida coincide", () => {
    const row = auditEquipment({
      id: "D",
      iso: "D",
      source: "contenedor",
      currentType: "20GP",
      currentCat: "ASIS",
      productName: "CONTENEDOR DRY 20 DC NUEVO",
      productCode: "",
    }, masters);
    expect(row?.suggestedType).toBeNull();
    expect(row?.suggestedCat).toBe("1TRIP");
  });

  it("si no existe 20DC sugiere el standard 20GP", () => {
    const withoutDc = masters.filter((row) => row.code !== "20DC");
    const row = auditEquipment({
      id: "E",
      iso: "E",
      source: "contenedor",
      currentType: "40DC",
      currentCat: "ASIS",
      productName: "CONTENEDOR DRY 20 DC NUEVO",
      productCode: "",
    }, withoutDc);
    expect(row?.suggestedType).toBe("20GP");
    expect(row?.typeReason).toContain("20DC");
  });
});

describe("mergeDimensionError", () => {
  const dims = (code: string) => masters.find((row) => row.code === code)?.dims || "";

  it("rechaza 20 con 40", () => {
    expect(mergeDimensionError("20GP", ["40GP"], dims)).toMatch(/40 pies/);
  });

  it("permite 20DC con 20GP", () => {
    expect(mergeDimensionError("20GP", ["20DC"], dims)).toBeNull();
  });

  it("rechaza el hardtop de medida mixta", () => {
    expect(mergeDimensionError("20GP", ["HT"], dims)).toMatch(/sola medida/);
  });
});
