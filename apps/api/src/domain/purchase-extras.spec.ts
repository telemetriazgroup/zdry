import { defaultPurchaseExtras, normalizePurchaseExtras } from "./purchase-extras";

describe("extras de compra por logística", () => {
  it("reentrega: solo agente de aduana", () => {
    const extras = defaultPurchaseExtras("reentrega");
    expect(extras.agente_aduana.enabled).toBe(true);
    expect(extras.transporte.enabled).toBe(false);
    expect(extras.gate_out.enabled).toBe(false);
  });

  it("recojo con flete y gate out: transporte y gate out pendientes", () => {
    const extras = defaultPurchaseExtras("recojo_flete_gateout");
    expect(extras.agente_aduana.enabled).toBe(true);
    expect(extras.transporte.enabled).toBe(true);
    expect(extras.gate_out.enabled).toBe(true);
    expect(extras.thc.enabled).toBe(false);
  });

  it("no permite desmarcar el agente de aduana", () => {
    const extras = normalizePurchaseExtras("recojo_flete", {
      agente_aduana: { enabled: false },
      transporte: { enabled: false },
    });
    expect(extras.agente_aduana.enabled).toBe(true);
    expect(extras.transporte.enabled).toBe(false);
  });
});
