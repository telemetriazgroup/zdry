import { yardScenario } from "./yard-scenarios";
import { defaultYardPlan, fenceBays, ghostsWithSupport, leftToCustomer, movesAbove, movesToReach, normalizeYardPlan, reachBlockers, stackLengthError, zoneSlotError } from "./yard-plan";

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

  it("guarda un perímetro irregular con pared, contenedores y una entrada", () => {
    const plan = normalizeYardPlan({
      zones: [{ id: "a", name: "Zona A", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 1 }],
      perimeter: {
        sides: [
          { id: "norte", name: "Norte", lengthM: 80, turnDeg: 90, kind: "pared" },
          { id: "este", name: "Este", lengthM: 40, turnDeg: 70, kind: "mixto", containerFeet: 20, wallM: 10 },
          { id: "sur", name: "Sur", lengthM: 70, turnDeg: 110, kind: "contenedores", containerFeet: 40 },
          { id: "oeste", name: "Oeste", lengthM: 30, turnDeg: 90, kind: "pared" },
          { id: "esquina", name: "Esquina", lengthM: 18, turnDeg: 90, kind: "pared" },
        ],
        gates: [{ id: "principal", sideId: "norte", name: "Entrada principal", atM: 20, widthM: 12 }],
      },
    });
    expect(plan.perimeter.sides).toHaveLength(5);
    expect(plan.perimeter.sides[1]).toMatchObject({ kind: "mixto", containerFeet: 20, wallM: 10, levels: 1 });
    expect(plan.perimeter.gates[0]).toMatchObject({ sideId: "norte", atM: 20, widthM: 12 });
    const withHalves = normalizeYardPlan({
      zones: [{ id: "a", name: "A", rows: 2, cols: 2, levels: 2, gridRow: 1, gridCol: 1, xM: 6, zM: 8 }],
      perimeter: {
        sides: [
          { id: "norte", name: "Norte", lengthM: 40, turnDeg: 90, kind: "contenedores", containerFeet: 40 },
          { id: "este", name: "Este", lengthM: 20, turnDeg: 90, kind: "pared" },
          { id: "sur", name: "Sur", lengthM: 40, turnDeg: 90, kind: "pared" },
        ],
        cells: [
          { sideId: "norte", slot: 1, level: 1, iso: "MSKU1234567" },
          { sideId: "norte", slot: 2, level: 1, iso: "CBHU1111111", half: "A" },
          { sideId: "norte", slot: 2, level: 1, iso: "CBHU2222222", half: "B" },
        ],
      },
    });
    expect(withHalves.zones[0]).toMatchObject({ xM: 6, zM: 8 });
    expect(withHalves.perimeter.cells.map((cell) => cell.half || "full")).toEqual(["full", "A", "B"]);
    expect(normalizeYardPlan({ zones: [{ id: "a", name: "A", rows: 2, cols: 2, levels: 2 }] }).perimeter).toEqual({ sides: [], gates: [], cells: [] });
  });

  it("mezcla 20 y 40 en un lado y guarda un desconocido con su color y su fila", () => {
    const side = { lengthM: 36.6, kind: "contenedores" as const, containerFeet: 40 as const, wallM: 0, bays: [{ feet: 40 as const, rows: 1 }, { feet: 20 as const, rows: 2 }, { feet: 40 as const, rows: 1 }] };
    expect(fenceBays(side).map((bay) => [bay.feet, bay.rows])).toEqual([[40, 1], [20, 2], [40, 1], [20, 1]]);
    const plan = normalizeYardPlan({
      zones: [{ id: "a", name: "A", rows: 2, cols: 2, levels: 2, gridRow: 1, gridCol: 1 }],
      perimeter: {
        sides: [
          { id: "fondo", name: "Fondo", lengthM: 36.6, turnDeg: 90, kind: "contenedores", containerFeet: 40, levels: 3, bays: side.bays },
          { id: "este", name: "Este", lengthM: 20, turnDeg: 90, kind: "pared" },
          { id: "oeste", name: "Oeste", lengthM: 20, turnDeg: 90, kind: "pared" },
        ],
        cells: [
          { sideId: "fondo", slot: 2, level: 1, row: 2, iso: "sin-ficha", unknown: true, color: "#F76707", typeCode: "20", note: "naranja", kind: "reefer" },
        ],
      },
    });
    expect(plan.perimeter.sides[0].levels).toBe(3);
    expect(plan.perimeter.sides[0].bays).toEqual([{ feet: 40, rows: 1 }, { feet: 20, rows: 2 }, { feet: 40, rows: 1 }]);
    expect(plan.perimeter.cells[0]).toMatchObject({ slot: 2, row: 2, unknown: true, color: "#f76707", typeCode: "20", iso: "SIN-FICHA", kind: "REEFER" });
    expect(plan.equipmentKinds).toEqual(["REEFER", "TUNEL", "POWERPACK", "MODULO", "OTROS"]);
    const withGear = normalizeYardPlan({
      zones: [{ id: "a", name: "A", rows: 2, cols: 2, levels: 2 }],
      outsiders: [{ id: "eq-1", code: "pp-9", feet: 20, kind: "powerpack", note: "patio" }, { code: "DESCONOCIDO", kind: "OTROS" }],
    });
    expect(withGear.outsiders).toEqual([{ id: "eq-1", code: "PP-9", feet: 20, kind: "POWERPACK", note: "patio" }]);
    const withMedia = normalizeYardPlan({
      zones: [{ id: "a", name: "A", rows: 2, cols: 2, levels: 2 }],
      outsiders: [{
        id: "eq-1",
        code: "PP-9",
        feet: 20,
        kind: "POWERPACK",
        media: [
          { id: "m1", kind: "photo", slot: 0, storageKey: "yard-gear/d/eq-1/m1.jpg", mime: "image/jpeg", name: "frente.jpg" },
          { id: "m2", kind: "photo", slot: 0, storageKey: "yard-gear/d/eq-1/m2.jpg", mime: "image/jpeg", name: "otra.jpg" },
          { id: "malo", kind: "photo", storageKey: "otro/sitio.jpg", mime: "image/jpeg" },
        ],
      }],
    });
    expect(withMedia.outsiders[0].media).toEqual([
      { id: "m1", kind: "photo", slot: 0, storageKey: "yard-gear/d/eq-1/m1.jpg", mime: "image/jpeg", name: "frente.jpg" },
      { id: "m2", kind: "photo", storageKey: "yard-gear/d/eq-1/m2.jpg", mime: "image/jpeg", name: "otra.jpg" },
    ]);
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

  it("guarda el lado de la zona por el que el stacker no entra", () => {
    const plan = normalizeYardPlan({
      zones: [{ id: "a", name: "Zona A", rows: 3, cols: 1, levels: 5, closedSide: "fondo" }],
    });
    expect(plan.zones[0].closedSide).toBe("fondo");
    expect(normalizeYardPlan({ zones: [{ id: "a", name: "Zona A", rows: 3, cols: 1, levels: 5, closedSide: "techo" }] }).zones[0].closedSide).toBeUndefined();
  });

  it("cuenta la fila de al lado que le tapa la vista al stacker", () => {
    const zones = [{ id: "a", name: "Zona A", rows: 3, cols: 1, levels: 5, gridRow: 1, gridCol: 1, closedSide: "fondo" as const }];
    const wall = (row: number) => [1, 2, 3, 4, 5].map((level) => ({ zoneName: "Zona A", row, col: 1, level, iso: `R${row}N${level}`, type: "40HC" }));
    const occupied = [
      ...wall(1),
      { zoneName: "Zona A", row: 2, col: 1, level: 1, iso: "MEDIO", type: "40HC" },
      ...wall(3),
    ];
    const blocked = movesToReach(zones, [], occupied, "Zona A", 2, 1, 1, "MEDIO", null, "40HC");
    expect(blocked).toEqual({ above: 0, beside: 4, total: 4 });
    const eitherSide = movesToReach([{ ...zones[0], closedSide: undefined }], [], occupied, "Zona A", 2, 1, 1, "MEDIO", null, "40HC");
    expect(eitherSide.beside).toBe(4);
    const clearFront = occupied.filter((cell) => !(cell.row === 1 && cell.level > 1));
    expect(movesToReach([{ ...zones[0], closedSide: undefined }], [], clearFront, "Zona A", 2, 1, 1, "MEDIO", null, "40HC").beside).toBe(0);
    expect(movesToReach(zones, [], clearFront, "Zona A", 2, 1, 1, "MEDIO", null, "40HC").beside).toBe(0);
    expect(movesToReach([{ ...zones[0], closedSide: "frente" }], [], clearFront, "Zona A", 2, 1, 1, "MEDIO", null, "40HC").beside).toBe(4);
    const top = movesToReach(zones, [], occupied, "Zona A", 2, 1, 5, "ALTO", null, "40HC");
    expect(top.beside).toBe(0);
  });

  it("marca el 40 que está encima del 20 y los de la fila que tapa", () => {
    const zones = [{ id: "b", name: "Zona B", rows: 3, cols: 1, levels: 5, gridRow: 1, gridCol: 1, closedSide: "frente" as const }];
    const occupied = [
      { zoneName: "Zona B", row: 1, col: 1, level: 4, iso: "CUARENTA", type: "40DC" },
      { zoneName: "Zona B", row: 1, col: 1, level: 5, iso: "TOPE", type: "40DC" },
      { zoneName: "Zona B", row: 1, col: 1, level: 3, iso: "CORTO", type: "20DC", half: "A" as const },
      { zoneName: "Zona B", row: 2, col: 1, level: 5, iso: "AL_LADO", type: "40DC" },
    ];
    const blockers = reachBlockers(zones, [], occupied, "Zona B", 1, 1, 3, "CORTO", "A", "20DC");
    expect(blockers.map((item) => item.iso).sort()).toEqual(["AL_LADO", "CUARENTA", "TOPE"]);
    expect(reachBlockers(zones, [], occupied, "Zona B", 1, 1, 5, "TOPE", null, "40DC")).toEqual([]);
  });

  it("un 20 de la otra mitad no tapa la vista", () => {
    const zones = [{ id: "a", name: "Zona A", rows: 2, cols: 1, levels: 5, gridRow: 1, gridCol: 1, closedSide: "fondo" as const }];
    const occupied = [
      { zoneName: "Zona A", row: 1, col: 1, level: 5, iso: "LADO-B", type: "20DC", half: "B" as const },
      { zoneName: "Zona A", row: 2, col: 1, level: 1, iso: "OBJETIVO", type: "20DC", half: "A" as const },
    ];
    expect(movesToReach(zones, [], occupied, "Zona A", 2, 1, 1, "OBJETIVO", "A", "20DC").beside).toBe(0);
    expect(movesToReach(zones, [], occupied, "Zona A", 2, 1, 1, "OBJETIVO", "B", "20DC").beside).toBe(1);
  });

  it("arma los escenarios de cuatro y seis zonas, con perímetro o sin él", () => {
    const four = yardScenario("cuatro", true);
    const six = yardScenario("seis", true);
    const open = yardScenario("seis", false);
    const saved = yardScenario("guardado", true);
    expect(four?.plan.zones).toHaveLength(4);
    expect(four?.plan.perimeter.sides.map((side) => side.kind)).toEqual(["contenedores", "pared", "contenedores", "pared"]);
    expect(four?.plan.perimeter.sides[0].levels).toBe(2);
    expect(four?.plan.zones.map((zone) => zone.closedSide)).toEqual(["frente", "frente", "fondo", "fondo"]);
    expect(six?.plan.zones).toHaveLength(6);
    expect(six?.plan.perimeter.sides).toHaveLength(4);
    expect(open?.plan.perimeter.sides).toHaveLength(0);
    expect(open?.plan.zones.every((zone) => !zone.closedSide)).toBe(true);
    expect(saved?.plan.zones.map((zone) => zone.name)).toEqual(["Norte A", "Norte B", "Sur A", "Sur B"]);
    expect(saved?.plan.perimeter.sides.map((side) => side.kind)).toEqual(["contenedores", "pared", "contenedores", "pared"]);
    expect(yardScenario("guardado", false)?.plan.perimeter.sides).toHaveLength(0);
  });

  it("separa lo que salió al cliente de lo que sigue a la mano", () => {
    expect(leftToCustomer("Vendido")).toBe(true);
    expect(leftToCustomer("Alquilado")).toBe(true);
    expect(leftToCustomer("Disponible")).toBe(false);
  });
});
