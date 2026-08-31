import { completeIso } from "./iso6346";
import {
  DEFAULT_LAYOUT_RULES,
  DEFAULT_YARD_CONFIG,
  YardUnit,
  availableSlotsFor,
  bestSlotFor,
  blockedColumnMessage,
  compactYardGravity,
  containerCommitted,
  gravityMessage,
  mixMoveMessage,
  movesToRetrieve,
  needsYardPlacement,
  validateMove,
} from "./yard";

const CFG = DEFAULT_YARD_CONFIG;
const RULES = DEFAULT_LAYOUT_RULES;
const D = "d1";

function unit(partial: Partial<YardUnit> & Pick<YardUnit, "iso">): YardUnit {
  return {
    type: "20GP",
    cat: "CW",
    manufacturer: "CIMC",
    depotId: D,
    lado: null,
    ruma: null,
    columna: null,
    nivel: null,
    status: "Disponible",
    physicallyReceived: true,
    ...partial,
  };
}

function placed(
  iso: string,
  type: string,
  cat: string,
  columna: number,
  nivel: number,
  extra: Partial<YardUnit> = {},
): YardUnit {
  return unit({
    iso,
    type,
    cat,
    lado: "Izquierda",
    ruma: 1,
    columna,
    nivel,
    ...extra,
  });
}

describe("reglas de patio (oráculo HTML)", () => {
  it("regla 6: 20 y 40 no pueden compartir columna", () => {
    const occupants = [placed("A", "20GP", "CW", 1, 1)];
    const moving = unit({ iso: "B", type: "40HC", cat: "CW" });
    const result = validateMove(occupants, moving, D, "Izquierda", 1, 1, 2, CFG, RULES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("YARD_MIX");
      expect(result.message).toBe(mixMoveMessage("B", "Izquierda", 1, 1, RULES));
      expect(result.message).toContain("otro tamaño");
      expect(result.message).toContain("distinta condición (nuevo/usado)");
    }
  });

  it("regla 7: 1TRIP y CW no se mezclan si groupCategoria", () => {
    const occupants = [placed("A", "40HC", "1TRIP", 1, 1)];
    const moving = unit({ iso: "B", type: "40HC", cat: "CW" });
    const result = validateMove(occupants, moving, D, "Izquierda", 1, 1, 2, CFG, RULES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("YARD_MIX");
  });

  it("regla 7: 1TRIP y CW sí se mezclan si groupCategoria está apagado", () => {
    const occupants = [placed("A", "40HC", "1TRIP", 1, 1)];
    const moving = unit({ iso: "B", type: "40HC", cat: "CW" });
    const rules = { ...RULES, groupCategoria: false };
    const result = validateMove(occupants, moving, D, "Izquierda", 1, 1, 2, CFG, rules);
    expect(result).toEqual({ ok: true });
  });

  it("regla 8: no se puede colocar en nivel 3 si el 1 está vacío", () => {
    const moving = unit({ iso: "A", type: "20GP", cat: "CW" });
    const result = validateMove([], moving, D, "Izquierda", 1, 1, 3, CFG, RULES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("YARD_GRAVITY");
      expect(result.message).toBe(gravityMessage(1));
    }
  });

  it("regla 9: columna 2 bloqueada hasta que la 1 esté llena", () => {
    const occupants = [placed("A", "20GP", "CW", 1, 1)];
    const moving = unit({ iso: "B", type: "20GP", cat: "CW" });
    const result = validateMove(occupants, moving, D, "Izquierda", 1, 2, 1, CFG, RULES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("YARD_BLOCKED_COLUMN");
      expect(result.message).toBe(blockedColumnMessage(2, 5));
    }
  });

  it("regla 9: columna 2 se habilita cuando la 1 tiene 5 niveles", () => {
    const occupants = [1, 2, 3, 4, 5].map((n) => placed(`U${n}`, "20GP", "CW", 1, n));
    const moving = unit({ iso: "NEXT", type: "20GP", cat: "CW" });
    const result = validateMove(occupants, moving, D, "Izquierda", 1, 2, 1, CFG, RULES);
    expect(result).toEqual({ ok: true });
  });

  it("bestSlotFor en patio vacío es Izquierda · Ruma 1 · Columna 1 · Nivel 1", () => {
    const slot = bestSlotFor([], D, "40HC", "CW", CFG, RULES);
    expect(slot).toEqual({
      lado: "Izquierda",
      ruma: 1,
      columna: 1,
      nivel: 1,
      consolidating: false,
    });
  });

  it("bestSlotFor prefiere consolidar una columna empezada", () => {
    const occupants = [placed("A", "40HC", "CW", 1, 1)];
    const slot = bestSlotFor(occupants, D, "40HC", "CW", CFG, RULES);
    expect(slot).toMatchObject({ lado: "Izquierda", ruma: 1, columna: 1, nivel: 2, consolidating: true });
  });

  it("availableSlotsFor con manufacturer opcional (groupProveedor apagado no filtra)", () => {
    const occupants = [placed("A", "20GP", "CW", 1, 1, { manufacturer: "CIMC" })];
    const withManu = availableSlotsFor(occupants, D, "20GP", "CW", "Singamas", CFG, RULES);
    const without = availableSlotsFor(occupants, D, "20GP", "CW", undefined, CFG, RULES);
    expect(withManu[0]).toMatchObject({ columna: 1, nivel: 2, consolidating: true });
    expect(without[0]).toMatchObject({ columna: 1, nivel: 2 });
  });

  it("containerCommitted: vendido con lado ocupa; vendido sin lado no", () => {
    expect(containerCommitted({ status: "Vendido", lado: "Izquierda" })).toBe(true);
    expect(containerCommitted({ status: "Vendido", lado: null })).toBe(false);
    expect(containerCommitted({ status: "Disponible", lado: "Izquierda" })).toBe(false);
  });

  it("needsYardPlacement: recibida sin lado; despachada no", () => {
    expect(needsYardPlacement({ physicallyReceived: true, lado: null, status: "Disponible" })).toBe(true);
    expect(needsYardPlacement({ physicallyReceived: true, lado: null, status: "Vendido" })).toBe(false);
    expect(needsYardPlacement({ physicallyReceived: false, lado: null, status: "Pendiente de ingreso" })).toBe(false);
    expect(needsYardPlacement({ physicallyReceived: true, lado: "Izquierda", status: "Disponible" })).toBe(false);
  });

  it("compactYardGravity cierra huecos reasignando nivel = idx+1", () => {
    const occupants = [
      placed("LOW", "20GP", "CW", 1, 1),
      placed("HIGH", "20GP", "CW", 1, 4),
    ];
    const changes = compactYardGravity(occupants, CFG);
    expect(changes).toEqual([
      expect.objectContaining({ iso: "HIGH", fromNivel: 4, toNivel: 2 }),
    ]);
    expect(occupants.find((c) => c.iso === "HIGH")?.nivel).toBe(2);
    expect(occupants.find((c) => c.iso === "LOW")?.nivel).toBe(1);
  });

  it("movesToRetrieve cuenta unidades encima sin filtrar por status", () => {
    const occupants = [
      placed("BASE", "20GP", "CW", 1, 1),
      placed("MID", "20GP", "CW", 1, 2, { status: "Vendido" }),
      placed("TOP", "20GP", "CW", 1, 3),
    ];
    expect(movesToRetrieve(occupants, occupants[0])).toBe(2);
    expect(movesToRetrieve(occupants, occupants[1])).toBe(1);
    expect(movesToRetrieve(occupants, occupants[2])).toBe(0);
  });

  it("unidad comprometida sigue ocupando la celda para bestSlotFor", () => {
    const occupants = [
      placed("SOLD", "40HC", "CW", 1, 1, { status: "Vendido" }),
    ];
    const slot = bestSlotFor(occupants, D, "40HC", "CW", CFG, RULES);
    expect(slot).toMatchObject({ columna: 1, nivel: 2 });
    const mix = validateMove(
      occupants,
      unit({ iso: completeIso("ZDRU000020"), type: "20GP", cat: "CW" }),
      D,
      "Izquierda",
      1,
      1,
      2,
      CFG,
      RULES,
    );
    expect(mix.ok).toBe(false);
  });
});
