import { defaultYardPlan, ghostsWithSupport, leftToCustomer, movesAbove, normalizeYardPlan, stackLengthError, zoneSlotError } from "./yard-plan";

describe("yard plan", () => {
  it("arranca con una zona 3×4 de altura 5 y un pasillo", () => {
    const plan = defaultYardPlan();
    expect(plan.zones[0]).toMatchObject({ rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 1 });
    expect(plan.aisles[0].afterZoneId).toBe(plan.zones[0].id);
  });

  it("recorta una altura distinta y descarta huecos fuera de la zona", () => {
    const plan = normalizeYardPlan({
      zones: [{ id: "fondo", name: "Fondo", rows: 4, cols: 3, levels: 12 }],
      aisles: [{ id: "p1", name: "Pasillo norte", afterZoneId: "fondo" }],
      ghosts: [
        { zoneId: "fondo", row: 1, col: 1, level: 12 },
        { zoneId: "fondo", row: 1, col: 1, level: 13 },
        { zoneId: "otra", row: 1, col: 1, level: 1 },
      ],
    });
    expect(plan.zones[0].levels).toBe(12);
    expect(plan.ghosts).toEqual([{ zoneId: "fondo", row: 1, col: 1, level: 12 }]);
    expect(zoneSlotError(plan.zones[0], 1, 1, 12)).toBe("");
    expect(zoneSlotError(plan.zones[0], 1, 1, 13)).toContain("supera");
  });

  it("pone A B C en la primera fila y D debajo de A, con calle entre ellas", () => {
    const plan = normalizeYardPlan({
      zones: [
        { id: "a", name: "Zona A", rows: 4, cols: 3, levels: 5 },
        { id: "b", name: "Zona B", rows: 4, cols: 3, levels: 5 },
        { id: "c", name: "Zona C", rows: 4, cols: 3, levels: 5 },
        { id: "d", name: "Zona D", rows: 4, cols: 3, levels: 5, gridRow: 2, gridCol: 1 },
      ],
    });
    const at = (name: string) => plan.zones.find((zone) => zone.name === name);
    expect(at("Zona A")).toMatchObject({ gridRow: 1, gridCol: 1 });
    expect(at("Zona B")).toMatchObject({ gridRow: 1, gridCol: 2 });
    expect(at("Zona C")).toMatchObject({ gridRow: 1, gridCol: 3 });
    expect(at("Zona D")).toMatchObject({ gridRow: 2, gridCol: 1 });
  });

  it("guarda un hueco sin identificar y un equipo que no es dry", () => {
    const plan = normalizeYardPlan({
      zones: [{ id: "a", name: "Zona A", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 1 }],
      ghosts: [
        { zoneId: "a", row: 1, col: 1, level: 1 },
        { zoneId: "a", row: 1, col: 2, level: 1, code: "gen-1", typeCode: "40fr" },
      ],
    });
    expect(plan.ghosts[0]).toEqual({ zoneId: "a", row: 1, col: 1, level: 1 });
    expect(plan.ghosts[1]).toEqual({ zoneId: "a", row: 1, col: 2, level: 1, code: "GEN-1", typeCode: "40FR" });
  });

  it("rellena con desconocidos los niveles debajo y cuenta los de encima", () => {
    const zones = [{ id: "b", name: "Zona B", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 2 }];
    const occupied = [{ zoneName: "Zona B", row: 3, col: 3, level: 5, iso: "SUDU6764999" }];
    const ghosts = ghostsWithSupport(zones, [], occupied);
    expect(ghosts.map((ghost) => ghost.level).sort()).toEqual([1, 2, 3, 4]);
    expect(movesAbove(zones, ghosts, occupied, "Zona B", 3, 3, 5, "SUDU6764999")).toBe(0);
    const buried = [
      ...occupied,
      { zoneName: "Zona B", row: 3, col: 3, level: 2, iso: "HHXU3465956" },
    ];
    const stacked = ghostsWithSupport(zones, ghosts, buried).filter((ghost) => ghost.level !== 2);
    expect(movesAbove(zones, stacked, buried, "Zona B", 3, 3, 2, "HHXU3465956")).toBe(3);
  });

  it("deja un 20 sobre un 40 y rechaza un 40 sobre un 20", () => {
    const zone = { id: "b", name: "Zona B", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 2 };
    const twenty = [{ zoneName: "Zona B", row: 1, col: 1, level: 1, type: "20DC" }];
    const forty = [{ zoneName: "Zona B", row: 1, col: 2, level: 1, type: "40HC" }];
    expect(stackLengthError(zone, [], twenty, "40HC", 1, 1, 2)).toContain("40 pies");
    expect(stackLengthError(zone, [], forty, "20DC", 1, 2, 2)).toBe("");
    expect(stackLengthError(zone, [{ zoneId: "b", row: 1, col: 3, level: 1 }], [], "40HC", 1, 3, 2)).toBe("");
    expect(stackLengthError(zone, [{ zoneId: "b", row: 1, col: 1, level: 2 }], twenty, "40HC", 1, 1, 3)).toContain("20 pies");
    expect(stackLengthError(zone, [], [{ zoneName: "Zona B", row: 1, col: 1, level: 1, type: "10" }], "20", 1, 1, 2)).toContain("20 pies");
    expect(stackLengthError(zone, [], forty, "10", 1, 2, 2)).toBe("");
    const pair = [
      { zoneName: "Zona B", row: 1, col: 1, level: 1, type: "20DC", half: "A" as const },
      { zoneName: "Zona B", row: 1, col: 1, level: 1, type: "20DC", half: "B" as const },
    ];
    expect(stackLengthError(zone, [], pair, "40HC", 1, 1, 2)).toBe("");
    expect(stackLengthError(zone, [], pair, "20DC", 1, 1, 2, "A")).toBe("");
    expect(stackLengthError(zone, [], [pair[0]], "40HC", 1, 1, 2)).toContain("cada mitad");
  });

  it("separa lo que salió al cliente de lo que sigue a la mano", () => {
    expect(leftToCustomer("Vendido")).toBe(true);
    expect(leftToCustomer("Alquilado")).toBe(true);
    expect(leftToCustomer("Disponible")).toBe(false);
  });
});
