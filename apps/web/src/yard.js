/** Layout de patio — espejo de apps/api/src/domain/yard.ts / prototipo HTML. */

export const DEFAULT_YARD_CONFIG = { lados: ["Izquierda", "Derecha"], rumas: 5, columnas: 3, niveles: 5 };
export const DEFAULT_LAYOUT_RULES = { minNivel: 3, maxNivel: 5, groupCategoria: true, groupProveedor: false };

export const LAYOUT_STATUS_COLOR = {
  bloqueada: "#adb5bd",
  vacía: "#8a90a2",
  "en llenado": "#c9720b",
  óptima: "#2f9e44",
  llena: "#1971c2",
};

const PAINT = {
  blanco: "#f4f4f4",
  gris: "#9aa0a6",
  verde: "#2f9e44",
  azul: "#1c7ed6",
  rojo: "#e03131",
  naranja: "#f76707",
  marron: "#8d6e63",
  marrón: "#8d6e63",
  beige: "#e6d3b3",
  crema: "#f3e5ab",
  corten: "#b85c38",
};

/** Color de la ficha del contenedor. Blanco se pinta blanco y naranja, naranja. */
export function paintColor(name, fallback = "") {
  const raw = String(name || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  const key = raw.toLowerCase();
  if (PAINT[key]) return PAINT[key];
  if (key.startsWith("corten")) return PAINT.corten;
  return fallback;
}

export function boxColor(unit, fallback = "#8a90a2") {
  return paintColor(unit?.color, "") || unit?.typeColor || fallback;
}

/** Misma cuenta que fenceBays del API. Sin bays, todo el lado usa un solo largo y una fila. */
export function fenceBays(side) {
  if (!side || side.kind === "pared") return [];
  const length = Number(side.lengthM) || 0;
  const wall = side.kind === "mixto" ? Math.min(Number(side.wallM) || 0, length) : 0;
  const fallback = Number(side.containerFeet) === 20 ? 20 : 40;
  const choices = Array.isArray(side.bays) ? side.bays : [];
  const out = [];
  let cursor = wall;
  let index = 0;
  while (out.length < 80) {
    const choice = choices[index];
    let feet = choice ? (Number(choice.feet) === 20 ? 20 : 40) : fallback;
    let width = feet === 20 ? 6.1 : 12.2;
    if (cursor + width > length + 0.05) {
      if (choice || feet === 20 || cursor + 6.1 > length + 0.05) break;
      feet = 20;
      width = 6.1;
    }
    const rows = Math.min(3, Math.max(1, Number(choice?.rows) || 1));
    out.push({ slot: out.length + 1, feet, rows, fromM: cursor });
    cursor += width;
    index += 1;
  }
  return out;
}

export function sizeGroup(type) {
  if (type.startsWith("20")) return "20";
  if (type.startsWith("40")) return "40";
  if (type === "45HC") return "45";
  return type;
}

export function newnessTier(cat) {
  return cat === "1TRIP" ? "nuevo" : "usado";
}

export function columnOccupants(occupants, depotId, lado, ruma, columna) {
  return occupants.filter(
    (x) => x.depotId === depotId && x.lado === lado && x.ruma === ruma && x.columna === columna,
  );
}

export function columnMaxNivel(config, rules) {
  return Math.min(rules.maxNivel || config.niveles, config.niveles);
}

export function columnIsFull(occupants, depotId, lado, ruma, columna, config, rules) {
  return columnOccupants(occupants, depotId, lado, ruma, columna).length >= columnMaxNivel(config, rules);
}

export function columnUsable(occupants, depotId, lado, ruma, columna, config, rules) {
  if (columna <= 1) return true;
  return columnIsFull(occupants, depotId, lado, ruma, columna - 1, config, rules);
}

export function columnCompatible(occupants, depotId, lado, ruma, columna, type, cat, manufacturer, config, rules) {
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

export function columnFillStatus(occupants, depotId, lado, ruma, columna, config, rules) {
  const n = columnOccupants(occupants, depotId, lado, ruma, columna).length;
  const max = columnMaxNivel(config, rules);
  if (!columnUsable(occupants, depotId, lado, ruma, columna, config, rules)) return "bloqueada";
  if (n === 0) return "vacía";
  if (n >= max) return "llena";
  if (n < rules.minNivel) return "en llenado";
  return "óptima";
}

export function nextNivelInColumn(occupants, depotId, lado, ruma, columna, config, rules) {
  if (!columnUsable(occupants, depotId, lado, ruma, columna, config, rules)) return null;
  const occ = columnOccupants(occupants, depotId, lado, ruma, columna);
  const max = columnMaxNivel(config, rules);
  if (!occ.length) return 1;
  const maxNivel = Math.max(...occ.map((o) => o.nivel || 0));
  return maxNivel < max ? maxNivel + 1 : null;
}

export function availableSlotsFor(occupants, depotId, type, cat, manufacturer, config, rules) {
  const slots = [];
  for (const lado of config.lados) {
    for (let ruma = 1; ruma <= config.rumas; ruma++) {
      for (let columna = 1; columna <= config.columnas; columna++) {
        if (!columnCompatible(occupants, depotId, lado, ruma, columna, type, cat, manufacturer, config, rules)) continue;
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

export function bestSlotFor(occupants, depotId, type, cat, config, rules) {
  const slots = availableSlotsFor(occupants, depotId, type, cat, undefined, config, rules);
  return slots.length ? slots[0] : null;
}

export function slotKey(s) {
  return `${s.lado}|${s.ruma}|${s.columna}|${s.nivel}`;
}
