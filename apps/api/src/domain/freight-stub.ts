/** Estimado de flete del catálogo (stub S4). Oráculo: freightConsolidatedEstimate + zonas del HTML.
 * S7 reemplazará km fijos por DistanceProvider; la fórmula de terreno/camiones se conserva.
 */

export const FREIGHT_BASE_FEE = 80;
export const FREIGHT_SIZE_FEE = { big: 126, small: 93 };
export const FREIGHT_VEHICLE_MULT: Record<string, number> = { cama_baja: 1, grua_huinche: 1.35, estandar: 0.85 };
export const FREIGHT_VEHICLE_LABELS: Record<string, string> = {
  cama_baja: "Cama baja / plataforma (estándar)",
  grua_huinche: "Grúa huinche (carga/descarga sin equipo en destino)",
  estandar: "Camión estándar (más económico)",
};
export const FREIGHT_MIN_MARGIN_PCT = 15;

export const TERRAIN_PROFILES: Record<string, { label: string; avgSpeedKmh: number; ratePerKm: number; ratePerHour: number; roadFactor: number }> = {
  urbano: { label: "Urbano — Lima y Callao (tráfico de ciudad)", avgSpeedKmh: 28, ratePerKm: 2.6, ratePerHour: 38, roadFactor: 1.35 },
  costa: { label: "Costa — Panamericana (asfaltada, llano)", avgSpeedKmh: 72, ratePerKm: 2.9, ratePerHour: 42, roadFactor: 1.15 },
  sierra: { label: "Sierra — vía de montaña (curvas, altura, clima)", avgSpeedKmh: 40, ratePerKm: 3.7, ratePerHour: 58, roadFactor: 1.55 },
  selva: { label: "Selva — vía afirmada / trocha (clima, difícil acceso)", avgSpeedKmh: 32, ratePerKm: 4.4, ratePerHour: 68, roadFactor: 1.65 },
};

export type FreightZone = {
  id: string;
  name: string;
  type: "distrito" | "provincia";
  km: number;
  terrain: string;
};

export const FREIGHT_ZONES: FreightZone[] = [
  { id: "fz1", name: "Callao", type: "distrito", km: 5, terrain: "urbano" },
  { id: "fz5", name: "San Isidro", type: "distrito", km: 22, terrain: "urbano" },
  { id: "fz6", name: "Miraflores", type: "distrito", km: 25, terrain: "urbano" },
  { id: "fz34", name: "Los Olivos", type: "distrito", km: 22, terrain: "urbano" },
  { id: "fz12", name: "Lurín", type: "distrito", km: 45, terrain: "urbano" },
  { id: "fz14", name: "Arequipa", type: "provincia", km: 1020, terrain: "costa" },
  { id: "fz17", name: "Cusco", type: "provincia", km: 1100, terrain: "sierra" },
  { id: "fz19", name: "Huancayo", type: "provincia", km: 300, terrain: "sierra" },
  { id: "fz20", name: "Ica", type: "provincia", km: 300, terrain: "costa" },
  { id: "fz59", name: "Pucallpa", type: "provincia", km: 840, terrain: "selva" },
];

export function trucksNeededFor(units: { type: string }[]): number {
  const count20 = units.filter((c) => c.type.startsWith("20")).length;
  const countBig = units.filter((c) => !c.type.startsWith("20")).length;
  return Math.ceil(count20 / 2) + countBig;
}

export function freightConsolidatedEstimate(units: { type: string }[], zoneId: string, vehicle = "cama_baja") {
  const zone = FREIGHT_ZONES.find((z) => z.id === zoneId);
  if (!zone || !units.length) return null;
  const tp = TERRAIN_PROFILES[zone.terrain] || TERRAIN_PROFILES.costa;
  const vMult = FREIGHT_VEHICLE_MULT[vehicle] != null ? FREIGHT_VEHICLE_MULT[vehicle] : 1;
  const hours = zone.km / (tp.avgSpeedKmh || 50);
  const distanceCost = zone.km * tp.ratePerKm * vMult;
  const timeCost = hours * tp.ratePerHour * vMult;
  const perTruck = FREIGHT_BASE_FEE + distanceCost + timeCost;
  const trucks = trucksNeededFor(units);
  const days = Math.max(1, Math.ceil(hours / 8)) + (zone.type === "distrito" ? 0 : 1);
  const cost = Math.round(perTruck * trucks);
  const minSell = Math.round(cost * (1 + FREIGHT_MIN_MARGIN_PCT / 100));
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    terrain: zone.terrain,
    km: zone.km,
    hours: Math.round(hours * 10) / 10,
    trucks,
    days,
    cost,
    minSell,
    distanceSource: "zone_table" as const,
    vehicle,
  };
}

export function detectZoneFromText(text: string): FreightZone | null {
  const norm = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!norm) return null;
  let best: FreightZone | null = null;
  for (const z of FREIGHT_ZONES) {
    const zn = z.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (zn.length >= 3 && norm.includes(zn)) {
      if (!best || zn.length > best.name.length) best = z;
    }
  }
  return best;
}

export const FREE_MOVES = 3;
export const MOVEMENT_RATE = 25;
