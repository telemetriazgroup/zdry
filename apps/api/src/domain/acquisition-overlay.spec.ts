import { applyOverlays, normalizeOverlayConcepts, overlayAppliesTo } from "./acquisition-overlay";
import { computeListPrices, DEFAULT_PRICING_RULES } from "./pricing";

const piuraMove = {
  id: "1",
  key: "traslado_piura",
  label: "Traslado Piura",
  amount: 180,
  scope: "warehouse" as const,
  target: "PIURA",
  applies: "all" as const,
  active: true,
};

const vendorRisk = {
  id: "2",
  key: "riesgo_econtainers",
  label: "Riesgo ECONTAINERS",
  amount: 50,
  scope: "vendor" as const,
  target: "ECONTAINERS GLOBAL LLC",
  applies: "oc" as const,
  active: true,
};

describe("acquisition-overlay", () => {
  it("normaliza conceptos y aplica por plaza + vendor", () => {
    const concepts = normalizeOverlayConcepts([piuraMove, vendorRisk, { label: "x" }]);
    expect(concepts).toHaveLength(2);
    const piura = applyOverlays(
      { amount: 1325, kind: "fobCif" },
      { odooWarehouse: "PIURA", odooVendorName: "ECONTAINERS GLOBAL LLC" },
      concepts,
    );
    expect(piura.raw).toBe(1325);
    expect(piura.overlayTotal).toBe(230);
    expect(piura.base).toBe(1555);
    const zgrou = applyOverlays(
      { amount: 1325, kind: "fobCif" },
      { odooWarehouse: "ZGROU", odooVendorName: "ECONTAINERS GLOBAL LLC" },
      concepts,
    );
    expect(zgrou.overlayTotal).toBe(50);
    expect(zgrou.base).toBe(1375);
  });

  it("applies oc no suma sobre referencial; skipKeys apaga un concepto", () => {
    expect(overlayAppliesTo("oc", "referential")).toBe(false);
    expect(overlayAppliesTo("referential", "fobCif")).toBe(false);
    const skipped = applyOverlays(
      { amount: 1325, kind: "fobCif" },
      { odooWarehouse: "PIURA", overlaySkipKeys: ["traslado_piura"] },
      [piuraMove],
    );
    expect(skipped.overlayTotal).toBe(0);
    expect(skipped.base).toBe(1325);
  });

  it("one-off de ISO entra en la base; computeListPrices usa base ajustada", () => {
    const unit = {
      iso: "BMOU4335489",
      type: "40HC",
      cat: "CW",
      fobCif: 1325,
      odooWarehouse: "PIURA",
      overlayExtras: [{ label: "Interno no Odoo", amount: 20 }],
    };
    const p = computeListPrices(unit, DEFAULT_PRICING_RULES, null, [piuraMove]);
    expect(p.rawBase).toBe(1325);
    expect(p.overlayTotal).toBe(200);
    expect(p.base).toBe(1525);
    expect(p.priceList).toBe(Math.round(1525 / (1 - 0.22)));
  });
});
