import { shouldEnqueueOdoo } from "../deal-close/deal-close.types";
import {
  assertCanRegisterPedido,
  assertOdooQuoteForPedido,
  assertPedidoKeepsOdooDraft,
  canRegisterPedido,
  clientOrderDisplay,
  PEDIDO_VOUCHER_TRANSITIONS,
  pedidoEventDetail,
  pedidoRegistered,
  QuotePedidoError,
  requiresOdooQuoteForPedido,
} from "./quote-pedido";

describe("quote-pedido Q4", () => {
  it("el voucher no encola sale_close; pedido queda en ZDRY", () => {
    for (const [from, to] of PEDIDO_VOUCHER_TRANSITIONS) {
      expect(shouldEnqueueOdoo(from, to)).toBe(false);
      expect(() => assertPedidoKeepsOdooDraft(from, to)).not.toThrow();
    }
    expect(shouldEnqueueOdoo("pago_validado", "asignacion_confirmada")).toBe(true);
    expect(() => assertPedidoKeepsOdooDraft("pago_validado", "asignacion_confirmada")).toThrow(QuotePedidoError);
  });

  it("venta no demo exige el N° Odoo; alquiler/demo no", () => {
    expect(requiresOdooQuoteForPedido("venta", false)).toBe(true);
    expect(() => assertOdooQuoteForPedido("venta", false, null)).toThrow(/10020/);
    expect(() => assertOdooQuoteForPedido("venta", false, "10020263830")).not.toThrow();
    expect(() => assertOdooQuoteForPedido("alquiler", false, null)).not.toThrow();
    expect(() => assertOdooQuoteForPedido("venta", true, null)).not.toThrow();
  });

  it("cliente y comercial ven el mismo número de cotización Odoo", () => {
    expect(clientOrderDisplay("10020263830", "ZDRY-9")).toBe("10020263830");
    expect(clientOrderDisplay(null, "ZDRY-9")).toBe("ZDRY-9");
    expect(pedidoRegistered(0)).toBe(false);
    expect(pedidoRegistered(1)).toBe(true);
    expect(canRegisterPedido("reservada")).toBe(true);
    expect(canRegisterPedido("cotizada")).toBe(false);
    expect(() => assertCanRegisterPedido("cotizada")).toThrow(QuotePedidoError);
    expect(pedidoEventDetail("10020263830", "BCP", "123")).toMatch(/10020263830/);
    expect(pedidoEventDetail("10020263830", "BCP", "123")).toMatch(/purchase.order/);
  });
});
