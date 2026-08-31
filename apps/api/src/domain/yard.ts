/**
 * Layout de patio — copiado 1:1 de zdry_prototype_26.html
 * (sizeGroup, columnCompatible, bestSlotFor, onYardCellClick messages).
 * Las funciones reciben ocupantes + config + reglas para poder testearse sin BD.
 */

export const DEFAULT_YARD_CONFIG = {
  lados: ["Izquierda", "Derecha"] as const,
  rumas: 5,
  columnas: 3,
  niveles: 5,
};

export type YardConfig = {
  lados: readonly string[];
  rumas: number;
  columnas: number;
  niveles: number;
};

export const DEFAULT_LAYOUT_RULES = {
  minNivel: 3,
  maxNivel: 5,
  groupCategoria: true,
  groupProveedor: false,
};

export type LayoutRules = {
  minNivel: number;
  maxNivel: number;
  groupCategoria: boolean;
  groupProveedor: boolean;
};

export type YardUnit = {
  iso: string;
  type: string;
  cat: string;
  manufacturer?: string | null;
  depotId: string;
  lado: string | null;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
  status: string;
  physicallyReceived?: boolean;
};

export type YardSlot = {
  lado: string;
  ruma: number;
  columna: number;
  nivel: number;
  consolidating: boolean;
};

export type MoveResult =
  | { ok: true }
  | { ok: false; code: "YARD_BLOCKED_COLUMN" | "YARD_MIX" | "YARD_GRAVITY"; message: string };

export function sizeGroup(type: string): string {
  if (type.startsWith("20")) return "20";
  if (type.startsWith("40")) return "40";
  if (type === "45HC") return "45";
  return type;
}

export function newnessTier(cat: string): "nuevo" | "usado" {
  return cat === "1TRIP" ? "nuevo" : "usado";
}

export function columnOccupants(
  occupants: YardUnit[],
  depotId: string,
  lado: string,
  ruma: number,
  columna: number,
): YardUnit[] {
  // No se filtra por status: una unidad Vendida/Alquilada que aún no salió físicamente
  // sigue ocupando su celda.
  return occupants.filter(
    (x) => x.depotId === depotId && x.lado === lado && x.ruma === ruma && x.columna === columna,
  );
}

export function columnMaxNivel(config: YardConfig, rules: LayoutRules): number {
  return Math.min(rules.maxNivel || config.niveles, config.niveles);
}

export function columnIsFull(
  occupants: YardUnit[],
  depotId: string,
  lado: string,
  ruma: number,
  columna: number,
  config: YardConfig,
  rules: LayoutRules,
): boolean {
  return columnOccupants(occupants, depotId, lado, ruma, columna).length >= columnMaxNivel(config, rules);
}

export function columnUsable(
  occupants: YardUnit[],
  depotId: string,
  lado: string,
  ruma: number,
  columna: number,
  config: YardConfig,
  rules: LayoutRules,
): boolean {
  if (columna <= 1) return true;
  return columnIsFull(occupants, depotId, lado, ruma, columna - 1, config, rules);
}

export function columnCompatible(
  occupants: YardUnit[],
  depotId: string,
  lado: string,
  ruma: number,
  columna: number,
  type: string,
  cat: string,
  manufacturer: string | null | undefined,
  config: YardConfig,
  rules: LayoutRules,
): boolean {
  if (!columnUsable(occupants, depotId, lado, ruma, columna, config, rules)) return false;
  const occ = columnOccupants(occupants, depotId, lado, ruma, columna);
  if (!occ.length) return true;
  return occ.every((o) => {
    if (sizeGroup(o.type) !== sizeGroup(type)) return false;
    if (rules.groupCategoria && newnessTier(o.cat) !== newnessTier(cat)) return false;
    if (rules.groupProveedor && manufacturer != null && o.manufacturer !== manufacturer) return false;
    return true;
  });
}

export function columnFillStatus(
  occupants: YardUnit[],
  depotId: string,
  lado: string,
  ruma: number,
  columna: number,
  config: YardConfig,
  rules: LayoutRules,
): "bloqueada" | "vacía" | "en llenado" | "óptima" | "llena" {
  const n = columnOccupants(occupants, depotId, lado, ruma, columna).length;
  const max = columnMaxNivel(config, rules);
  if (!columnUsable(occupants, depotId, lado, ruma, columna, config, rules)) return "bloqueada";
  if (n === 0) return "vacía";
  if (n >= max) return "llena";
  if (n < rules.minNivel) return "en llenado";
  return "óptima";
}

export function nextNivelInColumn(
  occupants: YardUnit[],
  depotId: string,
  lado: string,
  ruma: number,
  columna: number,
  config: YardConfig,
  rules: LayoutRules,
): number | null {
  if (!columnUsable(occupants, depotId, lado, ruma, columna, config, rules)) return null;
  const occ = columnOccupants(occupants, depotId, lado, ruma, columna);
  const max = columnMaxNivel(config, rules);
  if (!occ.length) return 1;
  const maxNivel = Math.max(...occ.map((o) => o.nivel || 0));
  return maxNivel < max ? maxNivel + 1 : null;
}

export function availableSlotsFor(
  occupants: YardUnit[],
  depotId: string,
  type: string,
  cat: string,
  manufacturer: string | null | undefined,
  config: YardConfig,
  rules: LayoutRules,
): YardSlot[] {
  const slots: YardSlot[] = [];
  for (const lado of config.lados) {
    for (let ruma = 1; ruma <= config.rumas; ruma++) {
      for (let columna = 1; columna <= config.columnas; columna++) {
        if (!columnCompatible(occupants, depotId, lado, ruma, columna, type, cat, manufacturer, config, rules)) {
          continue;
        }
        const nivel = nextNivelInColumn(occupants, depotId, lado, ruma, columna, config, rules);
        if (nivel == null) continue;
        slots.push({
          lado,
          ruma,
          columna,
          nivel,
          consolidating: columnOccupants(occupants, depotId, lado, ruma, columna).length > 0,
        });
      }
    }
  }
  slots.sort((a, b) => Number(b.consolidating) - Number(a.consolidating));
  return slots;
}

/** Oráculo HTML: bestSlotFor(depotId, type, cat) — no pasa manufacturer. */
export function bestSlotFor(
  occupants: YardUnit[],
  depotId: string,
  type: string,
  cat: string,
  config: YardConfig = DEFAULT_YARD_CONFIG,
  rules: LayoutRules = DEFAULT_LAYOUT_RULES,
): YardSlot | null {
  const slots = availableSlotsFor(occupants, depotId, type, cat, undefined, config, rules);
  return slots.length ? slots[0] : null;
}

export function posLabel(c: { lado?: string | null; ruma?: number | null; columna?: number | null; nivel?: number | null }): string {
  return c.lado
    ? `Lado ${c.lado} · Ruma ${c.ruma} · Columna ${c.columna} · Nivel ${c.nivel}`
    : "Sin posición asignada";
}

export function containerCommitted(c: { status: string; lado?: string | null }): boolean {
  return (c.status === "Vendido" || c.status === "Alquilado") && !!c.lado;
}

export function needsYardPlacement(c: {
  physicallyReceived?: boolean;
  lado?: string | null;
  status: string;
}): boolean {
  return (
    !!c.physicallyReceived &&
    !c.lado &&
    !["Vendido", "Alquilado", "Retirado por cliente"].includes(c.status)
  );
}

export function movesToRetrieve(occupants: YardUnit[], c: YardUnit): number {
  if (!c.lado) return 0;
  return occupants.filter(
    (x) =>
      x.iso !== c.iso &&
      x.depotId === c.depotId &&
      x.lado === c.lado &&
      x.ruma === c.ruma &&
      x.columna === c.columna &&
      (x.nivel || 0) > (c.nivel || 0),
  ).length;
}

export function compactYardGravity(
  occupants: YardUnit[],
  config: YardConfig = DEFAULT_YARD_CONFIG,
): { iso: string; fromNivel: number; toNivel: number; lado: string; ruma: number; columna: number; depotId: string }[] {
  const changes: {
    iso: string;
    fromNivel: number;
    toNivel: number;
    lado: string;
    ruma: number;
    columna: number;
    depotId: string;
  }[] = [];
  const depots = [...new Set(occupants.map((o) => o.depotId))];
  for (const depotId of depots) {
    for (const lado of config.lados) {
      for (let ruma = 1; ruma <= config.rumas; ruma++) {
        for (let columna = 1; columna <= config.columnas; columna++) {
          const occ = columnOccupants(occupants, depotId, lado, ruma, columna).sort(
            (a, b) => (a.nivel || 0) - (b.nivel || 0),
          );
          occ.forEach((c, idx) => {
            const toNivel = idx + 1;
            if ((c.nivel || 0) !== toNivel) {
              changes.push({
                iso: c.iso,
                fromNivel: c.nivel || 0,
                toNivel,
                lado,
                ruma,
                columna,
                depotId,
              });
              c.nivel = toNivel;
            }
          });
        }
      }
    }
  }
  return changes;
}

export function blockedColumnMessage(columna: number, maxNivel: number): string {
  return `Columna ${columna} bloqueada: la columna anterior (Columna ${columna - 1}) debe llenarse por completo (${maxNivel} niveles) antes de habilitar esta.`;
}

export function mixMoveMessage(
  iso: string,
  lado: string,
  ruma: number,
  columna: number,
  rules: LayoutRules,
): string {
  return `No se puede mover ${iso} a Lado ${lado} · Ruma ${ruma} · Columna ${columna}: esa columna tiene contenedores de otro tamaño${rules.groupCategoria ? ", de distinta condición (nuevo/usado)" : ""}${rules.groupProveedor ? " o de otro fabricante" : ""}. No se pueden mezclar en la misma columna según las reglas de agrupación activas.`;
}

export function gravityMessage(expectedNivel: number | null): string {
  return `Esa celda no es la siguiente posición libre de esa columna. Debes apilar en Nivel ${expectedNivel || "—"}.`;
}

export function placeSuccessMessage(iso: string, lado: string, ruma: number, columna: number, nivel: number): string {
  return `✓ ${iso} movido/asignado a Lado ${lado} · Ruma ${ruma} · Columna ${columna} · Nivel ${nivel}.`;
}

/** Único validador de un movimiento/asignación de celda. No escribe. */
export function validateMove(
  occupants: YardUnit[],
  unit: YardUnit,
  depotId: string,
  lado: string,
  ruma: number,
  columna: number,
  nivel: number,
  config: YardConfig = DEFAULT_YARD_CONFIG,
  rules: LayoutRules = DEFAULT_LAYOUT_RULES,
): MoveResult {
  if (!columnUsable(occupants, depotId, lado, ruma, columna, config, rules)) {
    return {
      ok: false,
      code: "YARD_BLOCKED_COLUMN",
      message: blockedColumnMessage(columna, columnMaxNivel(config, rules)),
    };
  }
  if (
    !columnCompatible(
      occupants,
      depotId,
      lado,
      ruma,
      columna,
      unit.type,
      unit.cat,
      unit.manufacturer,
      config,
      rules,
    )
  ) {
    return {
      ok: false,
      code: "YARD_MIX",
      message: mixMoveMessage(unit.iso, lado, ruma, columna, rules),
    };
  }
  const expectedNivel = nextNivelInColumn(occupants, depotId, lado, ruma, columna, config, rules);
  if (expectedNivel !== nivel) {
    return {
      ok: false,
      code: "YARD_GRAVITY",
      message: gravityMessage(expectedNivel),
    };
  }
  return { ok: true };
}

export function defaultCbm(type: string): number {
  if (type.startsWith("20")) return 33.2;
  if (type === "45HC") return 86.1;
  if (type.includes("HC")) return 76.3;
  return 67.7;
}

export const LAYOUT_STATUS_COLOR: Record<string, string> = {
  bloqueada: "#adb5bd",
  vacía: "#8a90a2",
  "en llenado": "#c9720b",
  óptima: "#2f9e44",
  llena: "#1971c2",
};

export function inspectDataMissing(c: { year?: number | null; manufacturer?: string | null }): string[] {
  const reasons: string[] = [];
  if (!c.year) reasons.push("Falta año");
  if (!c.manufacturer || c.manufacturer === "—") reasons.push("Falta fabricante");
  return reasons;
}

export function inspectMissing(c: {
  physicallyReceived?: boolean;
  year?: number | null;
  manufacturer?: string | null;
}): string[] {
  const reasons: string[] = [];
  if (!c.physicallyReceived) reasons.push("Pendiente de ingreso físico");
  return reasons.concat(inspectDataMissing(c));
}

export function intakeTypeLabel(intakeType: string): string {
  return (
    (
      {
        compra: "Compra",
        almacenaje_cliente: "Almacenaje de cliente",
        pendiente_factura: "Compra (factura pendiente)",
      } as Record<string, string>
    )[intakeType] || intakeType || "—"
  );
}

export const PHOTO_LABELS = [
  "Frontal (puertas)",
  "Posterior (panel ciego)",
  "Lateral izquierdo",
  "Lateral derecho",
  "Techo exterior",
  "Interior (piso)",
  "Interior (semi-cerrada)",
  "Placa CSC",
  "Sellos de puerta",
];

export const CONTAINER_COLORS = [
  "Blanco",
  "Gris",
  "Verde",
  "Azul",
  "Rojo",
  "Naranja",
  "Marrón",
  "Beige",
  "Corten (óxido natural)",
];

export const DEPOT_SERVICE_RATES = {
  gate_in: 30,
  gate_out: 30,
  reparacion: 120,
  lavado: 45,
  movimiento: 25,
};

export function normalizeLayoutRules(raw: unknown): LayoutRules {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const minNivel = clampInt(src.minNivel, 1, 5, DEFAULT_LAYOUT_RULES.minNivel);
  const maxNivel = clampInt(src.maxNivel, minNivel, 5, DEFAULT_LAYOUT_RULES.maxNivel);
  return {
    minNivel,
    maxNivel,
    groupCategoria: src.groupCategoria !== false,
    groupProveedor: src.groupProveedor === true,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
