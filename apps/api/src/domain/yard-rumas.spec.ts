import { movesToReach } from "./yard-plan";
import { fillPerimeter, fillRumaTemplate, randomRumaCells, yardRumaTemplate } from "./yard-rumas";

const zone = { name: "Zona A", rows: 4, cols: 3, levels: 5 };

function boxes(prefix: string, count: number, feet: number) {
  return Array.from({ length: count }, (_, index) => ({ iso: `${prefix}${index + 1}`, feet }));
}

describe("plantillas de rumas", () => {
  it("la ruma tapada deja el del medio en el nivel 1 entre dos filas de 5", () => {
    const placed = fillRumaTemplate([zone], "tapada", boxes("T", 11, 40), () => 0);
    const middle = placed.filter((item) => item.ruma === 2);
    const side = placed.filter((item) => item.ruma === 1);
    expect(middle.map((item) => item.nivel)).toEqual([1]);
    expect(side).toHaveLength(5);
    const occupied = placed.map((item) => ({
      zoneName: item.lado,
      row: item.ruma,
      col: item.columna,
      level: item.nivel,
      iso: item.iso,
      type: "40DC",
    }));
    const buried = movesToReach(
      [{ id: "a", ...zone, gridRow: 1, gridCol: 1, closedSide: "fondo" }],
      [],
      occupied,
      "Zona A",
      2,
      1,
      1,
      middle[0].iso,
      null,
      "40DC",
    );
    expect(buried.beside).toBe(4);
    expect(yardRumaTemplate("cargado")?.name).toBe("Patio cargado");
  });

  it("recorta lo que no cabe y un 40 solo se apoya en un 40 o en dos de 20", () => {
    const small = { name: "Chica", rows: 3, cols: 1, levels: 4 };
    const placed = fillRumaTemplate([small], "tapada", [...boxes("C", 2, 40), ...boxes("V", 6, 20)], () => 0);
    expect(placed.every((item) => item.columna === 1 && item.nivel <= 4 && item.ruma <= 3)).toBe(true);
    const base = placed.filter((item) => item.ruma === 1 && item.nivel === 1);
    expect(base.map((item) => item.half).sort()).toEqual(["A", "B"]);
    const above = placed.find((item) => item.ruma === 1 && item.nivel === 2);
    expect(above?.half).toBeNull();
    expect(above?.iso.startsWith("C")).toBe(true);
    for (const item of placed.filter((entry) => !entry.half && entry.nivel > 1)) {
      const below = placed.filter((entry) => entry.ruma === item.ruma && entry.columna === item.columna && entry.nivel === item.nivel - 1);
      const pair = below.some((entry) => entry.half === "A") && below.some((entry) => entry.half === "B");
      const full = below.filter((entry) => !entry.half);
      expect(pair || full.length === 1).toBe(true);
    }
    expect(placed.some((item) => item.nivel > 1 && !placed.some((under) => under.ruma === item.ruma && under.nivel === item.nivel - 1))).toBe(false);
  });

  it("el cerco recibe contenedores y un 40 del nivel 2 no queda sobre un solo 20", () => {
    const cells = fillPerimeter(
      [
        { id: "norte", kind: "contenedores", containerFeet: 40, levels: 2, slots: 2 },
        { id: "este", kind: "pared", containerFeet: 40, levels: 1, slots: 0 },
      ],
      [...boxes("C", 2, 40), ...boxes("V", 4, 20)],
      new Set(),
      () => 0,
    );
    expect(cells.every((cell) => cell.sideId === "norte")).toBe(true);
    const slot1 = cells.filter((cell) => cell.slot === 1 && cell.level === 1);
    expect(slot1.map((cell) => cell.half).sort()).toEqual(["A", "B"]);
    expect(cells.find((cell) => cell.slot === 1 && cell.level === 2)?.half).toBeUndefined();
    for (const cell of cells.filter((item) => item.level > 1 && !item.half)) {
      const below = cells.filter((item) => item.sideId === cell.sideId && item.slot === cell.slot && item.level === cell.level - 1);
      const pair = below.some((item) => item.half === "A") && below.some((item) => item.half === "B");
      expect(pair || below.some((item) => !item.half)).toBe(true);
    }
  });

  it("deja fuera un equipo sin largo y no pone nada encima de un solo 20", () => {
    const placed = fillRumaTemplate([zone], "vista", [...boxes("C", 3, 40), ...boxes("V", 1, 20), { iso: "RARO", feet: 0 }], () => 0);
    expect(placed.some((item) => item.iso === "RARO")).toBe(false);
    const lone = placed.find((item) => item.iso === "V1");
    if (lone) {
      expect(lone.half).toBe("A");
      expect(placed.some((item) => item.ruma === lone.ruma && item.columna === lone.columna && item.nivel > lone.nivel)).toBe(false);
    }
  });

  it("si no alcanzan los equipos, la ruma queda más baja", () => {
    const placed = fillRumaTemplate([zone], "vista", boxes("P", 2, 40), () => 0);
    expect(placed.map((item) => item.nivel).sort()).toEqual([1, 2]);
    expect(fillRumaTemplate([zone], "no-existe", boxes("P", 2, 40))).toEqual([]);
  });

  it("el aleatorio siempre apoya desde el nivel 1", () => {
    const cells = randomRumaCells(() => 0.2);
    const rows = new Set(cells.map((cell) => `${cell.col}-${cell.row}`));
    for (const key of rows) {
      const [col, row] = key.split("-").map(Number);
      const levels = cells.filter((cell) => cell.col === col && cell.row === row).map((cell) => cell.level).sort((a, b) => a - b);
      expect(levels[0]).toBe(1);
      expect(levels[levels.length - 1]).toBe(levels.length);
    }
  });
});
