import { applyOverlays } from "./acquisition-overlay";
import {
  defaultPatioCode,
  isZgrouAssignablePatio,
  needsPatioChoice,
  PATIO_CALLAO_PENDING,
  PATIO_GAMBETA_1,
  PATIO_PIURA,
  PATIO_PRINCIPAL,
  planWarehouseMove,
  warehouseFromLocation,
  warehouseLabel,
} from "./odoo-warehouse";

describe("odoo-warehouse", () => {
  it("extrae plaza Odoo del path de existencias", () => {
    expect(warehouseFromLocation("ZGROU/Existencias")).toBe("ZGROU");
    expect(warehouseFromLocation("Piura/Existencias")).toBe("PIURA");
    expect(warehouseFromLocation("PIURA / Existencias")).toBe("PIURA");
    expect(warehouseFromLocation("")).toBe("");
  });

  it("mapea patio por defecto: Piura 1:1, ZGROU pendiente", () => {
    expect(defaultPatioCode("PIURA")).toBe(PATIO_PIURA);
    expect(defaultPatioCode("ZGROU")).toBe(PATIO_CALLAO_PENDING);
    expect(defaultPatioCode("")).toBeNull();
  });

  it("ZGROU exige elegir Principal o Gambeta si aún está pendiente", () => {
    expect(needsPatioChoice("ZGROU", PATIO_CALLAO_PENDING)).toBe(true);
    expect(needsPatioChoice("ZGROU", PATIO_PRINCIPAL)).toBe(false);
    expect(needsPatioChoice("ZGROU", PATIO_GAMBETA_1)).toBe(false);
    expect(needsPatioChoice("PIURA", PATIO_PIURA)).toBe(false);
    expect(isZgrouAssignablePatio(PATIO_PRINCIPAL)).toBe(true);
    expect(isZgrouAssignablePatio(PATIO_CALLAO_PENDING)).toBe(false);
  });

  it("etiqueta plazas", () => {
    expect(warehouseLabel("PIURA")).toMatch(/Piura/);
    expect(warehouseLabel("ZGROU")).toMatch(/ZGROU/);
  });

  it("un traslado ZGROU → Piura cambia la plaza de costo y el patio", () => {
    const plan = planWarehouseMove({ locationName: "Piura/Existencias", odooWarehouse: "ZGROU" });
    expect(plan.warehouseChanged).toBe(true);
    expect(plan.warehouse).toBe("PIURA");
    expect(plan.depotCode).toBe(PATIO_PIURA);
  });

  it("salir de Piura hacia ZGROU deja el patio Callao por asignar", () => {
    const plan = planWarehouseMove({ locationName: "ZGROU/Existencias", odooWarehouse: "PIURA" });
    expect(plan.warehouse).toBe("ZGROU");
    expect(plan.depotCode).toBe(PATIO_CALLAO_PENDING);
  });

  it("la misma plaza no mueve el patio fino", () => {
    const plan = planWarehouseMove({ locationName: "ZGROU/Existencias", odooWarehouse: "ZGROU" });
    expect(plan.warehouseChanged).toBe(false);
    expect(plan.depotCode).toBeNull();
  });

  it("Tracking de Piura no entra mientras la plaza guardada sigue en ZGROU", () => {
    const tracking = {
      id: "t",
      key: "tracking_piura",
      label: "Tracking Piura",
      amount: 30,
      scope: "warehouse" as const,
      target: "PIURA",
      applies: "all" as const,
      active: true,
    };
    const before = applyOverlays({ amount: 500, kind: "fobCif" }, { odooWarehouse: "ZGROU" }, [tracking]);
    expect(before.overlayTotal).toBe(0);
    const plan = planWarehouseMove({ locationName: "Piura/Existencias", odooWarehouse: "ZGROU" });
    const after = applyOverlays({ amount: 500, kind: "fobCif" }, { odooWarehouse: plan.warehouse }, [tracking]);
    expect(after.overlayTotal).toBe(30);
    expect(after.base).toBe(530);
  });
});
