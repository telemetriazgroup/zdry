export type ExitVerdict =
  | "debajo"
  | "en_rango"
  | "encima"
  | "bajo_inventario"
  | "igual_inventario"
  | "sobre_inventario"
  | "alquiler"
  | "sin_cotizacion"
  | "sin_precio";

export function exitOriginLabel(row: {
  odooIntakeKind?: string | null;
  odooPoName?: string | null;
  costSource?: string | null;
}): string {
  const kind = String(row.odooIntakeKind || "");
  if (kind === "purchase" && row.odooPoName) return row.odooPoName;
  if (row.odooPoName && kind !== "fabrication" && kind !== "adjustment") return row.odooPoName;
  if (kind === "adjustment" || row.costSource === "adjustment" || row.costSource === "referential") return "Ajuste";
  if (kind === "fabrication") return "Fabricación";
  return row.costSource || "Sin OC";
}

export function judgeExitDeal(input: {
  priceSource?: string | null;
  soldNet: number | null;
  kind: "venta" | "alquiler" | null;
  ruleMin: number;
  ruleList: number;
  inventoryList: number | null;
}): {
  verdict: ExitVerdict;
  comparedTo: "inventario" | "regla" | "ninguno";
  referenceMin: number | null;
  referenceList: number | null;
  result: number | null;
  resultKind: "margen_venta" | "ingreso_alquiler" | "sin_cierre";
} {
  if (!input.kind || input.soldNet == null || !Number.isFinite(input.soldNet)) {
    return {
      verdict: input.kind ? "sin_precio" : "sin_cotizacion",
      comparedTo: "ninguno",
      referenceMin: null,
      referenceList: null,
      result: null,
      resultKind: "sin_cierre",
    };
  }
  if (input.kind === "alquiler") {
    return {
      verdict: "alquiler",
      comparedTo: "ninguno",
      referenceMin: input.ruleMin,
      referenceList: input.ruleList,
      result: Math.round(input.soldNet),
      resultKind: "ingreso_alquiler",
    };
  }
  const sold = Math.round(input.soldNet);
  const manual = input.priceSource === "manual" && input.inventoryList != null && input.inventoryList > 0;
  if (manual) {
    const list = Math.round(input.inventoryList || 0);
    const verdict: ExitVerdict = sold < list ? "bajo_inventario" : sold > list ? "sobre_inventario" : "igual_inventario";
    return {
      verdict,
      comparedTo: "inventario",
      referenceMin: list,
      referenceList: list,
      result: null,
      resultKind: "margen_venta",
    };
  }
  const min = Math.round(input.ruleMin);
  const list = Math.round(input.ruleList);
  const verdict: ExitVerdict = sold < min ? "debajo" : sold > list ? "encima" : "en_rango";
  return {
    verdict,
    comparedTo: "regla",
    referenceMin: min,
    referenceList: list,
    result: null,
    resultKind: "margen_venta",
  };
}

export function saleMargin(soldNet: number | null, costBase: number, kind: "venta" | "alquiler" | null): number | null {
  if (soldNet == null || !Number.isFinite(soldNet)) return null;
  if (kind === "alquiler") return Math.round(soldNet);
  if (kind !== "venta") return null;
  return Math.round(soldNet - costBase);
}

export const EXIT_VERDICT_LABEL: Record<ExitVerdict, string> = {
  debajo: "Debajo del piso calculado",
  en_rango: "Dentro del rango calculado",
  encima: "Por encima de la lista calculada",
  bajo_inventario: "Debajo del precio de inventario",
  igual_inventario: "En el precio de inventario",
  sobre_inventario: "Por encima del precio de inventario",
  alquiler: "Alquiler: ingreso del contrato",
  sin_cotizacion: "Salida sin cotización ZDRY",
  sin_precio: "Sin precio de cierre",
};
