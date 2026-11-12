import { movesToReach } from "./yard-plan";
import { fillRumaTemplate, randomRumaCells, yardRumaTemplate } from "./yard-rumas";

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

  it("recorta lo que no cabe en la zona y no mezcla 20 con 40 en la misma ruma", () => {
    const small = { name: "Chica", rows: 3, cols: 1, levels: 4 };
    const placed = fillRumaTemplate([small], "tapada", [...boxes("C", 2, 40), ...boxes("V", 6, 20)], () => 0);
    expect(placed.every((item) => item.columna === 1 && item.nivel <= 4 && item.ruma <= 3)).toBe(true);
    const byStack = new Map<string, number[]>();
    for (const item of placed) {
      const feet = item.iso.startsWith("C") ? 40 : 20;
      const key = `${item.ruma}`;
      byStack.set(key, [...(byStack.get(key) || []), feet]);
    }
    for (const feet of byStack.values()) expect(new Set(feet).size).toBe(1);
    expect(placed.some((item) => item.nivel > 1 && !placed.some((under) => under.ruma === item.ruma && under.nivel === item.nivel - 1))).toBe(false);
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
