import {
  coerceOdooWriteValue,
  guessColor,
  inspectOdooIso,
  inferTypeFromProduct,
  mergeFieldCatalog,
  pickFieldByLabel,
  readLotAttrs,
  titleFromLocation,
} from "./odoo-lot-map";

describe("odoo-lot-map", () => {
  it("normaliza el guion de Odoo y acepta un ISO válido", () => {
    const r = inspectOdooIso("INKU252806-7");
    expect(r.isoNormalized).toBe("INKU2528067");
    expect(r.iso6346Ok).toBe(true);
    expect(r.isoException).toBe(false);
  });

  it("no bloquea un serial inválido: lo marca para revisión", () => {
    const r = inspectOdooIso("ABC-123");
    expect(r.isoNormalized).toBe("ABC123");
    expect(r.iso6346Ok).toBe(false);
    expect(r.isoException).toBe(true);
  });

  it("infiere 40HC desde el producto Odoo", () => {
    expect(inferTypeFromProduct("CONTENEDOR DRY 40 HC SEGUNDO US", "CDD40HC004")).toBe("40HC");
  });

  it("usa el último tramo de la ubicación Odoo como nombre de almacén", () => {
    expect(titleFromLocation("ZGROU/Existencias")).toBe("Existencias");
    expect(titleFromLocation("Principal Callao: Recepciones")).toBe("Principal Callao: Recepciones");
  });

  it("mapea CREMA a Beige y lee los campos de ficha Odoo por etiqueta", () => {
    expect(guessColor("CREMA")).toBe("Beige");
    const fields = {
      name: { string: "Número de serie/lote" },
      x_studio_color: { string: "Color" },
      x_studio_tara: { string: "Tara" },
      x_studio_peso: { string: "Peso (Kg)" },
      x_studio_dua: { string: "Nº DUA" },
      x_studio_proc: { string: "Procedencia" },
      x_studio_mat: { string: "Tipo Material" },
      x_studio_year: { string: "Año de Fabricación" },
      x_studio_fab: { string: "Fabricante" },
      x_studio_zg: { string: "Código ZGroup" },
    };
    expect(pickFieldByLabel(fields, ["color"])).toBe("x_studio_color");
    expect(pickFieldByLabel(fields, ["peso kg", "peso"])).toBe("x_studio_peso");
    expect(pickFieldByLabel(fields, ["n dua", "dua"])).toBe("x_studio_dua");
    const attrs = readLotAttrs(
      {
        name: "CICU684867-5",
        x_studio_color: "CREMA",
        x_studio_tara: 2100,
        x_studio_peso: 28380,
        x_studio_dua: "118-2025-10-217796-01-9-00",
        x_studio_proc: "CHINA",
        x_studio_mat: "ACERO",
        x_studio_year: false,
        x_studio_fab: false,
        x_studio_zg: "CICU684867-5",
      },
      fields,
    );
    expect(attrs.color).toBe("CREMA");
    expect(attrs.tareKg).toBe(2100);
    expect(attrs.mgwKg).toBe(28380);
    expect(attrs.dua).toContain("217796");
    expect(attrs.originCountry).toBe("CHINA");
    expect(attrs.material).toBe("ACERO");
    expect(attrs.year).toBeNull();
    expect(attrs.manufacturer).toBeNull();
  });

  it("descubre campos Studio desde ir.model.fields aunque fields_get venga incompleto", () => {
    const fields = mergeFieldCatalog(
      { name: { string: "Número de serie/lote" }, x_studio_category: { string: "*Category" } },
      [
        { name: "x_studio_peso_kg", field_description: "Peso (Kg)", ttype: "integer" },
        { name: "x_studio_tara", field_description: "Tara", ttype: "integer" },
        { name: "x_studio_procedencia", field_description: "Procedencia", ttype: "char" },
        { name: "x_studio_tipo_material", field_description: "Tipo Material", ttype: "char" },
        { name: "x_studio_color", field_description: "Color", ttype: "char" },
        { name: "x_studio_n_dua", field_description: "Nº DUA", ttype: "char" },
      ],
    );
    const attrs = readLotAttrs(
      {
        name: "CICU684867-5",
        x_studio_category: false,
        x_studio_peso_kg: 28380,
        x_studio_tara: 2100,
        x_studio_procedencia: "CHINA",
        x_studio_tipo_material: "ACERO",
        x_studio_color: "CREMA",
        x_studio_n_dua: "118-2025-10-217796-01-9-00",
      },
      fields,
    );
    expect(attrs.mgwKg).toBe(28380);
    expect(attrs.tareKg).toBe(2100);
    expect(attrs.originCountry).toBe("CHINA");
    expect(attrs.material).toBe("ACERO");
    expect(attrs.color).toBe("CREMA");
    expect(attrs.dua).toContain("217796");
  });

  it("usa tara/weight/procedence nativos y ignora flags enable_*", () => {
    const fields = mergeFieldCatalog(
      {},
      [
        { name: "color", field_description: "Color" },
        { name: "enable_color", field_description: "Enable Color" },
        { name: "tara", field_description: "Tara" },
        { name: "enable_tara", field_description: "Enable Tara" },
        { name: "weight", field_description: "Peso (Kg)" },
        { name: "enable_weight", field_description: "Enable Weight" },
        { name: "procedence", field_description: "Procedencia" },
        { name: "tipo_material", field_description: "Tipo Material" },
        { name: "nro_dua", field_description: "Nº DUA" },
        { name: "maker", field_description: "Fabricante" },
        { name: "enable_maker", field_description: "Enable Maker" },
      ],
    );
    const attrs = readLotAttrs(
      {
        name: "CICU684867-5",
        color: "CREMA",
        enable_color: true,
        tara: 2100,
        enable_tara: true,
        weight: 28380,
        procedence: "CHINA",
        tipo_material: "ACERO",
        nro_dua: "118-2025-10-217796-01-9-00",
        maker: false,
        enable_maker: true,
      },
      fields,
    );
    expect(attrs.color).toBe("CREMA");
    expect(attrs.tareKg).toBe(2100);
    expect(attrs.mgwKg).toBe(28380);
    expect(attrs.originCountry).toBe("CHINA");
    expect(attrs.material).toBe("ACERO");
    expect(attrs.manufacturer).toBeNull();
  });

  it("escribe building_year como clave de selección, no como entero", () => {
    const sel = [["2011", "2011"], ["2012", "2012"], ["NO DEFINE", "NO DEFINE"]] as [string, string][];
    expect(coerceOdooWriteValue("selection", 2011, sel)).toBe("2011");
    expect(coerceOdooWriteValue("char", 2100)).toBe("2100");
    expect(coerceOdooWriteValue("selection", "CREMA", [["CREMA", "CREMA"], ["BEIGE", "BEIGE"]])).toBe("CREMA");
  });
});
