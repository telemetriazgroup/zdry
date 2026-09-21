import { defaultQuoteIssueConfig, quoteIssueReady } from "./odoo-quote-issue";
import {
  amendConflictBody,
  amendWriteVals,
  assertCanAmendOdoo,
  buildAmendLines,
  canAmendOdoo,
  expectedAmendAmounts,
  QuoteAmendError,
  replaceOrderLineCommands,
  snapshotDiff,
  totalChanged,
} from "./quote-amend";

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
  const flete = cfg.products.find((p) => p.key === "flete");
  if (flete) flete.productId = 9001;
  return cfg;
}

describe("quote-amend Q4b", () => {
  it("draft y sent se pueden enmendar; sale devuelve 409 + odooUrl", () => {
    expect(canAmendOdoo("draft")).toBe(true);
    expect(canAmendOdoo("sent")).toBe(true);
    expect(canAmendOdoo("sale")).toBe(false);
    const url = "https://odoo.example/web#id=55257&model=sale.order&view_type=form";
    try {
      assertCanAmendOdoo("sale", url);
      throw new Error("expected");
    } catch (e) {
      expect(e).toBeInstanceOf(QuoteAmendError);
      const body = amendConflictBody(e as QuoteAmendError);
      expect(body.error).toBe("odoo_confirmed");
      expect(body.odooUrl).toBe(url);
      expect(body.message).toMatch(/confirmada/);
    }
  });

  it("descuento −5 % y flete llegan como write de la misma SO (command 5 + líneas)", () => {
    const cfg = readyCfg();
    expect(quoteIssueReady(cfg).ok).toBe(true);
    const lines = buildAmendLines(
      cfg,
      [{ iso: "BMOU1234567", type: "20GP", cat: "CW", priceNet: 3325 }],
      [{ kind: "freight", label: "Flete a Ica", amount: 400 }],
    );
    expect(lines[0].priceUnit).toBe(3325);
    expect(lines[1].lineType).toBe("VENTA DE SERVICIO - FLETE");
    expect(lines[1].productId).toBe(9001);
    const cmds = replaceOrderLineCommands(lines);
    expect(cmds[0]).toEqual([5, 0, 0]);
    const freightVals = (cmds[2] as unknown[])[2] as Record<string, unknown>;
    expect(freightVals.x_studio_tipo).toBe("VENTA DE SERVICIO - FLETE");
    expect(freightVals.price_unit).toBe(400);
    expect(freightVals.tax_id).toEqual([[6, 0, [325]]]);
    const vals = amendWriteVals(lines);
    expect(vals).not.toHaveProperty("state");
    expect(vals).not.toHaveProperty("action_confirm");
    const expected = expectedAmendAmounts(lines);
    expect(expected.untaxed).toBe(3725);
    expect(expected.tax).toBe(670.5);
    expect(expected.total).toBe(4395.5);
  });

  it("cliente retira: no hay línea de flete; flete sin producto Q0 falla", () => {
    const cfg = readyCfg();
    const pickup = buildAmendLines(cfg, [{ iso: "BMOU1234567", type: "20GP", cat: "CW", priceNet: 3500 }], [
      { kind: "freight", label: "Flete", amount: 400 },
    ], true);
    expect(pickup).toHaveLength(1);
    const bare = defaultQuoteIssueConfig();
    bare.taxId = 325;
    bare.products[0].productId = 5800;
    expect(() =>
      buildAmendLines(bare, [{ iso: "BMOU1234567", type: "20GP", cat: "CW", priceNet: 3500 }], [
        { kind: "freight", label: "Flete", amount: 400 },
      ]),
    ).toThrow(QuoteAmendError);
  });

  it("diff source=zdry marca total y líneas; no inventa cambio de state", () => {
    const before = {
      state: "draft",
      invoiceStatus: "no",
      amountUntaxed: 3500,
      amountTax: 630,
      amountTotal: 4130,
      lines: [{ name: "DRY", qty: 1, priceUnit: 3500 }],
    };
    const after = {
      ...before,
      amountUntaxed: 3325,
      amountTax: 598.5,
      amountTotal: 3923.5,
      lines: [{ name: "DRY", qty: 1, priceUnit: 3325 }],
    };
    const diff = snapshotDiff(before, after);
    expect(diff.state).toBeUndefined();
    expect(diff.amountTotal).toEqual({ before: 4130, after: 3923.5 });
    expect(totalChanged(4130, 3923.5)).toBe(true);
    expect(totalChanged(4130, 4130)).toBe(false);
  });
});
