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
    detail: "En cada zona hay una ruma tapada, una escalera y una fila libre. Es la plantilla para practicar traslados.",
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

/**
 * Reparte equipos sobre la plantilla. Una ruma no mezcla 20 y 40.
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
  const wide = shuffle(all.filter((item) => item.feet >= 40 || item.feet <= 0), random);
  const narrow = shuffle(all.filter((item) => item.feet > 0 && item.feet < 40), random);
  const used = new Set<string>();
  const placed: RumaPlacement[] = [];
  const takeFrom = (pile: RumaContainer[], count: number) => {
    const free = pile.filter((item) => !used.has(item.iso));
    return free.slice(0, count);
  };
  for (const stack of stacks) {
    const wideTake = takeFrom(wide, stack.length);
    const chosen = wideTake.length ? wideTake : takeFrom(narrow, stack.length);
    chosen.forEach((item, index) => {
      used.add(item.iso);
      const slot = stack[index];
      placed.push({ iso: item.iso, lado: slot.lado, ruma: slot.ruma, columna: slot.columna, nivel: slot.nivel });
    });
  }
  return placed;
}
