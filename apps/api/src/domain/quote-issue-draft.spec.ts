import { defaultQuoteIssueConfig, quoteIssueReady } from "./odoo-quote-issue";
import {
  amountsMatchOdoo,
  assertDraftOnly,
  assertIssuable,
  buildSaleOrderVals,
  expectedAmounts,
  measureFromType,
  orderLineCommands,
  pickStudio,
  QuoteIssueDraftError,
  saleAsunto,
  usageFromCat,
} from "./quote-issue-draft";

function readyCfg() {
  const cfg = defaultQuoteIssueConfig();
  cfg.taxId = 325;
  cfg.pricelistId = 9;
  cfg.warehouseId = 22;
  cfg.fiscalPositionId = 32;
  cfg.paymentTermId = 1;
  cfg.companyId = 19;
  cfg.products[0].productId = 5800;
  cfg.products[1].productId = 5807;
  return cfg;
}

describe("quote-issue-draft Q2", () => {
  it("mapea tipo ZDRY → medida Odoo y 1TRIP → nuevo", () => {
    expect(measureFromType("20GP")).toBe("20 DC");
    expect(measureFromType("40HC")).toBe("40 HC");
    expect(measureFromType("40GP")).toBe("40 DC");
    expect(measureFromType("45HC")).toBeNull();
    expect(usageFromCat("1TRIP")).toBe("nuevo");
    expect(usageFromCat("CW")).toBe("segundo_uso");
  });

  it("IGV 18 % half-up: neto × 1.18 = total (como Odoo)", () => {
    expect(expectedAmounts(3500)).toEqual({ untaxed: 3500, tax: 630, total: 4130 });
    expect(expectedAmounts(1000.5).tax).toBe(180.09);
    expect(amountsMatchOdoo(expectedAmounts(3500), { amount_tax: 630, amount_total: 4130 })).toBe(true);
    expect(amountsMatchOdoo(expectedAmounts(3500), { amount_tax: 0, amount_total: 3500 })).toBe(false);
  });

  it("SO draft: líneas con tax 18 % y VENTA DE PRODUCTOS; sin confirm ni lote", () => {
    const cfg = readyCfg();
    expect(quoteIssueReady(cfg).ok).toBe(true);
    const lines = assertIssuable("venta", false, cfg, [
      { iso: "BMOU1234567", type: "20GP", cat: "CW", priceNet: 3500 },
    ]);
    expect(lines[0].productId).toBe(5800);
    expect(lines[0].taxId).toBe(325);
    const cmds = orderLineCommands(lines);
    const lineVals = (cmds[0] as unknown[])[2] as Record<string, unknown>;
    expect(lineVals.x_studio_tipo).toBe("VENTA DE PRODUCTOS");
    expect(lineVals.tax_id).toEqual([[6, 0, [325]]]);
    expect(lineVals).not.toHaveProperty("lot_id");
    expect(lineVals).not.toHaveProperty("x_studio_equipo");
    const so = buildSaleOrderVals({
      cfg,
      quoteNumber: "Q-2026-0001",
      kind: "venta",
      partnerId: 88,
      contactId: 99,
      lines,
      now: new Date("2026-09-21T12:00:00Z"),
    });
    expect(so.state).toBeUndefined();
    expect(so).not.toHaveProperty("action_confirm");
    expect(so.partner_id).toBe(88);
    expect(so.x_studio_contacto).toBe(99);
    expect(so.warehouse_id).toBe(22);
    expect(String(so.x_studio_asunto_cotizacion)).toMatch(/^VENTA DE CONTENEDOR DRY 20 DC/);
    expect(so.origin).toBe("ZDRY Q-2026-0001");
    assertDraftOnly(so);
  });

  it("producto DRY inexistente → error, sin vals de SO", () => {
    const cfg = readyCfg();
    expect(() =>
      assertIssuable("venta", false, cfg, [{ iso: "XXXX1234567", type: "45HC", cat: "CW", priceNet: 100 }]),
    ).toThrow(QuoteIssueDraftError);
    try {
      assertIssuable("venta", false, cfg, [{ iso: "XXXX1234567", type: "45HC", cat: "CW", priceNet: 100 }]);
    } catch (e) {
      expect((e as QuoteIssueDraftError).code).toBe("no_product");
    }
  });

  it("alquiler y demo no emiten SO", () => {
    const cfg = readyCfg();
    expect(() => assertIssuable("alquiler", false, cfg, [{ iso: "A", type: "20GP", cat: "CW", priceNet: 1 }])).toThrow(
      /Q6/,
    );
    expect(() => assertIssuable("venta", true, cfg, [{ iso: "A", type: "20GP", cat: "CW", priceNet: 1 }])).toThrow(/demo/);
  });

  it("asunto venta DRY (no mixto) y pickStudio omite campos que no existen", () => {
    expect(saleAsunto("venta", [{ measure: "20 DC", usage: "segundo_uso" }])).toBe(
      "VENTA DE CONTENEDOR DRY 20 DC SEGUNDO USO",
    );
    const vals = pickStudio({ partner_id: {} }, { partner_id: 1, x_studio_correo: "a@b.pe" });
    expect(vals.x_studio_correo).toBeUndefined();
    expect(vals.partner_id).toBe(1);
  });
});
