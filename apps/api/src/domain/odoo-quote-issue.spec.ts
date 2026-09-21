import {
  applyQuoteIssueHits,
  defaultQuoteIssueConfig,
  normalizeQuoteIssueConfig,
  pickNamed,
  productIdFor,
  quoteIssueChecks,
  quoteIssueReady,
  rentIssueReady,
} from "./odoo-quote-issue";

describe("odoo-quote-issue", () => {
  it("trae report v2, IGV 18 % y códigos CDD sin IDs (Q0)", () => {
    const cfg = defaultQuoteIssueConfig();
    expect(cfg.reportName).toBe("sale.report_saleorder_copy_1_copy_4");
    expect(cfg.taxAmount).toBe(18);
    expect(cfg.products.map((p) => p.defaultCode)).toContain("CDD20F0003");
    expect(cfg.products.map((p) => p.defaultCode)).toContain("CDD40H0004");
    expect(quoteIssueReady(cfg).ok).toBe(false);
    expect(quoteIssueReady(cfg).missing).toEqual(expect.arrayContaining(["taxId", "warehouseId", "product:20dc-segundo"]));
  });

  it("no exige el 40 DC si no tiene default_code", () => {
    const cfg = defaultQuoteIssueConfig();
    cfg.taxId = 325;
    cfg.pricelistId = 1;
    cfg.warehouseId = 22;
    cfg.fiscalPositionId = 32;
    cfg.paymentTermId = 1;
    cfg.companyId = 19;
    cfg.products[0].productId = 5800;
    cfg.products[1].productId = 5807;
    const ready = quoteIssueReady(cfg);
    expect(ready.ok).toBe(true);
    expect(ready.missing).toEqual([]);
    expect(quoteIssueChecks(cfg).find((c) => c.key === "product:40dc-segundo")?.ok).toBe(true);
  });

  it("resuelve IDs por nombre/código y productIdFor lee el mapa", () => {
    const next = applyQuoteIssueHits(defaultQuoteIssueConfig(), {
      tax: { id: 325, name: "IGV 18%", amount: 18 },
      warehouse: { id: 22, name: "Principal Callao" },
      pricelist: { id: 9, name: "Lista de precios por defecto USD" },
      fiscalPosition: { id: 32, name: "LOCAL PERU" },
      paymentTerm: { id: 1, name: "Immediate Payment" },
      company: { id: 19, name: "ZGROUP S.A.C.", vat: "20521180774" },
      report: { id: 868, report_name: "sale.report_saleorder_copy_1_copy_4" },
      products: [
        { key: "20dc-segundo", row: { id: 5800, name: "CONTENEDOR DRY 20 DC", default_code: "CDD20F0003" } },
        { key: "40hc-segundo", row: { id: 5807, default_code: "CDD40H0004", display_name: "DRY 40 HC" } },
      ],
    });
    expect(next.taxId).toBe(325);
    expect(next.warehouseId).toBe(22);
    expect(productIdFor(next, "20 DC")).toBe(5800);
    expect(productIdFor(next, "40 HC", "segundo_uso")).toBe(5807);
    expect(quoteIssueReady(next).ok).toBe(true);
  });

  it("Q6 exige producto alquiler y plan; Q2 no", () => {
    const cfg = defaultQuoteIssueConfig();
    cfg.taxId = 325;
    cfg.pricelistId = 1;
    cfg.warehouseId = 22;
    cfg.fiscalPositionId = 32;
    cfg.paymentTermId = 1;
    cfg.companyId = 19;
    cfg.products[0].productId = 5800;
    cfg.products[1].productId = 5807;
    expect(quoteIssueReady(cfg).ok).toBe(true);
    expect(rentIssueReady(cfg).ok).toBe(false);
    expect(rentIssueReady(cfg).missing).toEqual(expect.arrayContaining(["product:alquiler", "planId"]));
    cfg.planId = 4;
    cfg.products.find((p) => p.key === "alquiler")!.productId = 9100;
    expect(rentIssueReady(cfg).ok).toBe(true);
  });

  it("pickNamed prefiere el needle y no el primer row", () => {
    const hit = pickNamed(
      [
        { id: 1, name: "Almacén Sullana" },
        { id: 22, name: "Principal Callao" },
      ],
      ["callao"],
    );
    expect(hit?.id).toBe(22);
  });

  it("normalize no pierde el note ni inventa IDs desde strings", () => {
    const cfg = normalizeQuoteIssueConfig({
      taxId: "325",
      warehouseId: 0,
      defaults: { validityDays: 10, note: "NO INCLUYE test" },
    });
    expect(cfg.taxId).toBe(325);
    expect(cfg.warehouseId).toBeNull();
    expect(cfg.defaults.validityDays).toBe(10);
    expect(cfg.defaults.note).toContain("NO INCLUYE");
    expect(cfg.reportName).toBe("sale.report_saleorder_copy_1_copy_4");
  });
});
