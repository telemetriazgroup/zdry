import {
  baselineFromPresent,
  classifyDryAsunto,
  dryPipeline,
  limaYearMonth,
  presentDryStats,
  rowFromOdoo,
} from "./odoo-dry-stats";

describe("classifyDryAsunto", () => {
  it("venta DRY estándar", () => {
    expect(classifyDryAsunto("VENTA DE CONTENEDOR DRY 40 HC SEGUNDO USO")).toEqual({ kind: "venta", reason: "ok" });
  });

  it("alquiler DRY + transporte sigue siendo alquiler", () => {
    expect(classifyDryAsunto("ALQUILER DE 03 CONTENEDORES DRY DE 40 HC + SERVICIO DE TRANSPORTE ZGROUP CALLAO")).toEqual({
      kind: "alquiler",
      reason: "ok",
    });
  });

  it("todo lo que no es venta/alquiler puro va a otros", () => {
    expect(classifyDryAsunto("VENTA DE CONTENEDOR REEFER 40 RH + DRY")).toEqual({ kind: "otros", reason: "mixto_reefer" });
    expect(classifyDryAsunto("VENTA Y ALQUILER DE CONTENEDOR DRY DE 20 PIES")).toEqual({ kind: "otros", reason: "mixto" });
    expect(classifyDryAsunto("SERVICIO DE TRANSPORTE DE 02 CONTENEDORES DRY 40 HC")).toEqual({
      kind: "otros",
      reason: "solo_logistica",
    });
    expect(classifyDryAsunto("GARANTIA POR ALQUILER DE 20 CONTENEDORES DRY 40 HC")).toEqual({
      kind: "otros",
      reason: "garantia",
    });
    expect(classifyDryAsunto("PROYECTO MODULAR EN CONTENEDORES DRY SEGUN PLANO")).toEqual({
      kind: "otros",
      reason: "modular",
    });
  });
});

describe("dryPipeline", () => {
  it("recorre cotización → ingreso", () => {
    expect(dryPipeline("draft", "no")).toBe("cotizacion");
    expect(dryPipeline("sale", "no")).toBe("confirmada");
    expect(dryPipeline("sale", "to invoice")).toBe("por_facturar");
    expect(dryPipeline("sale", "invoiced")).toBe("ingreso");
    expect(dryPipeline("cancel", "invoiced")).toBe("cancelada");
  });
});

describe("limaYearMonth", () => {
  it("parte date_order de Odoo", () => {
    const ym = limaYearMonth("2025-06-15 10:00:00");
    expect(ym.year).toBe(2025);
    expect(ym.month).toBe("2025-06");
  });
});

describe("presentDryStats", () => {
  it("separa comerciales, años y conversión a ingreso", () => {
    const a = rowFromOdoo({
      id: 1,
      name: "1001",
      date_order: "2025-03-01 12:00:00",
      partner_id: [1, "Pichari"],
      user_id: [2, "Nayeli Cordova"],
      amount_total: 3339.4,
      amount_untaxed: 2830,
      state: "sale",
      invoice_status: "invoiced",
      currency_id: [1, "USD"],
      x_studio_asunto_cotizacion: "VENTA DE CONTENEDORES DRY 20 DC SEGUNDO USO",
    }).row;
    const b = rowFromOdoo({
      id: 2,
      name: "1002",
      date_order: "2026-02-01 12:00:00",
      partner_id: [3, "Imexcal"],
      user_id: [2, "Nayeli Cordova"],
      amount_total: 424.8,
      state: "sale",
      invoice_status: "invoiced",
      currency_id: [1, "USD"],
      x_studio_asunto_cotizacion: "ALQUILER DE CONTENEDORES DRY 40 HC",
      is_subscription: true,
    }).row;
    const c = rowFromOdoo({
      id: 3,
      name: "1003",
      date_order: "2026-04-01 12:00:00",
      partner_id: [4, "X"],
      user_id: [5, "Melisa Garay"],
      amount_total: 2000,
      state: "draft",
      invoice_status: "no",
      currency_id: [1, "USD"],
      x_studio_asunto_cotizacion: "VENTA DE CONTENEDOR DRY 40 HC SEGUNDO USO",
    }).row;
    const d = rowFromOdoo({
      id: 4,
      name: "1004",
      date_order: "2024-08-01 12:00:00",
      partner_id: [6, "Logi"],
      user_id: [5, "Melisa Garay"],
      amount_total: 800,
      state: "draft",
      invoice_status: "no",
      currency_id: [1, "USD"],
      x_studio_asunto_cotizacion: "SERVICIO DE TRANSPORTE DE 02 CONTENEDORES DRY 40 HC",
    }).row;
    const p = presentDryStats([a!, b!, c!, d!], { excludedByReason: {} });
    expect(p.dealCount).toBe(4);
    expect(p.years["2024"].otros.quotes).toBe(1);
    expect(p.otrosByReason.solo_logistica).toBe(1);
    expect(p.years["2026"].otros.quotes).toBe(0);
    expect(p.years["2025"].venta.ingresos).toBe(1);
    expect(p.years["2026"].alquiler.ingresos).toBe(1);
    expect(p.years["2026"].venta.quotes).toBe(1);
    expect(p.years["2026"].venta.confirmRate).toBe(0);
    expect(p.vendors[0].name).toBe("Nayeli Cordova");
    expect(p.vendors[0].ingresos).toBe(2);
    expect(p.vendors[0].rank).toBe(1);
    expect(p.leader?.name).toBe("Nayeli Cordova");
    expect(p.months.find((m) => m.month === "2026-04")?.cotizacion).toBe(1);
    expect(p.months.find((m) => m.month === "2026-02")?.facturado).toBe(1);
    expect(p.pipeline.ingreso).toBe(2);
    const base = baselineFromPresent(p);
    const after = presentDryStats([a!, b!, c!], { baseline: base });
    expect(after.delta?.ventaIngresos).toBe(0);
  });
});
