/** Plano de un almacén: zonas, pasillos y huecos ocupados que todavía no tienen ISO. */

export type YardZone = {
  id: string;
  name: string;
  rows: number;
  cols: number;
  levels: number;
  /** Fila del plano del almacén. 1 es la fila del frente. */
  gridRow: number;
  /** Columna del plano. 1 queda a la izquierda. */
  gridCol: number;
};

export type YardAisle = {
  id: string;
  name: string;
  afterZoneId: string;
};

export type YardGhost = {
  zoneId: string;
  row: number;
  col: number;
  level: number;
  /** Código escrito en patio cuando el equipo no está en el inventario dry. */
  code?: string;
  /** 10, 20 o 40, o el código de tipo del inventario. */
  typeCode?: string;
  color?: string;
  note?: string;
  /** Mitad del puesto de 40 pies. Vacío: el equipo ocupa el puesto entero. */
  half?: "A" | "B";
};

export type YardPlan = {
  zones: YardZone[];
  aisles: YardAisle[];
  ghosts: YardGhost[];
};

const LEFT_STATUSES = new Set(["Vendido", "Alquilado", "Retirado por cliente"]);

export function leftToCustomer(status?: string | null) {
  return LEFT_STATUSES.has(String(status || ""));
}

export function defaultYardPlan(): YardPlan {
  return {
    zones: [{ id: "zona-a", name: "Zona A", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 1 }],
    aisles: [{ id: "pasillo-1", name: "Pasillo 1", afterZoneId: "zona-a" }],
    ghosts: [],
  };
}

function inside(value: unknown, min: number, max: number) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) return 0;
  return n;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function text(value: unknown, fallback: string) {
  const raw = String(value || "").trim().slice(0, 40);
  return raw || fallback;
}

export function normalizeYardPlan(raw: unknown): YardPlan {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const zonesIn = Array.isArray(source.zones) ? source.zones : [];
  const zones: YardZone[] = [];
  const seen = new Set<string>();
  zonesIn.slice(0, 24).forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const id = text(row.id, `zona-${index + 1}`).toLowerCase().replace(/[^a-z0-9-]/g, "") || `zona-${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    zones.push({
      id,
      name: text(row.name, `Zona ${index + 1}`),
      rows: clamp(row.rows, 1, 40, 4),
      cols: clamp(row.cols, 1, 20, 3),
      levels: clamp(row.levels, 1, 20, 5),
      gridRow: clamp(row.gridRow, 1, 4, 0),
      gridCol: clamp(row.gridCol, 1, 4, 0),
    });
  });
  if (!zones.length) return defaultYardPlan();
  seatZones(zones);
  const ids = new Set(zones.map((zone) => zone.id));
  const aisles: YardAisle[] = [];
  const aisleSeen = new Set<string>();
  (Array.isArray(source.aisles) ? source.aisles : []).slice(0, 24).forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const afterZoneId = String(row.afterZoneId || "");
    if (!ids.has(afterZoneId)) return;
    const id = text(row.id, `pasillo-${index + 1}`).toLowerCase().replace(/[^a-z0-9-]/g, "") || `pasillo-${index + 1}`;
    if (aisleSeen.has(id)) return;
    aisleSeen.add(id);
    aisles.push({ id, name: text(row.name, `Pasillo ${index + 1}`), afterZoneId });
  });
  const ghosts: YardGhost[] = [];
  const ghostSeen = new Set<string>();
  (Array.isArray(source.ghosts) ? source.ghosts : []).forEach((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const zone = zones.find((itemZone) => itemZone.id === String(row.zoneId || ""));
    if (!zone) return;
    const ghost = {
      zoneId: zone.id,
      row: inside(row.row, 1, zone.rows),
      col: inside(row.col, 1, zone.cols),
      level: inside(row.level, 1, zone.levels),
    };
    if (!ghost.row || !ghost.col || !ghost.level) return;
    const code = String(row.code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 20);
    const typeCode = String(row.typeCode || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 12);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(row.color || "")) ? String(row.color).toLowerCase() : "";
    const note = String(row.note || "").trim().slice(0, 120);
    const half: "A" | "B" | "" = row.half === "A" ? "A" : row.half === "B" ? "B" : "";
    const key = `${ghost.zoneId}:${ghost.row}:${ghost.col}:${ghost.level}:${half || "F"}`;
    if (ghostSeen.has(key)) return;
    ghostSeen.add(key);
    const named = code
      ? { ...ghost, code, typeCode, ...(color ? { color } : {}), ...(note ? { note } : {}), ...(half ? { half } : {}) }
      : { ...ghost, ...(half ? { half } : {}) };
    ghosts.push(named);
  });
  return { zones, aisles, ghosts };
}

/** Las zonas sin fila ni columna quedan en la primera fila, de izquierda a derecha. */
function seatZones(zones: YardZone[]) {
  const taken = new Set<string>();
  let nextCol = 1;
  for (const zone of zones) {
    if (zone.gridRow && zone.gridCol && !taken.has(`${zone.gridRow}:${zone.gridCol}`)) {
      taken.add(`${zone.gridRow}:${zone.gridCol}`);
      continue;
    }
    let seated = false;
    for (let row = 1; row <= 4 && !seated; row += 1) {
      for (let col = row === 1 ? nextCol : 1; col <= 4; col += 1) {
        const key = `${row}:${col}`;
        if (taken.has(key)) continue;
        zone.gridRow = row;
        zone.gridCol = col;
        taken.add(key);
        if (row === 1) nextCol = col + 1;
        seated = true;
        break;
      }
    }
  }
}

export type StackCell = {
  zoneName: string;
  row: number;
  col: number;
  level: number;
  iso?: string;
  type?: string;
  half?: "A" | "B" | null;
};

export type BaySpan = "full" | "center" | "A" | "B";

/** Un 40 ocupa el puesto entero. Un 20 o un 10 sin lado queda al centro. Con mitad, ocupa A o B. */
export function baySpan(type?: string | null, half?: string | null): BaySpan {
  const feet = feetOf(type);
  if (feet >= 40) return "full";
  if (half === "A" || half === "B") return half;
  if (feet > 0) return "center";
  return "full";
}

export function asBayHalf(value?: string | null): "A" | "B" | null {
  return value === "A" ? "A" : value === "B" ? "B" : null;
}

export function spansOverlap(left: BaySpan, right: BaySpan) {
  if (left === "center" || right === "center") return true;
  return left === "full" || right === "full" || left === right;
}

function coversHalf(item: { type?: string | null; half?: string | null }, half: "A" | "B") {
  const span = baySpan(item.type, item.half);
  return span === "full" || span === half;
}

function occupiesHalf(item: { type?: string | null; half?: string | null }, half: "A" | "B") {
  const span = baySpan(item.type, item.half);
  return span === "full" || span === "center" || span === half;
}

function isExplicitGhost(ghost: YardGhost, all: YardGhost[]) {
  if (ghost.code || ghost.typeCode || !ghost.half) return true;
  return all.some(
    (other) => other !== ghost
      && other.zoneId === ghost.zoneId
      && other.row === ghost.row
      && other.col === ghost.col
      && other.level === ghost.level
      && !other.code
      && !other.typeCode
      && !!other.half
      && other.half !== ghost.half,
  );
}

/** Los niveles vacíos debajo de un equipo quedan ocupados sin identificar, para que la ruma no flote. */
export function ghostsWithSupport(zones: YardZone[], ghosts: YardGhost[], occupied: StackCell[]): YardGhost[] {
  const next = ghosts.filter((ghost) => isExplicitGhost(ghost, ghosts)).map((ghost) => ({ ...ghost }));
  const zoneByName = new Map(zones.map((zone) => [zone.name, zone]));
  const columns = new Map<string, { zoneId: string; row: number; col: number; name: string }>();
  const remember = (zoneId: string, name: string, row: number, col: number) => {
    columns.set(`${zoneId}:${row}:${col}`, { zoneId, row, col, name });
  };
  for (const ghost of next) {
    const zone = zones.find((item) => item.id === ghost.zoneId);
    if (zone) remember(ghost.zoneId, zone.name, ghost.row, ghost.col);
  }
  for (const cell of occupied) {
    const zone = zoneByName.get(cell.zoneName);
    if (zone) remember(zone.id, zone.name, cell.row, cell.col);
  }
  for (const column of columns.values()) {
    const at = (level: number) => {
      const units = occupied.filter(
        (cell) => cell.zoneName === column.name && cell.row === column.row && cell.col === column.col && cell.level === level,
      );
      const marked = next.filter(
        (ghost) => ghost.zoneId === column.zoneId && ghost.row === column.row && ghost.col === column.col && ghost.level === level,
      );
      return [
        ...units.map((cell) => ({ type: cell.type, half: cell.half })),
        ...marked.map((ghost) => ({ type: ghost.typeCode, half: ghost.half })),
      ];
    };
    const top = Math.max(
      0,
      ...occupied.filter((cell) => cell.zoneName === column.name && cell.row === column.row && cell.col === column.col).map((cell) => cell.level),
      ...next.filter((ghost) => ghost.zoneId === column.zoneId && ghost.row === column.row && ghost.col === column.col).map((ghost) => ghost.level),
    );
    for (let level = 1; level < top; level += 1) {
      const here = at(level);
      const above = (half: "A" | "B") => {
        for (let cursor = level + 1; cursor <= top; cursor += 1) {
          if (at(cursor).some((item) => occupiesHalf(item, half))) return true;
        }
        return false;
      };
      const blocked = here.some((item) => occupiesHalf(item, "A") || occupiesHalf(item, "B"));
      if (!blocked && (above("A") || above("B"))) next.push({ zoneId: column.zoneId, row: column.row, col: column.col, level });
    }
  }
  return next;
}

/** Equipos, identificados o no, que hay que mover para llegar al que está en ese nivel. */
export function movesAbove(
  zones: YardZone[],
  ghosts: YardGhost[],
  occupied: StackCell[],
  lado: string,
  row: number,
  col: number,
  level: number,
  iso?: string,
  half?: string | null,
  type?: string | null,
): number {
  const zone = zones.find((item) => item.name === lado);
  const span = type || half ? baySpan(type, half) : "full";
  const units = occupied.filter(
    (cell) => cell.zoneName === lado && cell.row === row && cell.col === col && cell.level > level && cell.iso !== iso
      && spansOverlap(baySpan(cell.type, cell.half), span),
  ).length;
  const unknown = zone
    ? ghosts.filter(
      (ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level
        && spansOverlap(baySpan(ghost.typeCode, ghost.half), span),
    ).length
    : 0;
  return units + unknown;
}

export const AISLE_SIDE = "PASILLO";

export function feetOf(type?: string | null): number {
  const code = String(type || "").toUpperCase();
  if (code.startsWith("45")) return 45;
  if (code.startsWith("40")) return 40;
  if (code.startsWith("20")) return 20;
  if (code.startsWith("10")) return 10;
  return 0;
}

function supportFeet(items: Array<{ type?: string | null; half?: string | null }>, half: "A" | "B") {
  const typed = items.filter((item) => coversHalf(item, half) && feetOf(item.type) > 0);
  if (!typed.length) return null;
  return Math.max(...typed.map((item) => feetOf(item.type)));
}

/** Un 40 se apoya en un 40 o en dos de 20, uno en cada mitad. Un 20 se apoya en su mitad o en un 40. */
export function stackLengthError(
  zone: YardZone,
  ghosts: YardGhost[],
  stacked: Array<StackCell & { type?: string; half?: "A" | "B" | null }>,
  incomingType: string | null | undefined,
  row: number,
  col: number,
  level: number,
  half?: string | null,
): string {
  const incoming = feetOf(incomingType);
  if (level <= 1 || incoming <= 0) return "";
  const span = baySpan(incomingType, half);
  for (let cursor = level - 1; cursor >= 1; cursor -= 1) {
    const items = [
      ...stacked
        .filter((cell) => cell.zoneName === zone.name && cell.row === row && cell.col === col && cell.level === cursor)
        .map((cell) => ({ type: cell.type, half: cell.half })),
      ...ghosts
        .filter((ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level === cursor)
        .map((ghost) => ({ type: ghost.typeCode, half: ghost.half })),
    ];
    const feetA = supportFeet(items, "A");
    const feetB = supportFeet(items, "B");
    const centered = items.filter((item) => baySpan(item.type, item.half) === "center" && feetOf(item.type) > 0);
    const centerFeet = centered.length ? Math.max(...centered.map((item) => feetOf(item.type))) : null;
    const fullFeet = items
      .filter((item) => baySpan(item.type, item.half) === "full" && feetOf(item.type) > 0)
      .map((item) => feetOf(item.type));
    const fullSupport = fullFeet.length ? Math.max(...fullFeet) : null;
    if (fullSupport != null && fullSupport >= incoming) continue;
    if (span === "center") {
      if (feetA != null && feetB != null && feetA >= incoming && feetB >= incoming) continue;
      if (centerFeet != null && incoming > centerFeet) {
        return `Un equipo de ${incoming} pies no puede ir encima de uno de ${centerFeet} pies.`;
      }
      const sideFeet = feetA ?? feetB;
      if (sideFeet != null && incoming > sideFeet) {
        return `Un equipo de ${incoming} pies no puede ir encima de uno de ${sideFeet} pies.`;
      }
      continue;
    }
    if (span === "full" && feetA != null && feetB != null && feetA >= 20 && feetB >= 20 && incoming <= 40) continue;
    if (span === "full" && centerFeet != null && incoming > centerFeet) {
      return `Un equipo de ${incoming} pies no puede ir encima de uno de ${centerFeet} pies que está al centro. Muévelo a la izquierda o a la derecha y completa la otra mitad.`;
    }
    if ((span === "A" || span === "B") && centerFeet != null && (span === "A" ? feetA : feetB) == null) {
      return `Un equipo de ${incoming} pies no puede ir encima de uno de ${centerFeet} pies que está al centro. Muévelo a la izquierda o a la derecha.`;
    }
    const halves: Array<"A" | "B"> = span === "full" ? ["A", "B"] : [span];
    for (const side of halves) {
      const feet = side === "A" ? feetA : feetB;
      if (feet == null) continue;
      if (incoming > feet) {
        return span === "full" && (feetA == null || feetB == null)
          ? `Un equipo de 40 pies necesita un 40 debajo, o un 20 en cada mitad. Abajo hay uno de ${feet} pies.`
          : `Un equipo de ${incoming} pies no puede ir encima de uno de ${feet} pies.`;
      }
    }
  }
  return "";
}

export function zoneSlotError(zone: YardZone, row: number, col: number, level: number) {
  if (row < 1 || row > zone.rows) return `La fila ${row} no existe en ${zone.name}.`;
  if (col < 1 || col > zone.cols) return `La columna ${col} no existe en ${zone.name}.`;
  if (level < 1 || level > zone.levels) return `La altura ${level} supera el máximo ${zone.levels} de ${zone.name}.`;
  return "";
}
