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
  typeCode?: string;
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
    const key = `${ghost.zoneId}:${ghost.row}:${ghost.col}:${ghost.level}`;
    if (ghostSeen.has(key)) return;
    ghostSeen.add(key);
    const code = String(row.code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 20);
    const typeCode = String(row.typeCode || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 12);
    ghosts.push(code ? { ...ghost, code, typeCode } : ghost);
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
};

/** Los niveles vacíos debajo de un equipo quedan ocupados sin identificar, para que la ruma no flote. */
export function ghostsWithSupport(zones: YardZone[], ghosts: YardGhost[], occupied: StackCell[]): YardGhost[] {
  const next = ghosts.map((ghost) => ({ ...ghost }));
  const zoneByName = new Map(zones.map((zone) => [zone.name, zone]));
  const tops = new Map<string, number>();
  const bump = (zoneId: string, row: number, col: number, level: number) => {
    if (level < 1) return;
    const key = `${zoneId}:${row}:${col}`;
    tops.set(key, Math.max(tops.get(key) || 0, level));
  };
  for (const ghost of next) bump(ghost.zoneId, ghost.row, ghost.col, ghost.level);
  for (const cell of occupied) {
    const zone = zoneByName.get(cell.zoneName);
    if (zone) bump(zone.id, cell.row, cell.col, cell.level);
  }
  for (const [key, top] of tops) {
    const [zoneId, rowRaw, colRaw] = key.split(":");
    const zone = zones.find((item) => item.id === zoneId);
    if (!zone) continue;
    const row = Number(rowRaw);
    const col = Number(colRaw);
    for (let level = 1; level < top; level += 1) {
      const hasGhost = next.some((ghost) => ghost.zoneId === zoneId && ghost.row === row && ghost.col === col && ghost.level === level);
      const hasUnit = occupied.some(
        (cell) => cell.zoneName === zone.name && cell.row === row && cell.col === col && cell.level === level,
      );
      if (!hasGhost && !hasUnit) next.push({ zoneId, row, col, level });
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
): number {
  const zone = zones.find((item) => item.name === lado);
  const units = occupied.filter(
    (cell) => cell.zoneName === lado && cell.row === row && cell.col === col && cell.level > level && cell.iso !== iso,
  ).length;
  const unknown = zone
    ? ghosts.filter((ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level).length
    : 0;
  return units + unknown;
}

export function zoneSlotError(zone: YardZone, row: number, col: number, level: number) {
  if (row < 1 || row > zone.rows) return `La fila ${row} no existe en ${zone.name}.`;
  if (col < 1 || col > zone.cols) return `La columna ${col} no existe en ${zone.name}.`;
  if (level < 1 || level > zone.levels) return `La altura ${level} supera el máximo ${zone.levels} de ${zone.name}.`;
  return "";
}
