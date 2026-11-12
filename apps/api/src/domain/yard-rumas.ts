/** Plantillas de rumas para los depósitos demo. La forma es fija; los equipos se reparten al azar. */

export type RumaSlot = { row: number; col: number; level: number };

export type RumaTemplate = {
  id: string;
  name: string;
  detail: string;
  cells: RumaSlot[];
};

export type RumaZone = { name: string; rows: number; cols: number; levels: number };

export type RumaContainer = { iso: string; feet: number };

export type RumaPlacement = {
  iso: string;
  lado: string;
  ruma: number;
  columna: number;
  nivel: number;
  half: "A" | "B" | null;
};

export type PerimeterSideInput = {
  id: string;
  kind: string;
  containerFeet: number;
  levels: number;
  slots: number;
  wallSlots?: number[];
};

export type PerimeterCell = {
  sideId: string;
  slot: number;
  level: number;
  iso: string;
  half?: "A" | "B";
};

function levels(col: number, row: number, height: number): RumaSlot[] {
  const cells: RumaSlot[] = [];
  for (let level = 1; level <= height; level += 1) cells.push({ row, col, level });
  return cells;
}

export const YARD_RUMA_TEMPLATES: RumaTemplate[] = [
  {
    id: "tapada",
    name: "Ruma tapada",
    detail: "La fila del medio queda en el nivel 1 y las de al lado suben a 5. Hay que mover para sacarla.",
    cells: [...levels(1, 1, 5), ...levels(1, 2, 1), ...levels(1, 3, 5)],
  },
  {
    id: "escalera",
    name: "Escalera",
    detail: "Cada fila es un nivel más alta. Sirve para ver qué tiene vista y qué queda tapado.",
    cells: [...levels(1, 1, 1), ...levels(1, 2, 2), ...levels(1, 3, 3), ...levels(1, 4, 4), ...levels(1, 5, 5)],
  },
  {
    id: "vista",
    name: "Con vista",
    detail: "Solo la fila de adelante, con alturas 5, 3 y 1. El stacker llega sin mover las filas de atrás.",
    cells: [...levels(1, 1, 5), ...levels(2, 1, 3), ...levels(3, 1, 1)],
  },
  {
    id: "cargado",
    name: "Patio cargado",
    detail: "En cada zona hay una ruma tapada, una escalera y una fila libre. En una ruma alta el nivel 1 son dos de 20 y encima va un 40.",
    cells: [
      ...levels(1, 1, 5),
      ...levels(1, 2, 1),
      ...levels(1, 3, 5),
      ...levels(2, 1, 1),
      ...levels(2, 2, 2),
      ...levels(2, 3, 3),
      ...levels(2, 4, 4),
      ...levels(3, 1, 2),
    ],
  },
  {
    id: "aleatorio",
    name: "Aleatorio",
    detail: "Cada carga cambia las alturas. Las rumas siempre apoyan desde el nivel 1.",
    cells: [],
  },
];

export function yardRumaTemplate(id: string): RumaTemplate | null {
  return YARD_RUMA_TEMPLATES.find((item) => item.id === id) || null;
}

/** Alturas distintas, siempre apoyadas. La columna 1 deja una fila baja entre dos altas. */
export function randomRumaCells(random: () => number): RumaSlot[] {
  const wall = 3 + Math.floor(random() * 3);
  const cells: RumaSlot[] = [];
  for (let row = 1; row <= 4; row += 1) {
    const height = row === 2 ? 1 : row === 4 ? Math.floor(random() * 3) : wall;
    cells.push(...levels(1, row, height));
  }
  for (let row = 1; row <= 4; row += 1) cells.push(...levels(2, row, 1 + Math.floor(random() * 5)));
  cells.push(...levels(3, 1, 1 + Math.floor(random() * 5)));
  return cells;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = next[index];
    next[index] = next[swap];
    next[swap] = current;
  }
  return next;
}

type OpenSlot = { lado: string; ruma: number; columna: number; nivel: number };

function stacksOf(zones: RumaZone[], cells: RumaSlot[]): OpenSlot[][] {
  const stacks = new Map<string, OpenSlot[]>();
  for (const zone of zones) {
    for (const cell of cells) {
      if (cell.row > zone.rows || cell.col > zone.cols || cell.level > zone.levels || cell.level < 1) continue;
      const key = `${zone.name}|${cell.col}|${cell.row}`;
      const slot = { lado: zone.name, ruma: cell.row, columna: cell.col, nivel: cell.level };
      const stack = stacks.get(key);
      if (stack) stack.push(slot);
      else stacks.set(key, [slot]);
    }
  }
  return [...stacks.values()].map((stack) => stack.sort((a, b) => a.nivel - b.nivel));
}

function takeNext(pile: RumaContainer[], used: Set<string>): RumaContainer | null {
  const item = pile.find((entry) => !used.has(entry.iso));
  if (!item) return null;
  used.add(item.iso);
  return item;
}

function takePair(pile: RumaContainer[], used: Set<string>): [RumaContainer, RumaContainer] | null {
  const free = pile.filter((entry) => !used.has(entry.iso));
  if (free.length < 2) return null;
  used.add(free[0].iso);
  used.add(free[1].iso);
  return [free[0], free[1]];
}

function placeAt(placed: RumaPlacement[], slot: OpenSlot, iso: string, half: "A" | "B" | null) {
  placed.push({ iso, lado: slot.lado, ruma: slot.ruma, columna: slot.columna, nivel: slot.nivel, half });
}

function supportOf(placed: Array<{ nivel: number; half: "A" | "B" | null | undefined }>, level: number) {
  const below = placed.filter((item) => item.nivel === level - 1);
  const full = below.some((item) => !item.half);
  const pair = below.some((item) => item.half === "A") && below.some((item) => item.half === "B");
  return { full, pair, holdsForty: level <= 1 || full || pair };
}

/**
 * Reparte equipos sobre la plantilla.
 * Un 40 se apoya en un 40 o en dos de 20, uno en cada mitad. Un solo 20 no lleva nada encima.
 * Si no alcanzan, la ruma queda más baja y no flota un nivel.
 */
export function fillRumaTemplate(
  zones: RumaZone[],
  templateId: string,
  containers: RumaContainer[],
  random: () => number = Math.random,
): RumaPlacement[] {
  const template = yardRumaTemplate(templateId);
  if (!template) return [];
  const cells = template.id === "aleatorio" ? randomRumaCells(random) : template.cells;
  const stacks = stacksOf(zones, cells);
  const unique = new Map<string, RumaContainer>();
  for (const item of containers) {
    const iso = String(item.iso || "").trim().toUpperCase();
    if (iso && !unique.has(iso)) unique.set(iso, { iso, feet: item.feet });
  }
  const all = [...unique.values()];
  const wide = shuffle(all.filter((item) => item.feet === 40), random);
  const twenties = shuffle(all.filter((item) => item.feet === 20), random);
  const used = new Set<string>();
  const placed: RumaPlacement[] = [];
  const pairBase = new Set<string>();
  const seenZone = new Set<string>();
  for (const stack of stacks) {
    const zone = stack[0].lado;
    if (stack.length >= 2 && !seenZone.has(zone)) {
      seenZone.add(zone);
      pairBase.add(`${zone}|${stack[0].columna}|${stack[0].ruma}`);
    }
  }
  for (const stack of stacks) {
    const key = `${stack[0].lado}|${stack[0].columna}|${stack[0].ruma}`;
    const column: RumaPlacement[] = [];
    for (const slot of stack) {
      const support = supportOf(column, slot.nivel);
      if (!support.holdsForty) break;
      if (slot.nivel === 1 && pairBase.has(key)) {
        const pair = takePair(twenties, used);
        if (pair) {
          placeAt(column, slot, pair[0].iso, "A");
          placeAt(column, slot, pair[1].iso, "B");
          continue;
        }
      }
      const forty = takeNext(wide, used);
      if (forty) {
        placeAt(column, slot, forty.iso, null);
        continue;
      }
      const pair = takePair(twenties, used);
      if (pair) {
        placeAt(column, slot, pair[0].iso, "A");
        placeAt(column, slot, pair[1].iso, "B");
        continue;
      }
      const single = takeNext(twenties, used);
      if (single) placeAt(column, slot, single.iso, "A");
      break;
    }
    placed.push(...column);
  }
  return placed;
}

/** Llena los lados de contenedores del cerco. Un 40 del cerco también necesita un 40 o dos de 20 debajo. */
export function fillPerimeter(
  sides: PerimeterSideInput[],
  containers: RumaContainer[],
  used: Set<string>,
  random: () => number = Math.random,
): PerimeterCell[] {
  const unique = new Map<string, RumaContainer>();
  for (const item of containers) {
    const iso = String(item.iso || "").trim().toUpperCase();
    if (iso && !unique.has(iso) && !used.has(iso)) unique.set(iso, { iso, feet: item.feet });
  }
  const all = [...unique.values()];
  const wide = shuffle(all.filter((item) => item.feet === 40), random);
  const twenties = shuffle(all.filter((item) => item.feet === 20), random);
  const cells: PerimeterCell[] = [];
  for (const side of sides) {
    if (side.kind !== "contenedores" && side.kind !== "mixto") continue;
    const blocked = new Set(side.wallSlots || []);
    const levels = Math.max(1, Math.min(3, Math.round(side.levels) || 1));
    const slots = Math.max(0, Math.round(side.slots) || 0);
    for (let slot = 1; slot <= slots; slot += 1) {
      if (blocked.has(slot)) continue;
      const column: PerimeterCell[] = [];
      for (let level = 1; level <= levels; level += 1) {
        const support = supportOf(column.map((cell) => ({ nivel: cell.level, half: cell.half || null })), level);
        if (!support.holdsForty) break;
        const wideSlot = side.containerFeet >= 40;
        if (wideSlot && level === 1 && slot % 2 === 1) {
          const pair = takePair(twenties, used);
          if (pair) {
            column.push({ sideId: side.id, slot, level, iso: pair[0].iso, half: "A" }, { sideId: side.id, slot, level, iso: pair[1].iso, half: "B" });
            continue;
          }
        }
        if (wideSlot) {
          const forty = takeNext(wide, used);
          if (forty) {
            column.push({ sideId: side.id, slot, level, iso: forty.iso });
            continue;
          }
          const pair = takePair(twenties, used);
          if (pair) {
            column.push({ sideId: side.id, slot, level, iso: pair[0].iso, half: "A" }, { sideId: side.id, slot, level, iso: pair[1].iso, half: "B" });
            continue;
          }
          break;
        }
        const twenty = takeNext(twenties, used);
        if (!twenty) break;
        column.push({ sideId: side.id, slot, level, iso: twenty.iso });
      }
      cells.push(...column);
    }
  }
  return cells;
}
