import {
  quotePatchFromOdooEvent,
  saleIdsFromInvoicePayload,
  saleNamesFromPayload,
  shouldFollowOdooEvent,
} from "./quote-odoo-follow";

describe("quote-odoo-follow Q5", () => {
  it("sale_state e invoice_posted parchean la Quote; origin=zdry no", () => {
    expect(shouldFollowOdooEvent("zdry")).toBe(false);
    expect(shouldFollowOdooEvent("odoo")).toBe(true);
    expect(quotePatchFromOdooEvent({ event: "sale_state", payload: { state: "sale", invoice_status: "to_invoice" } })).toEqual(
      { odooState: "sale", odooInvoiceStatus: "to_invoice" },
    );
    const inv = quotePatchFromOdooEvent({
      event: "invoice_posted",
      resId: 9,
      payload: { invoice_name: "F F00-1", so_ids: [55257] },
    });
    expect(inv?.odooInvoiceName).toBe("F F00-1");
    expect(saleIdsFromInvoicePayload({ so_ids: [55257] })).toEqual([55257]);
    expect(saleNamesFromPayload({ so_names: ["10020263830"] })).toEqual(["10020263830"]);
    expect(quotePatchFromOdooEvent({ event: "picking_out_done", resId: 3, payload: { picking_name: "OUT/1" } })?.odooPickingState).toBe(
      "done",
    );
    expect(quotePatchFromOdooEvent({ event: "picking_in_done", resId: 8, payload: { picking_name: "IN/1" } })?.odooPickingInState).toBe(
      "done",
    );
    expect(
      quotePatchFromOdooEvent({
        event: "invoice_posted",
        resId: 9,
        payload: { invoice_name: "F F00-1", amount_total: 1416, invoice_date_due: "2026-10-21" },
      })?.installment,
    ).toMatchObject({ name: "F F00-1", amountTotal: 1416 });
  });
});
