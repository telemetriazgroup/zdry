import { shouldFollowOdooEvent } from "./quote-odoo-follow";
import {
  followDiffJson,
  followLinesJson,
  quoteTimeline,
  revisionDiffSummary,
  shouldRecordOdooRevision,
  yardDispatchReady,
} from "./quote-odoo-timeline";

describe("quote-odoo-timeline Q7", () => {
  it("J2 sale_state / invoice_posted entran; origin=zdry no (anti-eco)", () => {
    expect(shouldFollowOdooEvent("zdry")).toBe(false);
    expect(shouldRecordOdooRevision("zdry")).toBe(false);
    expect(shouldRecordOdooRevision("odoo")).toBe(true);
    expect(shouldFollowOdooEvent("odoo")).toBe(true);
  });

  it("timeline borrador → enviada → confirmada → facturada F00 → OUT", () => {
    const hits = quoteTimeline(
      {
        odooSaleId: 55257,
        odooSaleName: "10020263830",
        odooState: "sale",
        odooInvoiceName: "F F00-1",
        odooInvoiceStatus: "invoiced",
        odooPickingState: "done",
        odooPickingName: "ZGROU/OUT/1",
      },
      "staff",
    );
    expect(hits.map((h) => h.key)).toEqual(["draft", "sent", "sale", "invoiced", "out"]);
    expect(hits.every((h) => h.done)).toBe(true);
    expect(hits.find((h) => h.key === "invoiced")?.label).toMatch(/F F00-1/);
    expect(hits.find((h) => h.key === "out")?.label).toMatch(/OUT/);

    const client = quoteTimeline(
      {
        odooSaleId: 1,
        odooSaleName: "10020263830",
        odooState: "sale",
        odooInvoiceName: "F F00-1",
        odooPickingState: "done",
        odooPickingName: "OUT/1",
      },
      "client",
    );
    expect(client.find((h) => h.key === "invoiced")?.label).toMatch(/Tu factura F F00-1/);
    expect(client.find((h) => h.key === "out")?.label).toMatch(/Tu equipo salió/);
    expect(client.find((h) => h.key === "draft")?.detail).toBe("10020263830");
  });

  it("despacho de patio exige invoice_posted + asignación; un descuento Odoo no basta", () => {
    expect(
      yardDispatchReady({ dealStatus: "asignacion_confirmada", odooInvoiceName: null, odooInvoiceStatus: "to_invoice" }).ok,
    ).toBe(false);
    expect(
      yardDispatchReady({
        dealStatus: "asignacion_confirmada",
        odooInvoiceName: "F F00-1",
        odooInvoiceStatus: "invoiced",
      }).ok,
    ).toBe(true);
    expect(yardDispatchReady({ dealStatus: "pago_validado", odooInvoiceName: "F F00-1" }).ok).toBe(false);
    expect(revisionDiffSummary({ state: { before: "draft", after: "sale" }, amountTotal: { before: 10, after: 12 } })).toMatch(
      /draft → sale/,
    );
    expect(followLinesJson({ event: "sale_state", payload: { changed: { amount_untaxed: 1 } } }).changed).toEqual({
      amount_untaxed: 1,
    });
    const outDiff = followDiffJson({
      snapshot: {},
      beforePicking: null,
      afterPicking: "ZGROU/OUT/1",
    });
    expect(outDiff.pickingOut?.after).toBe("ZGROU/OUT/1");
    expect(revisionDiffSummary(outDiff)).toMatch(/OUT/);
  });
});
