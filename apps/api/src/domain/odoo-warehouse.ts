/**
 * Capa A: plaza Odoo (ZGROU / PIURA) — extras de costo.
 * Capa B: patio ZDRY (Piura · Principal · Gambeta 1/2) — coordinador.
 * Ver docs/caso_extra_almacenes.md
 */

export const ODOO_WAREHOUSE_ZGROU = "ZGROU";
export const ODOO_WAREHOUSE_PIURA = "PIURA";

export type OdooWarehouseCode = typeof ODOO_WAREHOUSE_ZGROU | typeof ODOO_WAREHOUSE_PIURA | string;

export const PATIO_PIURA = "piura";
export const PATIO_PRINCIPAL = "principal";
export const PATIO_GAMBETA_1 = "gambeta_1";
export const PATIO_GAMBETA_2 = "gambeta_2";
export const PATIO_CALLAO_PENDING = "callao_pendiente";

export type PatioCode =
  | typeof PATIO_PIURA
  | typeof PATIO_PRINCIPAL
  | typeof PATIO_GAMBETA_1
  | typeof PATIO_GAMBETA_2
  | typeof PATIO_CALLAO_PENDING;

export type PatioDef = {
  code: PatioCode;
  name: string;
  city: string;
  odooWarehouse: string;
  pending?: boolean;
  address: string;
};

export const OPERATIONAL_PATIOS: PatioDef[] = [
  {
    code: PATIO_PIURA,
    name: "Almacén Piura",
    city: "Piura",
    odooWarehouse: ODOO_WAREHOUSE_PIURA,
    address: "Piura / Existencias",
  },
  {
    code: PATIO_PRINCIPAL,
    name: "Principal",
    city: "Callao",
    odooWarehouse: ODOO_WAREHOUSE_ZGROU,
    address: "Callao — Principal",
  },
  {
    code: PATIO_GAMBETA_1,
    name: "Gambeta 1",
    city: "Callao",
    odooWarehouse: ODOO_WAREHOUSE_ZGROU,
    address: "Av. Néstor Gambetta — patio 1",
  },
  {
    code: PATIO_GAMBETA_2,
    name: "Gambeta 2",
    city: "Callao",
    odooWarehouse: ODOO_WAREHOUSE_ZGROU,
    address: "Av. Néstor Gambetta — patio 2",
  },
  {
    code: PATIO_CALLAO_PENDING,
    name: "Callao — por asignar",
    city: "Callao",
    odooWarehouse: ODOO_WAREHOUSE_ZGROU,
    pending: true,
    address: "ZGROU/Existencias (sin patio fino)",
  },
];

export const ODOO_WAREHOUSE_LABELS: Record<string, string> = {
  [ODOO_WAREHOUSE_ZGROU]: "ZGROU / Callao",
  [ODOO_WAREHOUSE_PIURA]: "Piura",
};

export function warehouseFromLocation(locationName: string | null | undefined): string {
  const first = String(locationName || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)[0] || "";
  const compact = first.toUpperCase().replace(/\s+/g, "");
  if (!compact) return "";
  if (compact.startsWith("PIURA") || compact === "SULLANA") return ODOO_WAREHOUSE_PIURA;
  if (compact.startsWith("ZGROU") || compact === "CALLAO" || compact.includes("ZGROUP")) return ODOO_WAREHOUSE_ZGROU;
  return compact;
}

export function patioDef(code: string | null | undefined): PatioDef | undefined {
  return OPERATIONAL_PATIOS.find((p) => p.code === code);
}

export function defaultPatioCode(warehouse: string | null | undefined): PatioCode | null {
  const w = String(warehouse || "").toUpperCase();
  if (w === ODOO_WAREHOUSE_PIURA) return PATIO_PIURA;
  if (w === ODOO_WAREHOUSE_ZGROU) return PATIO_CALLAO_PENDING;
  return null;
}

export function zgrouPatioCodes(): PatioCode[] {
  return [PATIO_PRINCIPAL, PATIO_GAMBETA_1, PATIO_GAMBETA_2];
}

export function needsPatioChoice(warehouse: string | null | undefined, depotCode: string | null | undefined): boolean {
  if (String(warehouse || "").toUpperCase() !== ODOO_WAREHOUSE_ZGROU) return false;
  const code = String(depotCode || "");
  if (zgrouPatioCodes().includes(code as PatioCode)) return false;
  return true;
}

export function isZgrouAssignablePatio(depotCode: string | null | undefined): boolean {
  return zgrouPatioCodes().includes(String(depotCode || "") as PatioCode);
}

export function warehouseLabel(code: string | null | undefined): string {
  const c = String(code || "").toUpperCase();
  return ODOO_WAREHOUSE_LABELS[c] || c || "—";
}
