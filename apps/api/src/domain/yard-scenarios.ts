import { normalizeYardPlan, type YardPlan, type YardZone, type ZoneClosedSide } from "./yard-plan";

export type YardScenarioId = "guardado" | "cuatro" | "seis";

export const YARD_SCENARIOS: { id: YardScenarioId; name: string }[] = [
  { id: "guardado", name: "Demo guardado" },
  { id: "cuatro", name: "4 zonas y paredes" },
  { id: "seis", name: "6 zonas y paredes" },
];

/** Plano del depósito demo al momento de guardarlo: cuatro zonas y el cerco. Las posiciones no van en el plano. */
const SAVED_DEMO: YardPlan = {
  zones: [
    { id: "zona-norte-a", name: "Norte A", rows: 4, cols: 4, levels: 5, gridRow: 1, gridCol: 1, xM: 6, zM: 8, closedSide: "frente" },
    { id: "zona-norte-b", name: "Norte B", rows: 4, cols: 4, levels: 5, gridRow: 1, gridCol: 2, xM: 64, zM: 8, closedSide: "frente" },
    { id: "zona-sur-a", name: "Sur A", rows: 5, cols: 4, levels: 5, gridRow: 2, gridCol: 1, xM: 6, zM: 54, closedSide: "fondo" },
    { id: "zona-sur-b", name: "Sur B", rows: 5, cols: 4, levels: 5, gridRow: 2, gridCol: 2, xM: 64, zM: 54, closedSide: "fondo" },
  ],
  aisles: [],
  ghosts: [],
  perimeter: {
    sides: [
      { id: "lado-norte", name: "Norte", lengthM: 116, turnDeg: 90, kind: "contenedores", containerFeet: 40, wallM: 0, levels: 2, wallSlots: [] },
      { id: "lado-este", name: "Este", lengthM: 71, turnDeg: 90, kind: "pared", containerFeet: 40, wallM: 0, levels: 1, wallSlots: [] },
      { id: "lado-sur", name: "Sur", lengthM: 116, turnDeg: 90, kind: "contenedores", containerFeet: 40, wallM: 0, levels: 2, wallSlots: [] },
      { id: "lado-oeste", name: "Oeste", lengthM: 71, turnDeg: 90, kind: "pared", containerFeet: 40, wallM: 0, levels: 1, wallSlots: [] },
    ],
    gates: [
      { id: "entrada-este", sideId: "lado-este", name: "Entrada este", atM: 28, widthM: 14 },
      { id: "entrada-oeste", sideId: "lado-oeste", name: "Entrada oeste", atM: 28, widthM: 14 },
    ],
    cells: [],
  },
};

function block(id: string, name: string, gridRow: number, gridCol: number, closedSide: ZoneClosedSide): YardZone {
  return {
    id,
    name,
    rows: 4,
    cols: 3,
    levels: 5,
    gridRow,
    gridCol,
    ...(closedSide ? { closedSide } : {}),
  };
}

function wallBox(width: number, depth: number): YardPlan["perimeter"] {
  const wall = (id: string, name: string, lengthM: number) => ({
    id,
    name,
    lengthM,
    turnDeg: 90,
    kind: "pared" as const,
    containerFeet: 40 as const,
    wallM: 0,
    levels: 1,
    wallSlots: [] as number[],
  });
  const containers = (id: string, name: string, lengthM: number) => ({
    id,
    name,
    lengthM,
    turnDeg: 90,
    kind: "contenedores" as const,
    containerFeet: 40 as const,
    wallM: 0,
    levels: 2,
    wallSlots: [] as number[],
  });
  return {
    sides: [containers("norte", "Norte", width), wall("este", "Este", depth), containers("sur", "Sur", width), wall("oeste", "Oeste", depth)],
    gates: [{ id: "entrada", sideId: "este", name: "Entrada", atM: Math.max(0, Math.round(depth / 2 - 6)), widthM: 12 }],
    cells: [],
  };
}

function outline(zones: YardZone[]) {
  const maxCols = Math.max(...zones.map((zone) => zone.cols), 1);
  const maxRows = Math.max(...zones.map((zone) => zone.rows), 1);
  const gridCols = Math.max(...zones.map((zone) => zone.gridCol), 1);
  const gridRows = Math.max(...zones.map((zone) => zone.gridRow), 1);
  const width = gridCols * maxCols * 12.9 + Math.max(0, gridCols - 1) * 8 + 16;
  const depth = gridRows * maxRows * 2.99 + Math.max(0, gridRows - 1) * 8 + 16;
  return { width: Math.max(20, Math.round(width)), depth: Math.max(20, Math.round(depth)) };
}

function openZones(zones: YardZone[]): YardZone[] {
  return zones.map((zone) => {
    const next = { ...zone };
    delete next.closedSide;
    return next;
  });
}

function walled(zones: YardZone[], withPerimeter: boolean): YardPlan {
  const size = outline(zones);
  return normalizeYardPlan({
    zones: withPerimeter ? zones : openZones(zones),
    aisles: [],
    ghosts: [],
    perimeter: withPerimeter ? wallBox(size.width, size.depth) : { sides: [], gates: [], cells: [] },
  });
}

export function yardScenario(id: string, withPerimeter: boolean): { name: string; plan: YardPlan } | null {
  if (id === "guardado") {
    return {
      name: "Demo guardado",
      plan: normalizeYardPlan({
        ...SAVED_DEMO,
        zones: withPerimeter ? SAVED_DEMO.zones : openZones(SAVED_DEMO.zones),
        perimeter: withPerimeter ? SAVED_DEMO.perimeter : { sides: [], gates: [], cells: [] },
      }),
    };
  }
  if (id === "cuatro") {
    const zones = [
      block("zona-a", "Zona A", 1, 1, "frente"),
      block("zona-b", "Zona B", 1, 2, "frente"),
      block("zona-c", "Zona C", 2, 1, "fondo"),
      block("zona-d", "Zona D", 2, 2, "fondo"),
    ];
    return { name: "4 zonas y paredes", plan: walled(zones, withPerimeter) };
  }
  if (id === "seis") {
    const zones = [
      block("zona-a", "Zona A", 1, 1, "frente"),
      block("zona-b", "Zona B", 1, 2, "frente"),
      block("zona-c", "Zona C", 1, 3, "frente"),
      block("zona-d", "Zona D", 2, 1, "fondo"),
      block("zona-e", "Zona E", 2, 2, "fondo"),
      block("zona-f", "Zona F", 2, 3, "fondo"),
    ];
    return { name: "6 zonas y paredes", plan: walled(zones, withPerimeter) };
  }
  return null;
}
