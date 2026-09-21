import { defaultQuoteIssueConfig, rentIssueReady, quoteIssueReady } from "./odoo-quote-issue";
import { RENT_CLOSE_EVENT, assertRentCloseable, assertRentCloseDoesNotInvoice, QuoteRentCloseError } from "./quote-rent-close";
import { SALE_CLOSE_EVENT } from "./quote-sale-close";
import {
  RENT_ISSUE_EVENT,
  assertRentIssuable,
  buildRentDraftLines,
  buildRentSaleOrderVals,
  canAmendRentQuota,
  contractEndDate,
  isoAssignName,
  pickRentFields,
  QuoteRentDraftError,
  rentExpectedAmounts,
  rentQuotaWriteMode,
} from "./quote-rent-draft";
import { QUOTE_ISSUE_EVENT } from "./quote-issue-draft";

function readyCfg() {
  const cfg = defaultQuoteIssueConfig();
  cfg.taxId = 325;
  cfg.pricelistId = 9;
  cfg.warehouseId = 22;
  cfg.fiscalPositionId = 32;
  cfg.paymentTermId = 1;
  cfg.companyId = 19;
  cfg.planId = 4;
  cfg.products[0].productId = 5800;
  cfg.products[1].productId = 5807;
  cfg.products.find((p) => p.key === "alquiler")!.productId = 9100;
  return cfg;
}

describe("quote-rent-draft Q6", () => {
  it("alquiler: servicio con cuota + ISO a $0; Q2 ready no exige el servicio", () => {
    const cfg = readyCfg();
    expect(quoteIssueReady(cfg).ok).toBe(true);
    expect(rentIssueReady(cfg).ok).toBe(true);
    expect(RENT_ISSUE_EVENT).toBe("rent_issue");
    expect(RENT_ISSUE_EVENT).not.toBe(QUOTE_ISSUE_EVENT);
    expect(RENT_CLOSE_EVENT).toBe("rent_close");
    expect(RENT_CLOSE_EVENT).not.toBe(SALE_CLOSE_EVENT);

    const lines = buildRentDraftLines(cfg, [{ iso: "BMOU1234567", type: "40HC", cat: "CW" }], 1200);
    expect(lines).toHaveLength(2);
    expect(lines[0].priceUnit).toBe(1200);
    expect(lines[0].lineType).toBe("VENTA DE SERVICIOS - ALQUILER");
    expect(lines[0].productId).toBe(9100);
    expect(lines[1].priceUnit).toBe(0);
    expect(lines[1].name).toMatch(/ASIGNACIÓN DE CÓDIGOS/);
    expect(lines[1].name).toContain("BMOU1234567");
    expect(lines[1].lineType).toBe("VENTA DE PRODUCTOS");
    expect(rentExpectedAmounts(1200)).toEqual({ untaxed: 1200, tax: 216, total: 1416 });
  });

  it("SO draft con plan mensual; no confirma; venta/demo no entran", () => {
    const cfg = readyCfg();
    const lines = assertRentIssuable("alquiler", false, cfg, [{ iso: "A", type: "20GP", cat: "CW" }], 800);
    const so = buildRentSaleOrderVals({
      cfg,
      quoteNumber: "Q-2026-0009",
      partnerId: 88,
      lines,
      now: new Date("2026-09-21T12:00:00Z"),
      rentMonths: 12,
    });
    expect(so.state).toBeUndefined();
    expect(so).not.toHaveProperty("action_confirm");
    expect(so.plan_id).toBe(4);
    expect(so.is_subscription).toBe(true);
    expect(so.start_date).toBe("2026-09-21");
    expect(so.end_date).toBe(contractEndDate(new Date("2026-09-21T12:00:00Z"), 12));
    expect(String(so.x_studio_asunto_cotizacion)).toMatch(/^ALQUILER DE CONTENEDOR DRY/);
    expect(() => assertRentIssuable("venta", false, cfg, [{ iso: "A", type: "20GP", cat: "CW" }], 1)).toThrow(
      QuoteRentDraftError,
    );
    expect(() => assertRentIssuable("alquiler", true, cfg, [{ iso: "A", type: "20GP", cat: "CW" }], 1)).toThrow(/demo/);
  });

  it("cuota editable en draft y en sale; pickRentFields omite plan si no existe", () => {
    expect(canAmendRentQuota("draft")).toBe(true);
    expect(canAmendRentQuota("sale")).toBe(true);
    expect(canAmendRentQuota("cancel")).toBe(false);
    expect(rentQuotaWriteMode("draft")).toBe("replace");
    expect(rentQuotaWriteMode("sale")).toBe("service");
    expect(isoAssignName("X", "20GP", "CW")).toMatch(/ASIGNACIÓN/);
    const vals = pickRentFields({ partner_id: {} }, { partner_id: 1, plan_id: 4, is_subscription: true });
    expect(vals.plan_id).toBeUndefined();
    expect(vals.partner_id).toBe(1);
  });

  it("cierre Q6 no factura ni mezcla con Q5", () => {
    expect(() =>
      assertRentCloseable({
        kind: "alquiler",
        demo: false,
        odooSaleId: 529218,
        vat: "20612238892",
        lines: [{ iso: "A" }],
      }),
    ).not.toThrow();
    expect(() =>
      assertRentCloseable({
        kind: "venta",
        demo: false,
        odooSaleId: 1,
        vat: "20521180774",
        lines: [{ iso: "A" }],
      }),
    ).toThrow(/Q5/);
    expect(() => assertRentCloseDoesNotInvoice("_create_invoices")).toThrow(QuoteRentCloseError);
    expect(() => assertRentCloseDoesNotInvoice("action_confirm")).not.toThrow();
  });
});
