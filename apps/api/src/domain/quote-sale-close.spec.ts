import { shouldEnqueueOdoo } from "../deal-close/deal-close.types";
import {
  assertCloseable,
  assertCloseDoesNotCreateSale,
  assertCloseDoesNotValidatePicking,
  assertHasLots,
  closeKwargs,
  equipoWriteValue,
  matchSolToIso,
  partnerVatOk,
  QuoteSaleCloseError,
  quoteSemaphore,
  SALE_CLOSE_EVENT,
} from "./quote-sale-close";

describe("quote-sale-close Q5", () => {
  it("shouldEnqueueOdoo sigue solo en asignación; confirma la SO ya creada", () => {
    expect(shouldEnqueueOdoo("pago_validado", "asignacion_confirmada")).toBe(true);
    expect(shouldEnqueueOdoo("comprobante_subido", "pago_validado")).toBe(false);
    expect(SALE_CLOSE_EVENT).toBe("sale_close");
    expect(() =>
      assertCloseable({
        kind: "venta",
        demo: false,
        odooSaleId: 55257,
        vat: "20521180774",
        lines: [{ iso: "BMOU1234567" }],
      }),
    ).not.toThrow();
    expect(() =>
      assertCloseable({ kind: "venta", demo: false, odooSaleId: null, vat: "20521180774", lines: [{ iso: "A" }] }),
    ).toThrow(/no crea/);
    expect(closeKwargs().context.zdry_sync).toBe(true);
    expect(() => assertCloseDoesNotCreateSale({ model: "sale.order", method: "create" })).toThrow(QuoteSaleCloseError);
    expect(() => assertCloseDoesNotValidatePicking("button_validate")).toThrow(/OUT/);
    expect(() => assertCloseDoesNotValidatePicking("action_confirm")).not.toThrow();
  });

  it("sin RUC o sin lote no confirma; alquiler/demo no cierran", () => {
    expect(partnerVatOk("20521180774")).toBe(true);
    expect(partnerVatOk("")).toBe(false);
    expect(() =>
      assertCloseable({ kind: "venta", demo: false, odooSaleId: 1, vat: "123", lines: [{ iso: "A" }] }),
    ).toThrow(/RUC/);
    expect(() =>
      assertCloseable({ kind: "alquiler", demo: false, odooSaleId: 1, vat: "20521180774", lines: [{ iso: "A" }] }),
    ).toThrow(/Q6/);
    expect(() => assertHasLots([{ iso: "BMOU1234567", lotId: null }])).toThrow(/a medias/);
    expect(() => assertHasLots([{ iso: "BMOU1234567", lotId: 88 }])).not.toThrow();
  });

  it("ata x_studio_equipo por ISO en el nombre de línea; flete no", () => {
    const matched = matchSolToIso(
      [
        { id: 10, name: "BMOU1234567 · CONTENEDOR DRY 20 DC", x_studio_tipo: "VENTA DE PRODUCTOS" },
        { id: 11, name: "Flete a Ica", x_studio_tipo: "VENTA DE SERVICIO - FLETE" },
      ],
      ["BMOU1234567"],
    );
    expect(matched).toEqual([{ lineId: 10, iso: "BMOU1234567" }]);
    expect(equipoWriteValue("many2one", 88, "BMOU1234567")).toBe(88);
    expect(equipoWriteValue("char", 88, "BMOU1234567")).toBe("BMOU1234567");
  });

  it("semáforo confirmada / facturada / OUT sin vaciar patio", () => {
    expect(quoteSemaphore({ odooSaleId: 1, odooState: "draft" })).toEqual({
      quoted: true,
      confirmed: false,
      invoiced: false,
      dispatchedOdoo: false,
    });
    expect(
      quoteSemaphore({
        odooSaleId: 1,
        odooState: "sale",
        odooInvoiceName: "F F00-1",
        odooInvoiceStatus: "invoiced",
        odooPickingState: "assigned",
      }),
    ).toMatchObject({ confirmed: true, invoiced: true, dispatchedOdoo: false });
  });
});
