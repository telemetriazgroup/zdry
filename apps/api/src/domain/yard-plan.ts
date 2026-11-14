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
  /** Origen en metros. Si viene, el 3D usa esta posición en vez de la cuadrícula. */
  xM?: number;
  zM?: number;
  /**
   * Lado por el que el stacker no entra. Ese lado es el perímetro.
   * Vacío: puede entrar por la fila 1 o por la última fila.
   */
  closedSide?: ZoneClosedSide;
};

export type ZoneClosedSide = "" | "frente" | "fondo" | "izquierda" | "derecha";

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
  /** Clase del equipo ajeno: REEFER, TUNEL, POWERPACK, MODULO, OTROS u otra del patio. */
  kind?: string;
  /** Mitad del puesto de 40 pies. Vacío: el equipo ocupa el puesto entero. */
  half?: "A" | "B";
};

/** Foto o video de un equipo que no es ZDRY. La casilla 0–8 es la vista (frontal, lateral…). */
export type YardGearMedia = {
  id: string;
  kind: "photo" | "video";
  slot?: number;
  storageKey: string;
  mime: string;
  name: string;
};

/** Equipo que no es un contenedor ZDRY, asimilado al depósito. Puede estar sin ubicar. */
export type YardOutsider = {
  id: string;
  code: string;
  feet: 10 | 20 | 40;
  color?: string;
  note?: string;
  kind: string;
  media?: YardGearMedia[];
};

export type YardPlan = {
  zones: YardZone[];
  aisles: YardAisle[];
  ghosts: YardGhost[];
  perimeter: YardPerimeter;
  /** Equipos que no son ZDRY y ya pertenecen a este depósito. */
  outsiders: YardOutsider[];
  /** Clases de equipo que no está en ZDRY. Se eligen al regularizar. */
  equipmentKinds: string[];
};

export const DEFAULT_EQUIPMENT_KINDS = ["REEFER", "TUNEL", "POWERPACK", "MODULO", "OTROS"];

export type FenceKind = "pared" | "contenedores" | "mixto";

export type YardFenceSide = {
  id: string;
  name: string;
  /** Largo del lado, en metros. */
  lengthM: number;
  /** Giro a la derecha al terminar el lado, en grados. 90 cierra un rectángulo. */
  turnDeg: number;
  kind: FenceKind;
  containerFeet: 20 | 40;
  /** En un lado mixto, metros de pared desde el inicio. El resto son contenedores. */
  wallM: number;
  /** Altura del cerco en ese lado. Máximo 3. */
  levels: number;
  /** Puestos de contenedor que pasaron a ser pared. */
  wallSlots: number[];
  /**
   * Elección de cada puesto, en orden. Si un puesto no está, usa containerFeet y una fila.
   * Una fila es la línea del cerco; la segunda y la tercera entran hacia el patio.
   */
  bays?: FenceBayChoice[];
};

export type FenceBayChoice = {
  feet: 20 | 40;
  rows: number;
};

export type YardGate = {
  id: string;
  sideId: string;
  name: string;
  /** Metros desde el inicio del lado. */
  atM: number;
  widthM: number;
};

export type YardPerimeter = {
  sides: YardFenceSide[];
  gates: YardGate[];
  /** Contenedores del almacén que forman el cerco. */
  cells: YardFenceCell[];
};

export type YardFenceCell = {
  sideId: string;
  slot: number;
  level: number;
  iso: string;
  /** En un puesto de 40 pies, la mitad que ocupa un contenedor de 20. */
  half?: "A" | "B";
  /** 1 es la línea del cerco. 2 y 3 son filas hacia adentro, del mismo largo. */
  row?: number;
  /** No está en el catálogo. El 3D lo dibuja llenando el puesto. */
  unknown?: boolean;
  typeCode?: string;
  color?: string;
  note?: string;
  /** Clase del equipo ajeno a ZDRY. */
  kind?: string;
};

export const FENCE_SIDE = "CERCO";

/** La fila del cerco entra en la ruma: 1–8 es la fila 1, 11–18 la fila 2 y 21–28 la fila 3. */
export function fenceSeat(sideIndex: number, row = 1) {
  const depth = row === 2 || row === 3 ? row : 1;
  const index = Math.max(0, Math.min(7, Math.round(sideIndex) || 0));
  return index + 1 + (depth - 1) * 10;
}

export function fenceSideIndex(ruma: number) {
  return (Math.max(1, Math.round(Number(ruma) || 1)) - 1) % 10;
}

export function fenceDepthOf(ruma: number) {
  return Math.floor((Math.max(1, Math.round(Number(ruma) || 1)) - 1) / 10) + 1;
}

const LEFT_STATUSES = new Set(["Vendido", "Alquilado", "Retirado por cliente"]);

export function leftToCustomer(status?: string | null) {
  return LEFT_STATUSES.has(String(status || ""));
}

export function defaultYardPlan(): YardPlan {
  return {
    zones: [{ id: "zona-a", name: "Zona A", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 1 }],
    aisles: [{ id: "pasillo-1", name: "Pasillo 1", afterZoneId: "zona-a" }],
    ghosts: [],
    perimeter: { sides: [], gates: [], cells: [] },
    outsiders: [],
    equipmentKinds: [...DEFAULT_EQUIPMENT_KINDS],
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
    const xM = Number(row.xM);
    const zM = Number(row.zM);
    const closedSide = closedSideOf(row.closedSide);
    zones.push({
      id,
      name: text(row.name, `Zona ${index + 1}`),
      rows: clamp(row.rows, 1, 40, 4),
      cols: clamp(row.cols, 1, 20, 3),
      levels: clamp(row.levels, 1, 20, 5),
      gridRow: clamp(row.gridRow, 1, 4, 0),
      gridCol: clamp(row.gridCol, 1, 4, 0),
      ...(Number.isFinite(xM) ? { xM } : {}),
      ...(Number.isFinite(zM) ? { zM } : {}),
      ...(closedSide ? { closedSide } : {}),
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
    const kind = equipmentKind(row.kind);
    const half: "A" | "B" | "" = row.half === "A" ? "A" : row.half === "B" ? "B" : "";
    const key = `${ghost.zoneId}:${ghost.row}:${ghost.col}:${ghost.level}:${half || "F"}`;
    if (ghostSeen.has(key)) return;
    ghostSeen.add(key);
    const named = code
      ? { ...ghost, code, typeCode, ...(color ? { color } : {}), ...(note ? { note } : {}), ...(kind ? { kind } : {}), ...(half ? { half } : {}) }
      : { ...ghost, ...(half ? { half } : {}) };
    ghosts.push(named);
  });
  return {
    zones,
    aisles,
    ghosts,
    perimeter: normalizePerimeter(source.perimeter),
    outsiders: outsidersOf(source.outsiders),
    equipmentKinds: equipmentKindsOf(source.equipmentKinds),
  };
}

function outsiderFeet(value: unknown): 10 | 20 | 40 {
  const raw = String(value || "");
  if (raw === "10" || Number(value) === 10) return 10;
  if (raw === "40" || raw.startsWith("40") || Number(value) === 40) return 40;
  return 20;
}

function outsidersOf(raw: unknown): YardOutsider[] {
  const outsiders: YardOutsider[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw) ? raw : []).slice(0, 200).forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const code = String(row.code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 20);
    if (!code || code === "DESCONOCIDO" || seen.has(code)) return;
    seen.add(code);
    const id = text(row.id, `equipo-${index + 1}`).toLowerCase().replace(/[^a-z0-9-]/g, "") || `equipo-${index + 1}`;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(row.color || "")) ? String(row.color).toLowerCase() : "";
    const note = String(row.note || "").trim().slice(0, 120);
    const kind = equipmentKind(row.kind) || "OTROS";
    const media = gearMediaOf(row.media);
    outsiders.push({
      id,
      code,
      feet: outsiderFeet(row.feet ?? row.typeCode),
      ...(color ? { color } : {}),
      ...(note ? { note } : {}),
      kind,
      ...(media.length ? { media } : {}),
    });
  });
  return outsiders;
}

function gearMediaOf(raw: unknown): YardGearMedia[] {
  const media: YardGearMedia[] = [];
  const seen = new Set<string>();
  const usedSlots = new Set<number>();
  (Array.isArray(raw) ? raw : []).slice(0, 40).forEach((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const id = String(row.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const storageKey = String(row.storageKey || "").trim();
    const kind = row.kind === "video" ? "video" : row.kind === "photo" ? "photo" : "";
    const mime = String(row.mime || "").trim().slice(0, 80);
    if (!id || seen.has(id) || !kind || !mime || !storageKey.startsWith("yard-gear/")) return;
    seen.add(id);
    const slot = Number(row.slot);
    const placed = kind === "photo" && Number.isInteger(slot) && slot >= 0 && slot <= 8 && !usedSlots.has(slot);
    if (placed) usedSlots.add(slot);
    media.push({
      id,
      kind,
      storageKey: storageKey.slice(0, 240),
      mime,
      name: String(row.name || "").replace(/[/\\]/g, "_").slice(0, 180),
      ...(placed ? { slot } : {}),
    });
  });
  return media;
}

function equipmentKind(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 24);
}

function equipmentKindsOf(raw: unknown) {
  const kinds: string[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw) ? raw : []).slice(0, 24).forEach((item) => {
    const name = equipmentKind(item);
    if (!name || seen.has(name)) return;
    seen.add(name);
    kinds.push(name);
  });
  return kinds.length ? kinds : [...DEFAULT_EQUIPMENT_KINDS];
}

function fenceId(value: unknown, fallback: string) {
  return text(value, fallback).toLowerCase().replace(/[^a-z0-9-]/g, "") || fallback;
}

function closedSideOf(value: unknown): ZoneClosedSide {
  return value === "frente" || value === "fondo" || value === "izquierda" || value === "derecha" ? value : "";
}

function fenceKind(value: unknown): FenceKind {
  return value === "contenedores" || value === "mixto" ? value : "pared";
}

export function normalizePerimeter(raw: unknown): YardPerimeter {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sides: YardFenceSide[] = [];
  const seen = new Set<string>();
  (Array.isArray(source.sides) ? source.sides : []).slice(0, 8).forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const id = fenceId(row.id, `lado-${index + 1}`);
    if (seen.has(id)) return;
    seen.add(id);
    const lengthM = clamp(row.lengthM, 2, 500, 40);
    const kind = fenceKind(row.kind);
    const containerFeet: 20 | 40 = Number(row.containerFeet) === 20 ? 20 : 40;
    const wallM = clamp(row.wallM, 0, lengthM, 0);
    const levels = clamp(row.levels, 1, 3, 1);
    const bays = fenceBayChoices(row.bays);
    const slotCount = fenceBays({ lengthM, kind, containerFeet, wallM, bays }).length;
    const wallSlots = [...new Set((Array.isArray(row.wallSlots) ? row.wallSlots : []).map((item) => Math.round(Number(item))).filter((item) => item >= 1 && item <= slotCount))].slice(0, 80);
    sides.push({
      id,
      name: text(row.name, `Lado ${index + 1}`),
      lengthM,
      turnDeg: clamp(row.turnDeg, -170, 170, 90),
      kind,
      containerFeet,
      wallM,
      levels,
      wallSlots,
      ...(bays.length ? { bays } : {}),
    });
  });
  if (sides.length && sides.length < 3) return { sides: [], gates: [], cells: [] };
  const ids = new Set(sides.map((side) => side.id));
  const gates: YardGate[] = [];
  const gateSeen = new Set<string>();
  (Array.isArray(source.gates) ? source.gates : []).slice(0, 8).forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const side = sides.find((itemSide) => itemSide.id === String(row.sideId || ""));
    if (!side || !ids.has(side.id)) return;
    const id = fenceId(row.id, `entrada-${index + 1}`);
    if (gateSeen.has(id)) return;
    gateSeen.add(id);
    const widthM = clamp(row.widthM, 3, 30, 12);
    const atM = clamp(row.atM, 0, Math.max(0, side.lengthM - widthM), 0);
    gates.push({ id, sideId: side.id, name: text(row.name, `Entrada ${index + 1}`), atM, widthM });
  });
  const cells: YardFenceCell[] = [];
  const usedIso = new Set<string>();
  (Array.isArray(source.cells) ? source.cells : []).slice(0, 400).forEach((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const side = sides.find((itemSide) => itemSide.id === String(row.sideId || ""));
    if (!side || side.wallSlots.includes(Math.round(Number(row.slot)))) return;
    const slot = inside(row.slot, 1, fenceBays(side).length);
    const level = inside(row.level, 1, side.levels);
    const iso = String(row.iso || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 20);
    const half = row.half === "A" || row.half === "B" ? row.half : "";
    const depth = row.row === 2 || row.row === 3 || row.row === "2" || row.row === "3" ? Number(row.row) : 1;
    const bay = fenceBays(side).find((item) => item.slot === slot);
    if (bay && depth > bay.rows) return;
    const rowDepth = depth;
    const unknown = row.unknown === true;
    const typeCode = String(row.typeCode || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 12);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(row.color || "")) ? String(row.color).toLowerCase() : "";
    const note = String(row.note || "").trim().slice(0, 120);
    const kind = equipmentKind(row.kind);
    if (!slot || !level || !iso) return;
    if (!unknown && usedIso.has(iso)) return;
    if (!unknown) usedIso.add(iso);
    cells.push({
      sideId: side.id,
      slot,
      level,
      iso,
      ...(half ? { half } : {}),
      ...(rowDepth > 1 ? { row: rowDepth } : {}),
      ...(unknown ? { unknown: true } : {}),
      ...(typeCode ? { typeCode } : {}),
      ...(color ? { color } : {}),
      ...(note ? { note } : {}),
      ...(kind ? { kind } : {}),
    });
  });
  return { sides, gates, cells };
}

export function fenceWithout(plan: YardPlan, iso: string) {
  const code = iso.trim().toUpperCase();
  return { ...plan.perimeter, cells: plan.perimeter.cells.filter((cell) => cell.iso !== code) };
}

export function fenceSlotCount(side: { lengthM: number; kind: FenceKind; containerFeet: 20 | 40; wallM: number }) {
  if (side.kind === "pared") return 0;
  const feet = side.containerFeet === 20 ? 6.1 : 12.2;
  const wall = side.kind === "mixto" ? Math.min(side.wallM, side.lengthM) : 0;
  return Math.max(0, Math.floor((side.lengthM - wall + 0.05) / feet));
}

function fenceBayChoices(raw: unknown): FenceBayChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 80).map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const feet: 20 | 40 = Number(row.feet) === 20 ? 20 : 40;
    const rows = clamp(row.rows, 1, 3, 1);
    return { feet, rows };
  });
}

export type FenceBay = { slot: number; feet: 20 | 40; rows: number; fromM: number };

/** Recorre el lado y deja cada puesto con su largo. Sin elección previa, todos usan el largo del lado y una fila. */
export function fenceBays(side: { lengthM: number; kind: FenceKind; containerFeet: 20 | 40; wallM: number; bays?: FenceBayChoice[] }): FenceBay[] {
  if (side.kind === "pared") return [];
  const length = side.lengthM;
  const wall = side.kind === "mixto" ? Math.min(side.wallM, length) : 0;
  const fallback: 20 | 40 = side.containerFeet === 20 ? 20 : 40;
  const choices = side.bays || [];
  const out: FenceBay[] = [];
  let cursor = wall;
  let index = 0;
  while (out.length < 80) {
    const choice = choices[index];
    let feet: 20 | 40 = choice ? choice.feet : fallback;
    let width = feet === 20 ? 6.1 : 12.2;
    if (cursor + width > length + 0.05) {
      if (choice || feet === 20 || cursor + 6.1 > length + 0.05) break;
      feet = 20;
      width = 6.1;
    }
    out.push({ slot: out.length + 1, feet, rows: choice ? choice.rows : 1, fromM: cursor });
    cursor += width;
    index += 1;
  }
  return out;
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

function boxesAlong(
  zone: YardZone,
  ghosts: YardGhost[],
  occupied: StackCell[],
  row: number,
  col: number,
  level: number,
  iso: string | undefined,
  span: BaySpan,
  axis: "row" | "col",
  towardLow: boolean,
) {
  const limit = axis === "row" ? zone.rows : zone.cols;
  const index = axis === "row" ? row : col;
  const from = towardLow ? 1 : index + 1;
  const to = towardLow ? index - 1 : limit;
  let count = 0;
  for (let cursor = from; cursor <= to; cursor += 1) {
    const atRow = axis === "row" ? cursor : row;
    const atCol = axis === "col" ? cursor : col;
    count += occupied.filter(
      (cell) => cell.zoneName === zone.name && cell.row === atRow && cell.col === atCol && cell.level > level && cell.iso !== iso
        && spansOverlap(baySpan(cell.type, cell.half), span),
    ).length;
    count += ghosts.filter(
      (ghost) => ghost.zoneId === zone.id && ghost.row === atRow && ghost.col === atCol && ghost.level > level
        && spansOverlap(baySpan(ghost.typeCode, ghost.half), span),
    ).length;
  }
  return count;
}

/**
 * Movimientos para que el stacker saque el equipo.
 * Cuenta los que están encima y los de las filas de acceso que son más altos:
 * tapan la vista y hay que bajarlos hasta el nivel del equipo.
 */
export function movesToReach(
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
) {
  const above = movesAbove(zones, ghosts, occupied, lado, row, col, level, iso, half, type);
  const zone = zones.find((item) => item.name === lado);
  if (!zone) return { above, beside: 0, total: above };
  const span = type || half ? baySpan(type, half) : "full";
  const closed = zone.closedSide || "";
  const options: number[] = [];
  if (closed === "izquierda" || closed === "derecha") {
    options.push(boxesAlong(zone, ghosts, occupied, row, col, level, iso, span, "col", closed === "derecha"));
  } else {
    if (closed !== "frente") options.push(boxesAlong(zone, ghosts, occupied, row, col, level, iso, span, "row", true));
    if (closed !== "fondo") options.push(boxesAlong(zone, ghosts, occupied, row, col, level, iso, span, "row", false));
  }
  const beside = options.length ? Math.min(...options) : 0;
  return { above, beside, total: above + beside };
}

export type ReachBlocker = {
  zoneName: string;
  row: number;
  col: number;
  level: number;
  iso?: string;
  half?: "A" | "B" | null;
};

function cellsAlong(
  zone: YardZone,
  ghosts: YardGhost[],
  occupied: StackCell[],
  row: number,
  col: number,
  level: number,
  iso: string | undefined,
  span: BaySpan,
  axis: "row" | "col",
  towardLow: boolean,
): ReachBlocker[] {
  const limit = axis === "row" ? zone.rows : zone.cols;
  const index = axis === "row" ? row : col;
  const from = towardLow ? 1 : index + 1;
  const to = towardLow ? index - 1 : limit;
  const found: ReachBlocker[] = [];
  for (let cursor = from; cursor <= to; cursor += 1) {
    const atRow = axis === "row" ? cursor : row;
    const atCol = axis === "col" ? cursor : col;
    for (const cell of occupied) {
      if (cell.zoneName !== zone.name || cell.row !== atRow || cell.col !== atCol || cell.level <= level || cell.iso === iso) continue;
      if (!spansOverlap(baySpan(cell.type, cell.half), span)) continue;
      found.push({ zoneName: zone.name, row: atRow, col: atCol, level: cell.level, iso: cell.iso, half: cell.half || null });
    }
    for (const ghost of ghosts) {
      if (ghost.zoneId !== zone.id || ghost.row !== atRow || ghost.col !== atCol || ghost.level <= level) continue;
      if (!spansOverlap(baySpan(ghost.typeCode, ghost.half), span)) continue;
      found.push({ zoneName: zone.name, row: atRow, col: atCol, level: ghost.level, iso: ghost.code, half: ghost.half || null });
    }
  }
  return found;
}

/** Equipos que el stacker tiene que mover para llegar a ese puesto. Un 40 encima de un 20 cuenta. */
export function reachBlockers(
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
): ReachBlocker[] {
  const zone = zones.find((item) => item.name === lado);
  const span = type || half ? baySpan(type, half) : "full";
  const above = occupied
    .filter((cell) => cell.zoneName === lado && cell.row === row && cell.col === col && cell.level > level && cell.iso !== iso && spansOverlap(baySpan(cell.type, cell.half), span))
    .map((cell) => ({ zoneName: lado, row, col, level: cell.level, iso: cell.iso, half: cell.half || null }));
  if (zone) {
    for (const ghost of ghosts) {
      if (ghost.zoneId !== zone.id || ghost.row !== row || ghost.col !== col || ghost.level <= level) continue;
      if (!spansOverlap(baySpan(ghost.typeCode, ghost.half), span)) continue;
      above.push({ zoneName: lado, row, col, level: ghost.level, iso: ghost.code, half: ghost.half || null });
    }
  }
  if (!zone) return above;
  const closed = zone.closedSide || "";
  const options: ReachBlocker[][] = [];
  if (closed === "izquierda" || closed === "derecha") {
    options.push(cellsAlong(zone, ghosts, occupied, row, col, level, iso, span, "col", closed === "derecha"));
  } else {
    if (closed !== "frente") options.push(cellsAlong(zone, ghosts, occupied, row, col, level, iso, span, "row", true));
    if (closed !== "fondo") options.push(cellsAlong(zone, ghosts, occupied, row, col, level, iso, span, "row", false));
  }
  const beside = options.reduce((best, list) => (list.length < best.length ? list : best), options[0] || []);
  const seen = new Set<string>();
  const all: ReachBlocker[] = [];
  for (const cell of [...above, ...beside]) {
    const key = `${cell.row}:${cell.col}:${cell.level}:${cell.iso || ""}:${cell.half || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(cell);
  }
  return all;
}

export const STACKER_PLACE_MESSAGE = "El stacker no llega a esa posición. Mueve antes los que están encima o los que tapan la vista.";

export function accessBlockMessage(above: number, beside: number) {
  if (above && beside) return "Hay equipos encima y la fila de al lado le tapa la vista al stacker. Muévelos antes de sacar este.";
  if (beside) return "La fila de al lado le tapa la vista al stacker. Mueve los que están más altos antes de sacar este.";
  return "Hay equipos encima. Muévelos antes de sacar este.";
}

export function accessPlaceNote(above: number, beside: number) {
  const total = above + beside;
  if (!total) return " El stacker tiene vista. Se saca sin movimientos.";
  if (beside && above) return ` Para acceder hay que mover ${total} equipo(s): ${beside} tapan la vista y ${above} están encima.`;
  if (beside) return ` Para acceder hay que mover ${beside} equipo(s) que tapan la vista del stacker.`;
  return ` Para acceder hay que mover ${above} equipo(s) que están encima.`;
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
      if (centerFeet != null && centerFeet >= incoming) continue;
      if (centerFeet != null) {
        return `Un equipo de ${incoming} pies no puede ir encima de uno de ${centerFeet} pies que está al centro.`;
      }
      if ((feetA != null || feetB != null) && (feetA == null || feetB == null || feetA < incoming || feetB < incoming)) {
        return `Un equipo de ${incoming} pies en el centro necesita un 40 debajo, o un 20 en cada mitad.`;
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
