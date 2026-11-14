import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { hasRole, useAuth } from "../auth.jsx";
import { NoticeModal } from "../notice.jsx";
import GearMedia from "./GearMedia.jsx";
import { boxColor, fenceBays } from "../yard.js";
import YardScene from "./YardScene.jsx";
import YardUnitDetail from "./YardUnitDetail.jsx";

const LEFT = new Set(["Vendido", "Alquilado", "Retirado por cliente"]);
const FALLBACK_PLAN = {
  zones: [{ id: "zona-a", name: "Zona A", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 1 }],
  aisles: [],
  ghosts: [],
};

let freshSeq = 0;
function freshId(prefix) {
  freshSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${freshSeq.toString(36)}`;
}

function pendingCode(code) {
  const value = String(code || "").trim().toUpperCase();
  return !value || value === "DESCONOCIDO";
}

function withSeats(plan) {
  const zones = (plan.zones || []).map((zone) => ({ ...zone }));
  const taken = new Set();
  for (const zone of zones) {
    const row = Number(zone.gridRow);
    const col = Number(zone.gridCol);
    const key = `${row}:${col}`;
    if (row >= 1 && col >= 1 && row <= 4 && col <= 3 && !taken.has(key)) {
      zone.gridRow = row;
      zone.gridCol = col;
      taken.add(key);
      continue;
    }
    for (let nextRow = 1; nextRow <= 4; nextRow += 1) {
      let seated = false;
      for (let nextCol = 1; nextCol <= 3; nextCol += 1) {
        const slot = `${nextRow}:${nextCol}`;
        if (taken.has(slot)) continue;
        zone.gridRow = nextRow;
        zone.gridCol = nextCol;
        taken.add(slot);
        seated = true;
        break;
      }
      if (seated) break;
    }
  }
  return { ...plan, zones, ghosts: plan.ghosts || [] };
}

function feetOf(type) {
  const code = String(type || "").toUpperCase();
  if (code.startsWith("45")) return 45;
  if (code.startsWith("40")) return 40;
  if (code.startsWith("20")) return 20;
  if (code.startsWith("10")) return 10;
  return 0;
}

function baySpan(type, half) {
  const feet = feetOf(type);
  if (feet >= 40) return "full";
  if (half === "A" || half === "B") return half;
  if (feet > 0) return "center";
  return "full";
}

function spansOverlap(left, right) {
  if (left === "center" || right === "center") return true;
  return left === "full" || right === "full" || left === right;
}

function coversHalf(item, half) {
  const span = baySpan(item.type || item.typeCode, item.bayHalf || item.half);
  return span === "full" || span === half;
}

function occupiesHalf(item, half) {
  const span = baySpan(item.type || item.typeCode, item.bayHalf || item.half);
  return span === "full" || span === "center" || span === half;
}

function isExplicitGhost(ghost, all) {
  if (ghost.code || ghost.typeCode || !ghost.half) return true;
  return all.some(
    (other) => other !== ghost
      && other.zoneId === ghost.zoneId
      && other.row === ghost.row
      && other.col === ghost.col
      && other.level === ghost.level
      && !other.code
      && !other.typeCode
      && other.half
      && other.half !== ghost.half,
  );
}

function supportedGhosts(zones, units, ghosts) {
  const source = ghosts || [];
  const next = source.filter((ghost) => isExplicitGhost(ghost, source)).map((ghost) => ({ ...ghost }));
  const columns = new Map();
  const remember = (zoneId, name, row, col) => columns.set(`${zoneId}:${row}:${col}`, { zoneId, name, row, col });
  for (const ghost of next) {
    const zone = zones.find((item) => item.id === ghost.zoneId);
    if (zone) remember(ghost.zoneId, zone.name, ghost.row, ghost.col);
  }
  for (const unit of units || []) {
    const zone = zones.find((item) => item.name === unit.lado);
    if (zone && unit.ruma && unit.columna && unit.nivel) remember(zone.id, zone.name, unit.ruma, unit.columna);
  }
  for (const column of columns.values()) {
    const at = (level) => [
      ...(units || [])
        .filter((unit) => unit.lado === column.name && unit.ruma === column.row && unit.columna === column.col && unit.nivel === level)
        .map((unit) => ({ type: unit.type, half: unit.bayHalf })),
      ...next
        .filter((ghost) => ghost.zoneId === column.zoneId && ghost.row === column.row && ghost.col === column.col && ghost.level === level)
        .map((ghost) => ({ type: ghost.typeCode, half: ghost.half })),
    ];
    const top = Math.max(
      0,
      ...(units || []).filter((unit) => unit.lado === column.name && unit.ruma === column.row && unit.columna === column.col).map((unit) => unit.nivel || 0),
      ...next.filter((ghost) => ghost.zoneId === column.zoneId && ghost.row === column.row && ghost.col === column.col).map((ghost) => ghost.level),
    );
    for (let level = 1; level < top; level += 1) {
      const here = at(level);
      const above = (half) => {
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

function movesAbove(zones, units, ghosts, zone, row, col, level, iso, half, type) {
  const span = type || half ? baySpan(type, half) : "full";
  const unitsAbove = (units || []).filter(
    (unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel > level && unit.iso !== iso
      && spansOverlap(baySpan(unit.type, unit.bayHalf), span),
  ).length;
  const ghostsAbove = ghosts.filter(
    (ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level
      && spansOverlap(baySpan(ghost.typeCode, ghost.half), span),
  ).length;
  return unitsAbove + ghostsAbove;
}

function blockerKeys(zone, units, ghosts, row, col, level, iso, span, axis, towardLow) {
  const limit = axis === "row" ? Number(zone.rows) : Number(zone.cols);
  const index = axis === "row" ? row : col;
  const from = towardLow ? 1 : index + 1;
  const to = towardLow ? index - 1 : limit;
  const keys = [];
  for (let cursor = from; cursor <= to; cursor += 1) {
    const atRow = axis === "row" ? cursor : row;
    const atCol = axis === "col" ? cursor : col;
    (units || []).forEach((unit) => {
      if (unit.lado === zone.name && unit.ruma === atRow && unit.columna === atCol && unit.nivel > level && unit.iso !== iso && spansOverlap(baySpan(unit.type, unit.bayHalf), span)) keys.push(unit.iso);
    });
    ghosts.forEach((ghost) => {
      if (ghost.zoneId === zone.id && ghost.row === atRow && ghost.col === atCol && ghost.level > level && spansOverlap(baySpan(ghost.typeCode, ghost.half), span)) {
        keys.push(`g-${zone.id}-${atRow}-${atCol}-${ghost.level}-${ghost.half || "F"}`);
      }
    });
  }
  return keys;
}

function movesToReach(zones, units, ghosts, zone, row, col, level, iso, half, type) {
  const above = movesAbove(zones, units, ghosts, zone, row, col, level, iso, half, type);
  const closed = zone.closedSide || "";
  const span = type || half ? baySpan(type, half) : "full";
  const marked = [];
  (units || []).forEach((unit) => {
    if (unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel > level && unit.iso !== iso && spansOverlap(baySpan(unit.type, unit.bayHalf), span)) marked.push(unit.iso);
  });
  ghosts.forEach((ghost) => {
    if (ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level && spansOverlap(baySpan(ghost.typeCode, ghost.half), span)) {
      marked.push(`g-${zone.id}-${row}-${col}-${ghost.level}-${ghost.half || "F"}`);
    }
  });
  const options = [];
  if (closed === "izquierda" || closed === "derecha") {
    options.push(blockerKeys(zone, units, ghosts, row, col, level, iso, span, "col", closed === "derecha"));
  } else {
    if (closed !== "frente") options.push(blockerKeys(zone, units, ghosts, row, col, level, iso, span, "row", true));
    if (closed !== "fondo") options.push(blockerKeys(zone, units, ghosts, row, col, level, iso, span, "row", false));
  }
  const besideKeys = options.reduce((best, list) => (list.length < best.length ? list : best), options[0] || []);
  const beside = options.length ? Math.min(...options.map((list) => list.length)) : 0;
  return { above, beside, total: above + beside, blockers: [...new Set([...marked, ...besideKeys])] };
}

function accessText(reach) {
  if (!reach.total) return "El stacker tiene vista. Se saca sin movimientos.";
  if (reach.beside && reach.above) return `Para sacarlo hay que mover ${reach.total} equipos: ${reach.beside} tapan la vista y ${reach.above} están encima.`;
  if (reach.beside) return `Para sacarlo hay que mover ${reach.beside} ${reach.beside === 1 ? "equipo que tapa" : "equipos que tapan"} la vista del stacker.`;
  return `Para sacarlo hay que mover ${reach.above} ${reach.above === 1 ? "equipo" : "equipos"} que están encima.`;
}

function nextSeat(zones) {
  const taken = new Set(zones.map((zone) => `${zone.gridRow || 1}:${zone.gridCol || 1}`));
  for (let row = 1; row <= 4; row += 1) {
    for (let col = 1; col <= 3; col += 1) {
      if (!taken.has(`${row}:${col}`)) return { gridRow: row, gridCol: col };
    }
  }
  return { gridRow: 1, gridCol: zones.length + 1 };
}

function yardOutline(zones) {
  const maxCols = Math.max(...zones.map((zone) => Number(zone.cols) || 1), 1);
  const maxRows = Math.max(...zones.map((zone) => Number(zone.rows) || 1), 1);
  const gridCols = Math.max(...zones.map((zone) => Number(zone.gridCol) || 1), 1);
  const gridRows = Math.max(...zones.map((zone) => Number(zone.gridRow) || 1), 1);
  const width = gridCols * maxCols * 12.9 + Math.max(0, gridCols - 1) * 8 + 16;
  const depth = gridRows * maxRows * 2.99 + Math.max(0, gridRows - 1) * 8 + 16;
  return { width: Math.max(20, Math.round(width)), depth: Math.max(20, Math.round(depth)) };
}

function sideFit(side) {
  if (side.kind === "pared") return "Pared en todo el lado.";
  const bays = fenceBays(side);
  const twenties = bays.filter((bay) => bay.feet === 20).length;
  const forties = bays.filter((bay) => bay.feet === 40).length;
  const used = bays.reduce((sum, bay) => sum + (bay.feet === 20 ? 6.1 : 12.2), 0);
  const wall = side.kind === "mixto" ? Math.min(Number(side.wallM) || 0, Number(side.lengthM) || 0) : 0;
  const rest = Math.round(((Number(side.lengthM) || 0) - wall - used) * 10) / 10;
  const mix = [forties ? `${forties} de 40` : "", twenties ? `${twenties} de 20` : ""].filter(Boolean).join(" y ");
  const deep = bays.filter((bay) => bay.rows > 1).length;
  return `${bays.length} puestos${mix ? ` (${mix})` : ""}${deep ? `. ${deep} con más de una fila` : ""}${rest > 0.2 ? `. Quedan ${rest} m` : ""}.`;
}

function withBay(side, slot, patch) {
  const bays = fenceBays(side).map((bay) => ({ feet: bay.feet, rows: bay.rows }));
  const index = slot - 1;
  if (!bays[index]) return side;
  bays[index] = { ...bays[index], ...patch };
  return { ...side, bays };
}

function rankFenceUnits(units, needle) {
  const code = String(needle || "").trim().toUpperCase();
  const pool = code.length >= 3 ? (units || []).filter((unit) => unit.iso.toUpperCase().includes(code)) : (units || []);
  return [...pool].sort((a, b) => {
    if (code.length >= 3) {
      const as = a.iso.toUpperCase().startsWith(code) ? 0 : a.iso.toUpperCase().indexOf(code);
      const bs = b.iso.toUpperCase().startsWith(code) ? 0 : b.iso.toUpperCase().indexOf(code);
      if (as !== bs) return as - bs;
      return a.iso.localeCompare(b.iso);
    }
    const ap = a.lado ? 1 : 0;
    const bp = b.lado ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return a.iso.localeCompare(b.iso);
  }).slice(0, 10);
}

function fencePlaceLabel(unit) {
  return unit?.lado ? `En el patio · ${unit.posLabel || unit.lado}` : "Sin lugar asignado";
}

function fenceLevelCells(perimeter, sideId, slot, level, row = 0) {
  return (perimeter?.cells || []).filter((item) => item.sideId === sideId && Number(item.slot) === slot && Number(item.level) === level && (!row || (item.row || 1) === row));
}

function fenceHalfOpen(cells, half) {
  const others = cells || [];
  if (!half) return !others.length;
  return !others.some((cell) => !cell.half || cell.half === half);
}

function fenceHalfSupported(perimeter, side, slot, level, half, movingIso, row = 1) {
  if (level <= 1) return true;
  const below = fenceLevelCells(perimeter, side.id, slot, level - 1, row).filter((cell) => cell.unknown || cell.iso !== movingIso);
  if (!half) {
    return below.some((cell) => !cell.half) || (below.some((cell) => cell.half === "A") && below.some((cell) => cell.half === "B"));
  }
  return below.some((cell) => !cell.half || cell.half === half);
}

function fenceOpenLevel(perimeter, side, slot, half, movingIso, row = 1) {
  const levels = Math.min(3, Math.max(1, Number(side.levels) || 1));
  for (let level = 1; level <= levels; level += 1) {
    if (!fenceHalfOpen(fenceLevelCells(perimeter, side.id, slot, level, row), half, movingIso)) continue;
    if (!fenceHalfSupported(perimeter, side, slot, level, half, movingIso, row)) return 0;
    return level;
  }
  return 0;
}

function fenceOffers(perimeter, unit) {
  const feet = feetOf(unit?.type);
  if (feet !== 20 && feet !== 40) return [];
  const offers = [];
  (perimeter?.sides || []).forEach((side) => {
    if (side.kind === "pared") return;
    fenceBays(side).forEach((bay) => {
      const slot = bay.slot;
      const sideFeet = bay.feet;
      if (sideFeet === 20 && feet !== 20) return;
      const halves = feet === 20 && sideFeet === 40 ? ["A", "B"] : [""];
      if ((side.wallSlots || []).includes(slot)) return;
      for (let row = 1; row <= bay.rows; row += 1) {
        halves.forEach((half) => {
          const level = fenceOpenLevel(perimeter, side, slot, half, unit?.iso, row);
          if (level) offers.push({ sideId: side.id, slot, level, half, row });
        });
      }
    });
  });
  return offers;
}

function slotAccepts(sideFeet, cells, half, feet) {
  if (!feet) return true;
  const real = (cells || []).filter((cell) => !cell.unknown);
  if (feet >= 40) {
    if (sideFeet !== 40 || half) return false;
    return real.length === 0;
  }
  if (sideFeet === 20) return !half && real.length === 0;
  if (!half) return false;
  return !real.some((cell) => !cell.half || cell.half === half);
}

function FencePlan({ perimeter, units, moving, incomingFeet = 0, placing = false, onOccupy, onEmpty, onUnknown, onReturn, onMismatch }) {
  const [shown, setShown] = useState(true);
  const sides = (perimeter?.sides || []).filter((side) => slotCount(side) > 0);
  if (!sides.length) return null;
  const feet = feetOf(moving?.type);
  const guideFeet = placing ? incomingFeet : feet;
  const press = (cell, unit, side, slot, level, half, row, sideFeet, cells) => {
    if (unit) {
      onOccupy(unit);
      return;
    }
    if (placing && !slotAccepts(sideFeet, cells, half, incomingFeet)) {
      onMismatch?.(incomingFeet, sideFeet);
      return;
    }
    if (cell?.unknown) onUnknown?.(cell, side, slot, level, half, row);
    else onEmpty(side, slot, level, half, row);
  };
  return (
    <div className="yard-fence-plan">
      <div className="yard-fence-head">
        <b>Cerco</b>
        <button className="btn-ghost" type="button" aria-expanded={shown ? "true" : "false"} onClick={() => setShown((current) => !current)}>{shown ? "Ocultar cerco" : "Mostrar cerco"}</button>
      </div>
      {shown ? (
      <>
      <p className="section-sub">Cada lado va en su fila. Un puesto de 40 pies admite un 40, o dos de 20 en las mitades A y B. El cuadro amarillo es el lugar que acepta el equipo elegido: un 20 solo marca puestos de 20, y recién ahí un puesto de 40 se divide en A y B. Un 40 solo marca puestos de 40. Con un equipo elegido, un DESCONOCIDO del cerco pasa a ser ese equipo. Sin equipo elegido, el DESCONOCIDO se edita en su celda. Un doble clic en un contenedor pide confirmación para devolverlo a sin sitio.</p>
      <div className="yard-fence-line">
        {sides.map((side) => {
          const bays = fenceBays(side);
          return (
            <div className="zone-board" key={side.id}>
              <b>{side.name}</b>
              <div className="fila-label">{bays.some((bay) => bay.feet === 20) && bays.some((bay) => bay.feet === 40) ? "20 y 40 pies" : `${bays[0]?.feet || 40} pies`}{side.kind === "mixto" ? " · parte pared" : ""}</div>
              <div className="zone-cols">
                {bays.map((bay) => {
                  const slot = bay.slot;
                  const sideFeet = bay.feet;
                  const walled = (side.wallSlots || []).includes(slot);
                  const levels = Math.min(3, Number(side.levels) || 1);
                  return (
                    <div className="stack-col" key={slot}>
                      <span>Puesto {slot}</span>
                      {walled ? <button className="yard-cell ghost" type="button" disabled>Pared</button> : Array.from({ length: bay.rows }, (_, rowIndex) => {
                        const depth = bay.rows - rowIndex;
                        return (
                          <div key={depth} className="fence-depth">
                            {bay.rows > 1 ? <span>Fila {depth}</span> : null}
                            {Array.from({ length: levels }, (_, levelIndex) => {
                              const level = levels - levelIndex;
                              const here = fenceLevelCells(perimeter, side.id, slot, level, depth);
                              const full = here.find((cell) => !cell.half);
                              const storedHalves = here.some((cell) => cell.half === "A" || cell.half === "B");
                              const realHalf = here.some((cell) => (cell.half === "A" || cell.half === "B") && !cell.unknown);
                              const wantTwenty = guideFeet > 0 && guideFeet < 40;
                              const splitWide = sideFeet === 40 && (realHalf || (guideFeet < 40 && storedHalves) || (wantTwenty && (!full || full.unknown)));
                              if (splitWide) {
                                return (
                                  <div className="yard-bay" key={level}>
                                    {["A", "B"].map((half) => {
                                      const cell = here.find((item) => item.half === half) || (full?.unknown ? full : null);
                                      const unit = cell && !cell.unknown ? (units || []).find((item) => item.iso === cell.iso) : null;
                                      const accepts = !placing || slotAccepts(sideFeet, here, half, incomingFeet);
                                      const offer = placing && accepts && !unit;
                                      const skip = placing && !accepts && !unit;
                                      const target = !placing && feet === 20 && fenceOpenLevel(perimeter, side, slot, half, moving?.iso, depth) === level;
                                      return (
                                        <button
                                          key={half}
                                          type="button"
                                          className={`yard-cell${unit || cell?.unknown ? " full" : ""}${cell?.unknown ? " ghost" : ""}${offer || target ? " fence-target" : ""}${skip ? " fence-skip" : ""}`}
                                          style={unit ? { background: boxColor(unit) } : cell?.color ? { background: cell.color } : undefined}
                                          aria-label={`Cerco ${side.name} puesto ${slot} fila ${depth} nivel ${level} mitad ${half}`}
                                          onClick={() => press(cell, unit, side, slot, level, half, depth, sideFeet, here)}
                                          onDoubleClick={() => { if (unit && onReturn) onReturn(unit); }}
                                        >
                                          {unit ? unit.iso.slice(-4) : cell?.unknown ? cell.iso.slice(-4) : offer || target ? "Libre" : half}
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              }
                              const unit = full && !full.unknown ? (units || []).find((item) => item.iso === full.iso) : null;
                              const unknownCell = full?.unknown ? full : (!unit ? here.find((cell) => cell.unknown) : null);
                              const accepts = !placing || slotAccepts(sideFeet, here, "", incomingFeet);
                              const offer = placing && accepts && !unit;
                              const skip = placing && !accepts && !unit;
                              const target = !placing && !unknownCell && feet === sideFeet && fenceOpenLevel(perimeter, side, slot, "", moving?.iso, depth) === level;
                              return (
                                <button
                                  key={level}
                                  type="button"
                                  className={`yard-cell${unit || unknownCell ? " full" : ""}${unknownCell ? " ghost" : ""}${offer || target ? " fence-target" : ""}${skip ? " fence-skip" : ""}`}
                                  style={unit ? { background: boxColor(unit) } : unknownCell?.color ? { background: unknownCell.color } : undefined}
                                  aria-label={`Cerco ${side.name} puesto ${slot} fila ${depth} nivel ${level}`}
                                  onClick={() => press(unknownCell || full, unit, side, slot, level, "", depth, sideFeet, here)}
                                  onDoubleClick={() => { if (unit && onReturn) onReturn(unit); }}
                                >
                                  {unit ? unit.iso.slice(-4) : unknownCell ? unknownCell.iso.slice(-4) : offer || target ? "Libre" : level}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </>
      ) : null}
    </div>
  );
}

function slotCount(side) {
  if (side.kind === "pared") return 0;
  const feet = Number(side.containerFeet) === 20 ? 6.1 : 12.2;
  const wall = side.kind === "mixto" ? Math.min(Number(side.wallM) || 0, Number(side.lengthM) || 0) : 0;
  return Math.max(0, Math.floor(((Number(side.lengthM) || 0) - wall + 0.05) / feet));
}

function closureGap(sides) {
  let x = 0;
  let z = 0;
  let heading = 0;
  (sides || []).forEach((side) => {
    x += Math.cos(heading) * (Number(side.lengthM) || 0);
    z += Math.sin(heading) * (Number(side.lengthM) || 0);
    heading += ((Number(side.turnDeg) || 0) * Math.PI) / 180;
  });
  return Math.hypot(x, z);
}

function PerimeterEditor({ draft, setDraft, busy, units, onSave, onFence, onWarn }) {
  const perimeter = draft.perimeter?.sides ? draft.perimeter : { sides: [], gates: [], cells: [] };
  const cells = perimeter.cells || [];
  const [slotCode, setSlotCode] = useState({});
  const [slotColor, setSlotColor] = useState({});
  const [slotHalf, setSlotHalf] = useState({});
  const [openSides, setOpenSides] = useState({});
  const [gatesOpen, setGatesOpen] = useState(false);
  const [ask, setAsk] = useState(null);
  const gap = closureGap(perimeter.sides);
  const setPerimeter = (next) => setDraft((current) => ({ ...current, perimeter: next }));
  function askRemoveSide(side, index) {
    const name = side.name || `lado ${index + 1}`;
    const onSide = cells.filter((item) => item.sideId === side.id && String(item.iso || "").trim());
    const placed = (units || []).filter((unit) => unit.lado === "CERCO" && Number(unit.ruma) === index + 1 && !onSide.some((item) => item.iso === unit.iso));
    if (onSide.length || placed.length) {
      setAsk({
        title: "No se puede quitar el lado",
        text: `El lado ${name} tiene contenedores. Hay que vaciarlos antes de quitar el lado.`,
      });
      return;
    }
    setAsk({
      title: "Quitar lado",
      text: `¿Seguro que quieres quitar el lado ${name}?`,
      confirmLabel: "Quitar lado",
      run: () => setPerimeter({
        ...perimeter,
        sides: perimeter.sides.filter((item) => item.id !== side.id),
        gates: perimeter.gates.filter((gate) => gate.sideId !== side.id),
        cells: cells.filter((item) => item.sideId !== side.id),
      }),
    });
  }
  const updateSide = (id, patch) => setPerimeter({
    ...perimeter,
    sides: perimeter.sides.map((side) => (side.id === id ? { ...side, ...patch } : side)),
  });
  return (
    <div>
      <NoticeModal
        title={ask?.title || ""}
        text={ask?.text || ""}
        confirmLabel={ask?.confirmLabel}
        onClose={() => setAsk(null)}
        onConfirm={ask?.run ? () => { const run = ask.run; setAsk(null); run(); } : null}
      />
      <p className="section-sub">
        El perímetro es el cerco del depósito, aparte de las zonas. Puede tener de 3 a 8 lados. Cada lado es pared, contenedores del almacén, o una mezcla, y se apila hasta 3 niveles.
        En un mismo lado se alternan puestos de 20 y de 40 pies. Un puesto puede tener, si hace falta, 2 o 3 filas hacia adentro, del mismo largo. Un código que no está en el catálogo queda como desconocido, con el color que elijas, y en el 3D llena ese espacio. El color de la ficha (blanco, naranja) es el color del contenedor. Guarda el plano después de cambiar largos o filas.
      </p>
      {!perimeter.sides.length ? (
        <button className="btn-primary" type="button" onClick={() => {
          const size = yardOutline(draft.zones);
          const frontId = freshId("lado");
          setPerimeter({
            sides: [
              { id: frontId, name: "Frente", lengthM: size.width, turnDeg: 90, kind: "pared", containerFeet: 40, wallM: 0, levels: 1, wallSlots: [] },
              { id: freshId("lado"), name: "Derecha", lengthM: size.depth, turnDeg: 90, kind: "contenedores", containerFeet: 40, wallM: 0, levels: 1, wallSlots: [] },
              { id: freshId("lado"), name: "Fondo", lengthM: size.width, turnDeg: 90, kind: "pared", containerFeet: 40, wallM: 0, levels: 1, wallSlots: [] },
              { id: freshId("lado"), name: "Izquierda", lengthM: size.depth, turnDeg: 90, kind: "mixto", containerFeet: 20, wallM: Math.round(size.depth / 2), levels: 1, wallSlots: [] },
            ],
            gates: [{ id: freshId("entrada"), sideId: frontId, name: "Entrada principal", atM: Math.max(0, Math.round(size.width / 2 - 6)), widthM: 12 }],
          });
        }}>Crear perímetro alrededor de las zonas</button>
      ) : (
        <>
          {gap > 1.5 ? <p className="section-sub">El último lado queda a {gap.toFixed(1)} m del inicio. Ajusta un largo o un giro para cerrar el cerco.</p> : <p className="section-sub">El cerco cierra. Las medidas se dibujan a escala alrededor de las zonas.</p>}
          {perimeter.sides.map((side, index) => (
            <div className="fence-card" key={side.id}>
              <button className="btn-ghost fence-fold" type="button" aria-expanded={openSides[side.id] ? "true" : "false"} onClick={() => setOpenSides((current) => ({ ...current, [side.id]: !current[side.id] }))}>
                {openSides[side.id] ? "Ocultar" : "Mostrar"} {side.name || `lado ${index + 1}`}
              </button>
              <label className="zone-field">Lado {index + 1}
                <input value={side.name} onChange={(e) => updateSide(side.id, { name: e.target.value })} />
              </label>
              <label className="zone-field">Largo m
                <input type="number" min={2} max={500} value={side.lengthM} onChange={(e) => updateSide(side.id, { lengthM: Number(e.target.value) })} />
              </label>
              <label className="zone-field">Giro °
                <input type="number" min={-170} max={170} value={side.turnDeg} onChange={(e) => updateSide(side.id, { turnDeg: Number(e.target.value) })} />
              </label>
              <label className="zone-field">Niveles
                <input type="number" min={1} max={3} value={side.levels || 1} onChange={(e) => updateSide(side.id, { levels: Math.min(3, Math.max(1, Number(e.target.value) || 1)) })} />
              </label>
              <label className="zone-field">Material
                <select value={side.kind} onChange={(e) => updateSide(side.id, { kind: e.target.value })}>
                  <option value="pared">Pared</option>
                  <option value="contenedores">Contenedores</option>
                  <option value="mixto">Pared y contenedores</option>
                </select>
              </label>
              {side.kind !== "pared" ? (
                <label className="zone-field">Contenedor
                  <select value={side.containerFeet} onChange={(e) => updateSide(side.id, { containerFeet: Number(e.target.value) })}>
                    <option value={40}>40 pies</option>
                    <option value={20}>20 pies</option>
                  </select>
                </label>
              ) : null}
              {side.kind === "mixto" ? (
                <label className="zone-field">Pared m
                  <input type="number" min={0} max={side.lengthM} value={side.wallM} onChange={(e) => updateSide(side.id, { wallM: Number(e.target.value) })} />
                </label>
              ) : null}
              <span className="section-sub">{sideFit(side)} Hasta {side.levels || 1} nivel{(side.levels || 1) === 1 ? "" : "es"}.</span>
              {openSides[side.id] && fenceBays(side).length ? (
                <div className="fence-slots">
                  {fenceBays(side).map((bay) => {
                    const slot = bay.slot;
                    const walled = (side.wallSlots || []).includes(slot);
                    return (
                      <div key={slot} className="fence-slot">
                        <b>Puesto {slot} · {bay.feet} pies{walled ? " · pared" : ""}</b>
                        {walled ? (
                          <button className="btn-ghost" type="button" disabled={busy} onClick={() => onFence({ sideId: side.id, slot, wall: false })}>Volver a puesto</button>
                        ) : (
                          <>
                            <label className="zone-field">Largo
                              <select aria-label={`Largo del puesto ${slot}`} value={bay.feet} onChange={(e) => updateSide(side.id, withBay(side, slot, { feet: Number(e.target.value) === 20 ? 20 : 40 }))}>
                                <option value={40}>40 pies</option>
                                <option value={20}>20 pies</option>
                              </select>
                            </label>
                            <label className="zone-field">Filas
                              <select aria-label={`Filas del puesto ${slot}`} value={bay.rows} onChange={(e) => updateSide(side.id, withBay(side, slot, { rows: Math.min(3, Math.max(1, Number(e.target.value) || 1)) }))}>
                                <option value={1}>1 fila</option>
                                <option value={2}>2 filas</option>
                                <option value={3}>3 filas</option>
                              </select>
                            </label>
                            {Array.from({ length: bay.rows }, (_, rowIndex) => {
                              const depth = rowIndex + 1;
                              return (
                                <div key={depth}>
                                  {bay.rows > 1 ? <span className="section-sub">Fila {depth}</span> : null}
                                  {Array.from({ length: side.levels || 1 }, (_, levelIndex) => {
                                    const level = levelIndex + 1;
                                    const cell = cells.find((item) => item.sideId === side.id && item.slot === slot && item.level === level && (item.row || 1) === depth);
                                    const key = `${side.id}:${slot}:${depth}:${level}`;
                                    return (
                                      <div key={level} className="fence-slot-row">
                                        <span>Nivel {level}</span>
                                        <div className="fence-suggest">
                                          <input
                                            value={slotCode[key] ?? cell?.iso ?? ""}
                                            onChange={(e) => setSlotCode((current) => ({ ...current, [key]: e.target.value.toUpperCase() }))}
                                            placeholder="Código o desconocido"
                                            aria-label={`Código del puesto ${slot} fila ${depth} nivel ${level}`}
                                          />
                                          <ul className="fence-suggest-list">
                                            {rankFenceUnits(units, slotCode[key] ?? "").map((unit) => (
                                              <li key={unit.iso}>
                                                <button
                                                  type="button"
                                                  onMouseDown={(event) => {
                                                    event.preventDefault();
                                                    setSlotCode((current) => ({ ...current, [key]: unit.iso }));
                                                    if (unit.lado) onWarn("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
                                                  }}
                                                >
                                                  <b>{unit.iso}</b>
                                                  <span>{fencePlaceLabel(unit)}</span>
                                                </button>
                                              </li>
                                            ))}
                                            {!rankFenceUnits(units, slotCode[key] ?? "").length ? <li className="fence-suggest-empty">No está en el catálogo: queda como desconocido.</li> : null}
                                          </ul>
                                        </div>
                                        {bay.feet === 40 ? (
                                          <select aria-label={`Mitad del puesto ${slot} fila ${depth} nivel ${level}`} value={slotHalf[key] ?? cell?.half ?? ""} onChange={(e) => setSlotHalf((current) => ({ ...current, [key]: e.target.value }))}>
                                            <option value="">40 pies</option>
                                            <option value="A">20 · A</option>
                                            <option value="B">20 · B</option>
                                          </select>
                                        ) : null}
                                        <input aria-label={`Color del puesto ${slot} nivel ${level}`} type="color" value={slotColor[key] || cell?.color || "#c5ccd6"} onChange={(e) => setSlotColor((current) => ({ ...current, [key]: e.target.value }))} />
                                        <button className="btn-primary" type="button" disabled={busy} onClick={() => {
                                          const iso = (slotCode[key] ?? cell?.iso ?? "").trim().toUpperCase();
                                          const unit = (units || []).find((item) => item.iso === iso);
                                          const half = slotHalf[key] === "A" || slotHalf[key] === "B" ? slotHalf[key] : "";
                                          if (unit?.lado) {
                                            onWarn("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
                                            return;
                                          }
                                          if (unit) {
                                            onFence({ sideId: side.id, slot, level, ...(depth > 1 ? { row: depth } : {}), ...(half && feetOf(unit.type) === 20 ? { half } : {}), iso });
                                            return;
                                          }
                                          onFence({
                                            sideId: side.id,
                                            slot,
                                            level,
                                            ...(depth > 1 ? { row: depth } : {}),
                                            unknown: true,
                                            iso: iso || "DESCONOCIDO",
                                            color: slotColor[key] || cell?.color || "#c5ccd6",
                                            typeCode: half ? "20" : String(bay.feet),
                                            ...(half ? { half } : {}),
                                          });
                                        }}>Poner</button>
                                        {level === 1 && depth === 1 ? <button className="btn-ghost" type="button" disabled={busy} onClick={() => onFence({ sideId: side.id, slot, wall: true })}>Pasar a pared</button> : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {perimeter.sides.length > 3 ? (
                <button className="btn-ghost" type="button" onClick={() => askRemoveSide(side, index)}>Quitar lado</button>
              ) : null}
            </div>
          ))}
          <h4 className="fence-head">
            Entradas
            <button className="btn-ghost" type="button" aria-expanded={gatesOpen ? "true" : "false"} onClick={() => setGatesOpen((current) => !current)}>{gatesOpen ? "Ocultar entradas" : "Mostrar entradas"}</button>
          </h4>
          {gatesOpen ? perimeter.gates.map((gate) => (
            <div className="fence-card" key={gate.id}>
              <label className="zone-field">Nombre
                <input value={gate.name} onChange={(e) => setPerimeter({
                  ...perimeter,
                  gates: perimeter.gates.map((item) => item.id === gate.id ? { ...item, name: e.target.value } : item),
                })} />
              </label>
              <label className="zone-field">Lado
                <select value={gate.sideId} onChange={(e) => setPerimeter({
                  ...perimeter,
                  gates: perimeter.gates.map((item) => item.id === gate.id ? { ...item, sideId: e.target.value } : item),
                })}>
                  {perimeter.sides.map((side) => <option key={side.id} value={side.id}>{side.name}</option>)}
                </select>
              </label>
              <label className="zone-field">Desde m
                <input type="number" min={0} value={gate.atM} onChange={(e) => setPerimeter({
                  ...perimeter,
                  gates: perimeter.gates.map((item) => item.id === gate.id ? { ...item, atM: Number(e.target.value) } : item),
                })} />
              </label>
              <label className="zone-field">Ancho m
                <input type="number" min={3} max={30} value={gate.widthM} onChange={(e) => setPerimeter({
                  ...perimeter,
                  gates: perimeter.gates.map((item) => item.id === gate.id ? { ...item, widthM: Number(e.target.value) } : item),
                })} />
              </label>
              <button className="btn-ghost" type="button" onClick={() => setPerimeter({ ...perimeter, gates: perimeter.gates.filter((item) => item.id !== gate.id) })}>Quitar</button>
            </div>
          )) : null}
          <div className="action-row">
            {perimeter.sides.length < 8 ? (
              <button className="btn-ghost" type="button" onClick={() => setPerimeter({
                ...perimeter,
                sides: [...perimeter.sides, { id: freshId("lado"), name: `Lado ${perimeter.sides.length + 1}`, lengthM: 20, turnDeg: 90, kind: "pared", containerFeet: 40, wallM: 0, levels: 1, wallSlots: [] }],
              })}>Agregar lado</button>
            ) : null}
            {perimeter.gates.length < 8 ? (
              <button className="btn-ghost" type="button" onClick={() => setPerimeter({
                ...perimeter,
                gates: [...perimeter.gates, { id: freshId("entrada"), sideId: perimeter.sides[0].id, name: `Entrada ${perimeter.gates.length + 1}`, atM: 0, widthM: 8 }],
              })}>Agregar entrada</button>
            ) : null}
            <button className="btn-ghost" type="button" onClick={() => setPerimeter({ sides: [], gates: [], cells: [] })}>Quitar perímetro</button>
            <button className="btn-primary" type="button" disabled={busy} onClick={onSave}>{busy ? "Guardando…" : "Guardar plano"}</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function YardBuild({ layout, onReload, selectedIso, setSelectedIso }) {
  const { user } = useAuth();
  const canGearMedia = hasRole(user, "admin", "coordinador");
  const [mode, setMode] = useState("3d");
  const [draft, setDraft] = useState(withSeats(layout.plan?.zones?.length ? layout.plan : FALLBACK_PLAN));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [guestFeet, setGuestFeet] = useState("20");
  const [guestColor, setGuestColor] = useState("#8a90a2");
  const [guestNote, setGuestNote] = useState("");
  const [guestKind, setGuestKind] = useState("REEFER");
  const [guestEdit, setGuestEdit] = useState(null);
  const [unknownPick, setUnknownPick] = useState(null);
  const [unknownFeet, setUnknownFeet] = useState("40");
  const [unknownColor, setUnknownColor] = useState("#8a90a2");
  const [unknownNote, setUnknownNote] = useState("");
  const [kindName, setKindName] = useState("");
  const [ask, setAsk] = useState(null);
  const [picked, setPicked] = useState(null);
  const [transferIso, setTransferIso] = useState(null);
  const [history, setHistory] = useState([]);
  const [detailIso, setDetailIso] = useState("");
  const [gearMediaId, setGearMediaId] = useState("");
  const [menu, setMenu] = useState(null);
  const [yardQuery, setYardQuery] = useState("");
  const [exitIso, setExitIso] = useState("");
  const [destination, setDestination] = useState("");
  const [exitNote, setExitNote] = useState("");

  useEffect(() => {
    setDraft(withSeats(layout.plan?.zones?.length ? layout.plan : FALLBACK_PLAN));
  }, [layout.depotId, layout.plan]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const types = useMemo(
    () => (layout.types || []).filter((type) => !type.archivedAt),
    [layout.types],
  );
  const typeByCode = useMemo(() => Object.fromEntries(types.map((type) => [type.code, type])), [types]);
  const typeColor = (code) => typeByCode[code]?.color || "#8a90a2";
  const typeLabel = (code) => typeByCode[code]?.label || code || "Sin tipo";
  const sceneUnits = useMemo(() => (layout.units || []).map((unit) => {
    const pending = (layout.exits || []).some((item) => item.iso === unit.iso);
    return pending ? { ...unit, status: `${unit.status || "En patio"} · Salida pendiente de regularizar` } : unit;
  }), [layout]);
  const feetName = (code) => {
    const raw = String(code || "").toUpperCase();
    if (raw.startsWith("40")) return "40 pies";
    if (raw.startsWith("20")) return "20 pies";
    if (raw.startsWith("10")) return "10 pies";
    return typeLabel(code);
  };

  if (!draft?.zones?.length) return null;

  const loose = layout.units.filter((unit) => !unit.lado && (layout.simulation || !LEFT.has(unit.status)));
  const ghosts = supportedGhosts(draft.zones, layout.units, draft.ghosts);
  const incomingUnit = layout.units.find((unit) => unit.iso === (selectedIso || transferIso));
  const incomingFeet = incomingUnit ? feetOf(incomingUnit.type) : guestCode.trim() ? feetOf(guestFeet) : 0;
  const needle = query.trim().toUpperCase();
  const sizeFrom = (feet, typeCode) => {
    const n = Number(feet);
    if (n === 10 || n === 20 || n === 40) return `${n} pies`;
    const raw = String(typeCode || "").toUpperCase();
    if (raw.startsWith("40")) return "40 pies";
    if (raw.startsWith("20")) return "20 pies";
    if (raw.startsWith("10")) return "10 pies";
    return "";
  };
  const gearSeen = new Set();
  const gearRows = [];
  (draft.outsiders || []).forEach((item) => {
    gearSeen.add(item.code);
    const ghost = (draft.ghosts || []).find((entry) => entry.code === item.code);
    const cell = (draft.perimeter?.cells || []).find((entry) => entry.unknown && entry.iso === item.code);
    const zone = ghost ? draft.zones.find((entry) => entry.id === ghost.zoneId) : null;
    const side = cell ? (draft.perimeter?.sides || []).find((entry) => entry.id === cell.sideId) : null;
    const place = zone
      ? `${zone.name} fila ${ghost.row}`
      : side
        ? `${side.name} puesto ${cell.slot}`
        : "Sin ubicar";
    gearRows.push({ key: item.id, code: item.code, kind: item.kind, note: item.note, place, size: sizeFrom(item.feet, item.typeCode), outsider: item });
  });
  ghosts.filter((ghost) => ghost.code && !pendingCode(ghost.code) && !gearSeen.has(ghost.code)).forEach((ghost) => {
    gearSeen.add(ghost.code);
    const zone = draft.zones.find((item) => item.id === ghost.zoneId);
    gearRows.push({ key: `g-${ghost.zoneId}-${ghost.row}-${ghost.col}-${ghost.level}-${ghost.half || ""}`, code: ghost.code, kind: ghost.kind, note: ghost.note, place: `${zone?.name || "Zona"} fila ${ghost.row}`, size: sizeFrom(ghost.feet, ghost.typeCode), ghost });
  });
  (draft.perimeter?.cells || []).filter((cell) => cell.unknown && !pendingCode(cell.iso) && !gearSeen.has(cell.iso)).forEach((cell) => {
    gearSeen.add(cell.iso);
    const side = (draft.perimeter?.sides || []).find((item) => item.id === cell.sideId);
    gearRows.push({
      key: `f-${cell.sideId}-${cell.slot}-${cell.row || 1}-${cell.level}-${cell.half || ""}`,
      code: cell.iso,
      kind: cell.kind,
      note: cell.note,
      place: `${side?.name || "Cerco"} puesto ${cell.slot}`,
      size: sizeFrom(cell.feet, cell.typeCode),
      cell,
      side,
    });
  });
  const gearMatch = gearRows.filter((row) => !needle || `${row.code} ${row.size} ${row.kind || ""} ${row.place} ${row.note || ""}`.toUpperCase().includes(needle));
  const looseMatch = loose.filter((unit) => !needle || `${unit.iso} ${unit.typeLabel || ""} ${unit.type || ""}`.toUpperCase().includes(needle));
  const looseShown = looseMatch.slice(0, 30);
  const gridCols = Math.max(...draft.zones.map((zone) => Number(zone.gridCol) || 1));
  const gridRows = Math.max(...draft.zones.map((zone) => Number(zone.gridRow) || 1));

  async function save(next = draft) {
    setBusy(true);
    setError("");
    try {
      await api("/yard/plan", { method: "POST", body: { depotId: layout.depotId, ...next } });
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function putFence(body) {
    const code = String(body.iso || "").trim().toUpperCase();
    if (code && !body.wall && !body.move) {
      const unit = (layout.units || []).find((item) => item.iso === code);
      if (unit?.lado) {
        setError("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      await api("/yard/plan", { method: "POST", body: { depotId: layout.depotId, ...draft } });
      await api("/yard/fence", { method: "POST", body: { depotId: layout.depotId, ...body } });
      await onReload();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function locateContainer() {
    const needle = yardQuery.trim().toUpperCase();
    if (needle.length < 3) {
      setError("Escribe al menos 3 caracteres del código.");
      return;
    }
    const hits = (layout.units || []).filter((unit) => unit.iso.toUpperCase().includes(needle));
    const exact = hits.find((unit) => unit.iso === needle);
    if (!exact && hits.length !== 1) {
      setError(hits.length ? `Hay ${hits.length} coincidencias. Escribe el código completo.` : "Ese código no está en este depósito.");
      return;
    }
    const unit = exact || hits[0];
    const pending = (layout.exits || []).some((item) => item.iso === unit.iso);
    const zone = draft.zones.find((entry) => entry.name === unit.lado);
    setError("");
    if (zone && unit.ruma && unit.columna && unit.nivel) setPicked(cellPick(zone, unit.ruma, unit.columna, unit.nivel, unit, null));
    else {
      setPicked({
        key: unit.iso,
        code: unit.iso,
        typeLabel: unit.typeLabel || unit.type,
        where: unit.lado ? unit.posLabel : "Sin posición en el patio",
        note: [unit.status, pending ? "Salida pendiente de regularizar" : ""].filter(Boolean).join(" · "),
      });
    }
    if (mode === "despachar") setExitIso(unit.iso);
  }

  async function registerExit() {
    setBusy(true);
    setError("");
    try {
      await api("/yard/exit", { method: "POST", body: { depotId: layout.depotId, iso: exitIso, destination, note: exitNote } });
      setDestination("");
      setExitNote("");
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function updateZone(id, patch) {
    setDraft({ ...draft, zones: draft.zones.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)) });
  }

  function cellPick(zone, row, col, level, occupant, ghost) {
    const span = occupant ? baySpan(occupant.type, occupant.bayHalf) : baySpan(ghost?.typeCode, ghost?.half);
    const half = span === "A" || span === "B" ? span : "";
    const reach = movesToReach(draft.zones, layout.units, ghosts, zone, row, col, level, occupant?.iso, half, occupant?.type || ghost?.typeCode);
    const above = reach.above;
    const freeMoves = layout.retrieval?.freeMoves ?? 3;
    const rate = layout.retrieval?.rate ?? 25;
    const extraMoves = Math.max(0, reach.total - freeMoves);
    const reference = extraMoves * rate;
    const access = accessText(reach);
    const cost = extraMoves
      ? `Referencia de costo extra: USD ${reference} (${extraMoves} × ${rate}). ${freeMoves} movimientos van libres.`
      : `Sin cargo extra de movimientos. ${freeMoves} van libres.`;
    const where = `${zone.name} · fila ${row} · columna ${col} · altura ${level}${half ? ` · mitad ${half}` : span === "center" ? " · al centro" : ""}`;
    if (occupant) {
      return {
        key: occupant.iso,
        code: occupant.iso,
        title: occupant.iso,
        unknown: false,
        typeLabel: occupant.typeLabel || occupant.type,
        where,
        access,
        cost,
        blocked: reach.total > 0,
        blockers: reach.blockers,
        note: `${occupant.status || ""}. ${access} ${cost}`,
      };
    }
    if (!ghost) return null;
    const named = Boolean(ghost.code) && !pendingCode(ghost.code);
    return {
      key: `g-${zone.id}-${row}-${col}-${level}-${ghost.half || "F"}`,
      code: named ? ghost.code : "DESCONOCIDO",
      title: named ? ghost.code : "DESCONOCIDO",
      unknown: !named,
      typeLabel: named ? [ghost.kind, feetName(ghost.typeCode)].filter(Boolean).join(" · ") : "Desconocido",
      where,
      access,
      cost,
      blocked: reach.total > 0,
      blockers: reach.blockers,
      note: named
        ? `${ghost.note ? `${ghost.note}. ` : ""}Equipo ajeno a ZDRY, ${feetName(ghost.typeCode)}. ${access} ${cost}`
        : `Desconocido. ${access} ${cost}`,
      splittable: !named && !ghost.half,
      ghost: above ? null : { zoneId: zone.id, row, col, level, ...(ghost.half ? { half: ghost.half } : {}) },
    };
  }

  function clickedHalf(typeCode, half) {
    if (feetOf(typeCode) >= 40 || half === "center") return undefined;
    return half;
  }

  async function onCell(zone, row, col, level, occupant, ghost, half) {
    setError("");
    const code = guestCode.trim().toUpperCase();
    if (occupant) {
      setPicked(cellPick(zone, row, col, level, occupant, null));
      if (selectedIso || code) setError("Esa posición ya tiene un equipo.");
      return;
    }
    if (!selectedIso && pendingCode(code)) {
      if (ghost && !pendingCode(ghost.code)) {
        editZoneGuest(ghost);
        return;
      }
      if (ghost && pendingCode(ghost.code)) {
        selectPending({
          key: `g-${zone.id}-${row}-${col}-${level}-${ghost.half || ""}`,
          where: "zone",
          feet: String(ghost.typeCode || "").startsWith("10") ? "10" : String(ghost.typeCode || "").startsWith("20") || ghost.half ? "20" : "40",
          color: ghost.color || "#8a90a2",
          note: ghost.note || "",
          ghost: { zoneId: zone.id, row, col, level, half: ghost.half || half || "" },
        });
        return;
      }
      try {
        await api("/yard/ghost", {
          method: "POST",
          body: {
            depotId: layout.depotId,
            zoneId: zone.id,
            row,
            col,
            level,
            occupied: true,
            code: "DESCONOCIDO",
            typeCode: half ? "20" : "40",
            color: "#8a90a2",
            ...(half ? { half } : {}),
          },
        });
        await onReload();
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    try {
      if (selectedIso) {
        const selected = layout.units.find((unit) => unit.iso === selectedIso);
        const placeHalf = clickedHalf(selected?.type, half);
        await api("/yard/place", {
          method: "POST",
          body: { iso: selectedIso, depotId: layout.depotId, lado: zone.name, ruma: row, columna: col, nivel: level, regularize: true, ...(placeHalf ? { half: placeHalf } : {}) },
        });
        setSelectedIso(null);
      } else {
        const known = layout.units.find((unit) => unit.iso.toUpperCase() === code);
        if (known) {
          const placeHalf = clickedHalf(known.type, half);
          await api("/yard/place", {
            method: "POST",
            body: { iso: known.iso, depotId: layout.depotId, lado: zone.name, ruma: row, columna: col, nivel: level, regularize: true, ...(placeHalf ? { half: placeHalf } : {}) },
          });
        } else {
          const assimilated = (draft.outsiders || []).some((item) => item.code === code)
            || (draft.ghosts || []).some((ghost) => ghost.code === code)
            || (draft.perimeter?.cells || []).some((cell) => cell.unknown && cell.iso === code);
          if (!assimilated) {
            setError("Asimila el equipo al depósito antes de ubicarlo.");
            return;
          }
          const placeHalf = clickedHalf(guestFeet, half);
          await api("/yard/ghost", {
            method: "POST",
            body: {
              depotId: layout.depotId,
              zoneId: zone.id,
              row,
              col,
              level,
              occupied: true,
              code,
              typeCode: guestFeet,
              color: guestColor,
              note: guestNote.trim(),
              kind: guestKind,
              ...(placeHalf ? { half: placeHalf } : {}),
            },
          });
        }
        setGuestCode("");
        setGuestNote("");
      }
      setPicked(null);
      await onReload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadHistory(iso) {
    if (!iso) { setHistory([]); return; }
    try {
      setHistory(await api(`/yard/history/${encodeURIComponent(iso)}?depotId=${encodeURIComponent(layout.depotId)}`));
    } catch {
      setHistory([]);
    }
  }

  function askReturn(iso) {
    if (!iso) return;
    setAsk({
      title: "Volver a sin sitio",
      text: `${iso} volverá a estar sin sitio.`,
      confirmLabel: "Volver a sin sitio",
      run: () => returnUnit(iso, true),
    });
  }

  async function returnUnit(iso, regularize = false) {
    if (!iso) return;
    setError("");
    try {
      await api("/yard/release", { method: "POST", body: { iso, depotId: layout.depotId, ...(regularize ? { regularize: true } : {}) } });
      setPicked(null);
      setTransferIso(null);
      await onReload();
      await loadHistory(iso);
    } catch (e) {
      setError(e.message);
    }
  }

  function unplacePicked() {
    if (!picked?.code) return;
    if (mode !== "regularizar" && picked.blocked) {
      setError(picked.access);
      return;
    }
    if (picked.ghost) {
      clearPicked();
      return;
    }
    returnUnit(picked.code, mode === "regularizar");
  }

  async function moveUnit(iso, zoneName, row, col, level, half) {
    setError("");
    try {
      const moving = layout.units.find((unit) => unit.iso === iso);
      const placeHalf = clickedHalf(moving?.type, half);
      await api("/yard/place", {
        method: "POST",
        body: { iso, depotId: layout.depotId, lado: zoneName, ruma: row, columna: col, nivel: level, regularize: true, stacker: true, ...(placeHalf ? { half: placeHalf } : {}) },
      });
      setTransferIso(null);
      await onReload();
      await loadHistory(iso);
    } catch (e) {
      setError(e.message);
    }
  }

  function occupyFence(unit) {
    setError("");
    setTransferIso(unit.iso);
    setPicked({
      key: unit.iso,
      code: unit.iso,
      typeLabel: unit.typeLabel || unit.type,
      where: unit.posLabel || "Cerco",
      note: unit.status || "",
    });
    loadHistory(unit.iso);
  }

  function dropOnFence(side, slot, level, half, row = 1) {
    const moving = layout.units.find((unit) => unit.iso === transferIso);
    if (!moving) {
      setError("Elige primero el contenedor que vas a trasladar.");
      return;
    }
    const feet = feetOf(moving.type);
    const bay = fenceBays(side).find((item) => item.slot === slot);
    const sideFeet = bay?.feet === 20 ? 20 : 40;
    if (feet !== 20 && feet !== 40) {
      setError("Solo un contenedor de 20 o de 40 pies puede ir al cerco.");
      return;
    }
    if (sideFeet === 20 && feet !== 20) {
      setError("Ese puesto es de 20 pies y este contenedor es de 40.");
      return;
    }
    const placeHalf = feet === 20 && sideFeet === 40 ? half : "";
    if (feet === 20 && sideFeet === 40 && placeHalf !== "A" && placeHalf !== "B") {
      setError("Ese puesto es de 40 pies. Un 20 ocupa la mitad A o la mitad B.");
      return;
    }
    if (fenceOpenLevel(draft.perimeter, side, slot, placeHalf, moving.iso, row) !== level) {
      setError("Ese puesto no tiene base libre. Un 40 necesita debajo el puesto completo, o las dos mitades de 20.");
      return;
    }
    putFence({ sideId: side.id, slot, level, iso: moving.iso, move: true, ...(row > 1 ? { row } : {}), ...(placeHalf ? { half: placeHalf } : {}) });
  }

  const equipmentKinds = draft.equipmentKinds?.length ? draft.equipmentKinds : ["REEFER", "TUNEL", "POWERPACK", "MODULO", "OTROS"];

  function editFenceGuest(cell, side, slot, level, half, row) {
    setGuestCode(cell?.iso || "");
    setGuestNote(cell?.note || "");
    setGuestColor(cell?.color || "#8a90a2");
    setGuestFeet(String(cell?.typeCode || "").startsWith("20") ? "20" : "40");
    setGuestKind(cell?.kind || equipmentKinds[0] || "OTROS");
    setGuestEdit({ where: "fence", sideId: side.id, slot, level, half: half || "", row: row || 1 });
    setSelectedIso(null);
    setError("");
  }

  async function placeGuestOnFence(side, slot, level, half, row = 1) {
    const code = guestCode.trim().toUpperCase();
    if (!code) {
      setError("Escribe el código que no es ZDRY.");
      return;
    }
    const known = (layout.units || []).find((item) => item.iso === code);
    if (known?.lado) {
      setError("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
      return;
    }
    const bay = fenceBays(side).find((item) => item.slot === slot);
    const sideFeet = bay?.feet === 20 ? 20 : 40;
    const assimilated = (draft.outsiders || []).some((item) => item.code === code)
      || (draft.ghosts || []).some((ghost) => ghost.code === code)
      || (draft.perimeter?.cells || []).some((cell) => cell.unknown && cell.iso === code);
    if (!known && !assimilated) {
      setError("Asimila el equipo al depósito antes de ubicarlo.");
      return;
    }
    const feet = known ? feetOf(known.type) : feetOf(guestFeet);
    const placeHalf = feet > 0 && feet < 40 && sideFeet === 40 ? half : "";
    if (sideFeet === 20 && feet >= 40) {
      setError("Ese puesto es de 20 pies y este contenedor es de 40.");
      return;
    }
    if (feet < 40 && sideFeet === 40 && placeHalf !== "A" && placeHalf !== "B") {
      setError("Ese puesto es de 40 pies. Un 20 ocupa la mitad A o la mitad B.");
      return;
    }
    const ok = known
      ? await putFence({ sideId: side.id, slot, level, iso: known.iso, ...(row > 1 ? { row } : {}), ...(placeHalf ? { half: placeHalf } : {}) })
      : await putFence({
        sideId: side.id,
        slot,
        level,
        ...(row > 1 ? { row } : {}),
        unknown: true,
        iso: code,
        color: guestColor,
        note: guestNote.trim(),
        kind: guestKind,
        typeCode: feet < 40 ? "20" : "40",
        ...(placeHalf ? { half: placeHalf } : {}),
      });
    if (ok) {
      setGuestCode("");
      setGuestNote("");
      setGuestEdit(null);
      setUnknownPick(null);
    }
  }

  async function saveGuestEdit() {
    if (!guestEdit) return;
    if (guestEdit.where === "fence") {
      const side = (draft.perimeter?.sides || []).find((item) => item.id === guestEdit.sideId);
      if (side) await placeGuestOnFence(side, guestEdit.slot, guestEdit.level, guestEdit.half, guestEdit.row);
      return;
    }
    const code = guestCode.trim().toUpperCase();
    if (!code) {
      setError("Escribe el código que no es ZDRY.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/yard/ghost", {
        method: "POST",
        body: {
          depotId: layout.depotId,
          zoneId: guestEdit.zoneId,
          row: guestEdit.row,
          col: guestEdit.col,
          level: guestEdit.level,
          occupied: true,
          code,
          typeCode: guestFeet,
          color: guestColor,
          note: guestNote.trim(),
          kind: guestKind,
          ...(guestEdit.half ? { half: guestEdit.half } : {}),
        },
      });
      setGuestCode("");
      setGuestNote("");
      setGuestEdit(null);
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function selectPending(item) {
    setSelectedIso(null);
    setGuestEdit(null);
    setUnknownPick(item);
    setUnknownFeet(item.feet || "40");
    setUnknownColor(item.color || "#8a90a2");
    setUnknownNote(item.note || "");
    setError("");
  }

  function chosenDevice() {
    if (selectedIso) {
      const unit = (layout.units || []).find((item) => item.iso === selectedIso);
      if (unit && !unit.lado) return { iso: unit.iso, feet: feetOf(unit.type), known: true };
    }
    const code = guestCode.trim().toUpperCase();
    if (!code || pendingCode(code)) return null;
    const known = (layout.units || []).find((item) => item.iso === code);
    if (known) return { iso: known.iso, feet: feetOf(known.type), known: true };
    return { iso: code, feet: feetOf(guestFeet), known: false };
  }

  async function placeUnitOnFence(side, slot, level, half, row, unit) {
    if (unit.lado) {
      setError("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
      return;
    }
    const bay = fenceBays(side).find((item) => item.slot === slot);
    const sideFeet = bay?.feet === 20 ? 20 : 40;
    const feet = feetOf(unit.type);
    if (feet !== 20 && feet !== 40) {
      setError("En el cerco solo entra un contenedor de 20 o de 40 pies.");
      return;
    }
    if (sideFeet === 20 && feet >= 40) {
      setError("Ese puesto es de 20 pies y este contenedor es de 40.");
      return;
    }
    const placeHalf = feet < 40 && sideFeet === 40 ? half : "";
    if (feet < 40 && sideFeet === 40 && placeHalf !== "A" && placeHalf !== "B") {
      setError("Ese puesto es de 40 pies. Un 20 ocupa la mitad A o la mitad B.");
      return;
    }
    const ok = await putFence({
      sideId: side.id,
      slot,
      level,
      iso: unit.iso,
      ...(row > 1 ? { row } : {}),
      ...(placeHalf ? { half: placeHalf } : {}),
    });
    if (ok) {
      setSelectedIso(null);
      setGuestCode("");
      setGuestNote("");
      setGuestEdit(null);
      setUnknownPick(null);
    }
  }

  async function placeOnFence(side, slot, level, half, row = 1) {
    const device = chosenDevice();
    if (!device) {
      await placeUnknownFence(side, slot, level, half, row);
      return;
    }
    if (device.known) {
      const unit = (layout.units || []).find((item) => item.iso === device.iso);
      if (unit) await placeUnitOnFence(side, slot, level, half, row, unit);
      return;
    }
    await placeGuestOnFence(side, slot, level, half, row);
  }

  async function placeUnknownFence(side, slot, level, half, row = 1) {
    await putFence({
      sideId: side.id,
      slot,
      level,
      ...(row > 1 ? { row } : {}),
      unknown: true,
      iso: "DESCONOCIDO",
      color: "#8a90a2",
      typeCode: half ? "20" : "40",
      ...(half ? { half } : {}),
    });
  }

  async function savePending() {
    if (!unknownPick) return;
    setBusy(true);
    setError("");
    try {
      if (unknownPick.where === "fence") {
        await api("/yard/plan", { method: "POST", body: { depotId: layout.depotId, ...draft } });
        await api("/yard/fence", {
          method: "POST",
          body: {
            depotId: layout.depotId,
            sideId: unknownPick.sideId,
            slot: unknownPick.slot,
            level: unknownPick.level,
            ...(unknownPick.row > 1 ? { row: unknownPick.row } : {}),
            unknown: true,
            iso: "DESCONOCIDO",
            color: unknownColor,
            note: unknownNote.trim(),
            typeCode: unknownFeet,
            ...(unknownPick.half ? { half: unknownPick.half } : {}),
          },
        });
      } else {
        await api("/yard/ghost", {
          method: "POST",
          body: {
            depotId: layout.depotId,
            zoneId: unknownPick.ghost.zoneId,
            row: unknownPick.ghost.row,
            col: unknownPick.ghost.col,
            level: unknownPick.ghost.level,
            occupied: true,
            code: "DESCONOCIDO",
            typeCode: unknownFeet,
            color: unknownColor,
            note: unknownNote.trim(),
            ...(unknownPick.ghost.half ? { half: unknownPick.ghost.half } : {}),
          },
        });
      }
      setUnknownPick(null);
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function clearPending() {
    if (!unknownPick) return;
    setAsk({
      title: "Quitar desconocido",
      text: "Este espacio ocupado volverá a estar libre. ¿Confirmas quitarlo?",
      confirmLabel: "Quitar",
      run: async () => {
        if (unknownPick.where === "fence") {
          await putFence({
            sideId: unknownPick.sideId,
            slot: unknownPick.slot,
            level: unknownPick.level,
            clear: true,
            ...(unknownPick.row > 1 ? { row: unknownPick.row } : {}),
            ...(unknownPick.half ? { half: unknownPick.half } : {}),
          });
        } else {
          await clearOutsider({ ghost: unknownPick.ghost });
        }
        setUnknownPick(null);
      },
    });
  }

  async function assimilate() {
    if (guestEdit?.where === "fence" || guestEdit?.where === "zone") {
      await saveGuestEdit();
      return;
    }
    const code = guestCode.trim().toUpperCase();
    if (!code || code === "DESCONOCIDO") {
      setError("Escribe el código del equipo que no es ZDRY.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/yard/outsider", {
        method: "POST",
        body: {
          depotId: layout.depotId,
          ...(guestEdit?.where === "outsider" ? { id: guestEdit.id } : {}),
          code,
          feet: Number(guestFeet),
          color: guestColor,
          note: guestNote.trim(),
          kind: guestKind,
        },
      });
      setGuestCode("");
      setGuestNote("");
      setGuestEdit(null);
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function removeGear() {
    if (!guestEdit) return;
    const code = guestCode.trim().toUpperCase() || "este equipo";
    setAsk({
      title: `Eliminar ${code}`,
      text: `${code} deja de pertenecer al depósito. Si está ubicado, ese puesto queda libre. ¿Confirmas eliminarlo?`,
      confirmLabel: "Eliminar",
      run: async () => {
        if (guestEdit.where === "outsider") {
          setBusy(true);
          setError("");
          try {
            await api("/yard/outsider", { method: "POST", body: { depotId: layout.depotId, id: guestEdit.id, remove: true } });
            setGuestEdit(null);
            setGuestCode("");
            setGuestNote("");
            await onReload();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
          return;
        }
        if (guestEdit.where === "fence") {
          const cell = (draft.perimeter?.cells || []).find((item) => item.sideId === guestEdit.sideId && item.slot === guestEdit.slot && item.level === guestEdit.level && (item.row || 1) === (guestEdit.row || 1) && (item.half || "") === (guestEdit.half || ""));
          if (cell) await clearOutsider({ cell });
        } else {
          await clearOutsider({ ghost: guestEdit });
        }
        setGuestEdit(null);
        setGuestCode("");
        setGuestNote("");
      },
    });
  }

  function editZoneGuest(ghost) {
    setGuestCode(ghost.code || "");
    setGuestNote(ghost.note || "");
    setGuestColor(ghost.color || "#8a90a2");
    setGuestFeet(String(ghost.typeCode || "").startsWith("40") ? "40" : String(ghost.typeCode || "").startsWith("10") ? "10" : "20");
    setGuestKind(ghost.kind || equipmentKinds[0] || "OTROS");
    setGuestEdit({ where: "zone", zoneId: ghost.zoneId, row: ghost.row, col: ghost.col, level: ghost.level, half: ghost.half || "" });
    setSelectedIso(null);
    setError("");
  }

  async function clearOutsider(item) {
    if (item.cell) {
      await putFence({
        sideId: item.cell.sideId,
        slot: item.cell.slot,
        level: item.cell.level,
        clear: true,
        ...(item.cell.row > 1 ? { row: item.cell.row } : {}),
        ...(item.cell.half ? { half: item.cell.half } : {}),
      });
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/yard/ghost", {
        method: "POST",
        body: { depotId: layout.depotId, zoneId: item.ghost.zoneId, row: item.ghost.row, col: item.ghost.col, level: item.ghost.level, occupied: false, ...(item.ghost.half ? { half: item.ghost.half } : {}) },
      });
      await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function changeKinds(nextKinds) {
    const next = { ...draft, equipmentKinds: nextKinds };
    setDraft(next);
    save(next);
  }

  async function slideTo(half) {
    const centering = half === "center";
    if (!centering && half !== "A" && half !== "B") return;
    setError("");
    try {
      if (picked?.ghost) {
        const ghost = ghosts.find((item) => item.zoneId === picked.ghost.zoneId && item.row === picked.ghost.row && item.col === picked.ghost.col && item.level === picked.ghost.level && (item.half || "") === (picked.ghost.half || ""));
        if (!ghost?.code || feetOf(ghost.typeCode) <= 0 || feetOf(ghost.typeCode) >= 40) return;
        if (centering ? !ghost.half : ghost.half === half) return;
        await api("/yard/ghost", {
          method: "POST",
          body: {
            depotId: layout.depotId,
            zoneId: ghost.zoneId,
            row: ghost.row,
            col: ghost.col,
            level: ghost.level,
            occupied: true,
            code: ghost.code,
            typeCode: ghost.typeCode,
            ...(ghost.color ? { color: ghost.color } : {}),
            ...(ghost.note ? { note: ghost.note } : {}),
            ...(centering ? {} : { half }),
          },
        });
      } else {
        const unit = layout.units.find((item) => item.iso === picked?.code);
        if (!unit?.lado || unit.lado === "PASILLO" || !unit.ruma || !unit.columna || !unit.nivel) return;
        if (feetOf(unit.type) <= 0 || feetOf(unit.type) >= 40) return;
        if (centering ? !unit.bayHalf : unit.bayHalf === half) return;
        await api("/yard/place", {
          method: "POST",
          body: {
            iso: unit.iso,
            depotId: layout.depotId,
            lado: unit.lado,
            ruma: unit.ruma,
            columna: unit.columna,
            nivel: unit.nivel,
            regularize: true,
            ...(mode === "regularizar" ? {} : { stacker: true }),
            ...(centering ? {} : { half }),
          },
        });
        await loadHistory(unit.iso);
      }
      setPicked((current) => (current ? {
        ...current,
        where: String(current.where || "").replace(/ · (mitad [AB]|al centro)$/, "") + (centering ? " · al centro" : ` · mitad ${half}`),
        ghost: current.ghost ? { ...current.ghost, half: centering ? undefined : half } : current.ghost,
      } : current));
      await onReload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function parkUnit(iso) {
    setError("");
    try {
      await api("/yard/aisle", { method: "POST", body: { iso, depotId: layout.depotId } });
      setTransferIso(null);
      await onReload();
      await loadHistory(iso);
    } catch (e) {
      setError(e.message);
    }
  }

  function cellActions(zone, row, col, level, occupant, ghost) {
    if (occupant || ghost?.code) return [];
    const span = baySpan(ghost?.typeCode, ghost?.half);
    const hereGhosts = ghosts.filter((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === level);
    const hereUnits = layout.units.filter((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel === level);
    if (!ghost?.half && span === "full") return [{ id: "split", label: "Dividir en dos de 20" }];
    if (span !== "A" && span !== "B") return [];
    const other = span === "A" ? "B" : "A";
    const otherGhost = hereGhosts.find((item) => !item.code && baySpan(item.typeCode, item.half) === other);
    const otherUnit = hereUnits.find((unit) => {
      const side = baySpan(unit.type, unit.bayHalf);
      return side === other || side === "full" || side === "center";
    });
    return otherGhost && !otherUnit ? [{ id: "merge", label: "Fusionar en un 40" }] : [];
  }

  function openCellMenu(event, zone, row, col, level, occupant, ghost) {
    event.preventDefault();
    const actions = cellActions(zone, row, col, level, occupant, ghost);
    if (!actions.length) {
      setMenu(null);
      return;
    }
    setMenu({
      x: event.clientX,
      y: event.clientY,
      actions,
      ghost: { zoneId: zone.id, row, col, level, ...(ghost?.half ? { half: ghost.half } : {}) },
    });
  }

  async function runMenu(action) {
    const target = menu?.ghost;
    setMenu(null);
    if (!target) return;
    setError("");
    try {
      await api("/yard/ghost", {
        method: "POST",
        body: { depotId: layout.depotId, ...target, occupied: true, ...(action === "split" ? { split: true } : { merge: true }) },
      });
      setPicked(null);
      await onReload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function splitPicked() {
    if (!picked?.ghost || picked.ghost.half) return;
    if (picked.blocked) {
      setError(picked.access);
      return;
    }
    setError("");
    try {
      await api("/yard/ghost", {
        method: "POST",
        body: { depotId: layout.depotId, ...picked.ghost, split: true, occupied: true },
      });
      setPicked(null);
      await onReload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function clearPicked() {
    if (!picked?.ghost) return;
    setError("");
    try {
      await api("/yard/ghost", {
        method: "POST",
        body: { depotId: layout.depotId, ...picked.ghost, occupied: false },
      });
      setPicked(null);
      await onReload();
    } catch (e) {
      setError(e.message);
    }
  }

  const info = (
    <div className="yard-info">
      {picked ? (
        <>
          <div>
            <b>{picked.code}</b>
            <div>{picked.typeLabel}</div>
          </div>
          <div>{picked.where}</div>
          <div>{picked.note}</div>
          {(() => {
            const unit = layout.units.find((item) => item.iso === picked.code);
            const ghost = picked.ghost ? ghosts.find((item) => item.zoneId === picked.ghost.zoneId && item.row === picked.ghost.row && item.col === picked.ghost.col && item.level === picked.ghost.level && (item.half || "") === (picked.ghost.half || "")) : null;
            const feet = feetOf(unit?.type || ghost?.typeCode);
            const placed = unit ? unit.lado && unit.lado !== "PASILLO" : Boolean(ghost?.code) && !pendingCode(ghost.code);
            if (feet <= 0 || feet >= 40 || !placed) return null;
            const side = unit?.bayHalf || ghost?.half || "";
            return (
              <div className="yard-slide">
                <span>{side ? `Está en la mitad ${side}. El otro lado queda libre.` : "Está al centro y ocupa A y B. Arriba no puede ir un 40."}</span>
                <button className={side === "A" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => slideTo("A")}>A la izquierda</button>
                <button className={!side ? "btn-primary" : "btn-ghost"} type="button" onClick={() => slideTo("center")}>Al centro</button>
                <button className={side === "B" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => slideTo("B")}>A la derecha</button>
                <button className="btn-ghost" type="button" onClick={unplacePicked}>Volver a sin sitio</button>
              </div>
            );
          })()}
          {picked.splittable ? <button className="btn-ghost" type="button" onClick={splitPicked}>Dividir en dos de 20</button> : null}
          {picked.ghost ? <button className="btn-ghost" type="button" onClick={clearPicked}>Liberar hueco</button> : null}
          {!picked.unknown && !picked.ghost && layout.units.some((unit) => unit.iso === picked.code) ? (
            <button className="btn-primary" type="button" onClick={() => setDetailIso(picked.code)}>Ver más información</button>
          ) : null}
          {(draft.outsiders || []).some((item) => item.code === picked.code) ? (
            <button className="btn-primary" type="button" onClick={() => setGearMediaId((draft.outsiders || []).find((item) => item.code === picked.code)?.id || "")}>Más información</button>
          ) : null}
        </>
      ) : <span>Toca un contenedor para ver el código y el tipo.</span>}
    </div>
  );

  return (
    <div className="panel yard-panel" style={{ marginTop: 14 }}>
      <div className="action-row yard-modes">
        <b>Plano del almacén</b>
        <button className={mode === "3d" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("3d")}>Vista 3D</button>
        <button className={mode === "armar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("armar")}>Zonas</button>
        <button className={mode === "perimetro" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("perimetro")}>Perímetro</button>
        <button className={mode === "regularizar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => { setMode("regularizar"); setTransferIso(null); }}>Regularizar</button>
        <button className={mode === "trasladar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("trasladar")}>Trasladar</button>
        <button className={mode === "despachar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("despachar")}>Despachar</button>
        <button className={mode === "tipos" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("tipos")}>Tipos</button>
      </div>
      <NoticeModal title="Aviso" text={error} onClose={() => setError("")} />
      <NoticeModal title={ask?.title || "Confirmar"} text={ask?.text || ""} confirmLabel={ask?.confirmLabel || "Quitar zona"} onClose={() => setAsk(null)} onConfirm={ask ? () => { const run = ask.run; setAsk(null); run(); } : null} />

      {mode === "armar" ? (
        <div>
          <p className="section-sub">Cada zona ocupa un puesto de la cuadrícula. La cuarta zona cae en la fila 2, columna 1, debajo de la A, con pasillo de por medio. El lado sin acceso es el perímetro: el stacker no entra por ahí. Una fila vecina más alta que el equipo le tapa la vista.</p>
          {draft.zones.map((zone) => (
            <div className="zone-card" key={zone.id}>
              <label className="zone-field">Nombre
                <input aria-label={`Nombre de ${zone.name}`} value={zone.name} onChange={(e) => updateZone(zone.id, { name: e.target.value })} />
              </label>
              <label className="zone-field">Fila del patio
                <input type="number" min={1} max={4} value={zone.gridRow || 1} onChange={(e) => updateZone(zone.id, { gridRow: Number(e.target.value) })} />
              </label>
              <label className="zone-field">Columna del patio
                <input type="number" min={1} max={3} value={zone.gridCol || 1} onChange={(e) => updateZone(zone.id, { gridCol: Number(e.target.value) })} />
              </label>
              <label className="zone-field">Filas
                <input type="number" min={1} max={40} value={zone.rows} onChange={(e) => updateZone(zone.id, { rows: Number(e.target.value) })} />
              </label>
              <label className="zone-field">Columnas
                <input type="number" min={1} max={20} value={zone.cols} onChange={(e) => updateZone(zone.id, { cols: Number(e.target.value) })} />
              </label>
              <label className="zone-field">Altura
                <input type="number" min={1} max={20} value={zone.levels} onChange={(e) => updateZone(zone.id, { levels: Number(e.target.value) })} />
              </label>
              <label className="zone-field">Lado sin acceso
                <select aria-label={`Lado sin acceso de ${zone.name}`} value={zone.closedSide || ""} onChange={(e) => updateZone(zone.id, { closedSide: e.target.value })}>
                  <option value="">Ninguno</option>
                  <option value="frente">Frente, fila 1</option>
                  <option value="fondo">Fondo, última fila</option>
                  <option value="izquierda">Izquierda, columna 1</option>
                  <option value="derecha">Derecha, última columna</option>
                </select>
              </label>
              {draft.zones.length > 1 ? (
                <button className="btn-ghost" type="button" onClick={() => {
                  const count = (layout.units || []).filter((unit) => unit.lado === zone.name).length;
                  const equipos = count === 1 ? "1 contenedor que está" : `${count} contenedores que están`;
                  setAsk({
                    title: `Quitar ${zone.name}`,
                    text: count
                      ? `Los ${equipos} en ${zone.name} volverán a estar sin sitio. ¿Confirmas quitar la zona?`
                      : `Los contenedores que estén en ${zone.name} volverán a estar sin sitio. Ahora no hay ninguno ubicado. ¿Confirmas quitar la zona?`,
                    confirmLabel: "Quitar zona",
                    run: () => {
                      const next = {
                        ...draft,
                        zones: draft.zones.filter((item) => item.id !== zone.id),
                        ghosts: (draft.ghosts || []).filter((ghost) => ghost.zoneId !== zone.id),
                      };
                      setDraft(next);
                      save(next);
                    },
                  });
                }}>Quitar</button>
              ) : <span />}
            </div>
          ))}
          <div className="action-row">
            <button className="btn-ghost" type="button" onClick={() => {
              const seat = nextSeat(draft.zones);
              setDraft({
                ...draft,
                zones: [...draft.zones, { id: freshId("zona"), name: `Zona ${String.fromCharCode(65 + draft.zones.length)}`, rows: 4, cols: 3, levels: 5, ...seat }],
              });
            }}>Agregar zona</button>
            <button className="btn-primary" type="button" disabled={busy} onClick={() => save()}>{busy ? "Guardando…" : "Guardar plano"}</button>
          </div>
        </div>
      ) : null}

      {mode === "perimetro" ? (
        <PerimeterEditor draft={draft} setDraft={setDraft} busy={busy} units={layout.units} onSave={() => save()} onFence={putFence} onWarn={setError} />
      ) : null}

      {mode === "despachar" ? (
        <div>
          <p className="section-sub">Elige un contenedor del patio o del cerco, indica a dónde sale y queda pendiente de regularizar. La salida en Odoo, el OUT, todavía no se envía.</p>
          <div className="guest-form">
            <label className="zone-field">Contenedor
              <input value={exitIso} onChange={(e) => setExitIso(e.target.value.toUpperCase())} placeholder="Código" list="yard-units" />
            </label>
            <label className="zone-field">A dónde sale
              <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Cliente, puerto o almacén" />
            </label>
            <label className="zone-field">Nota
              <input value={exitNote} onChange={(e) => setExitNote(e.target.value)} placeholder="Opcional" />
            </label>
            <button className="btn-primary" type="button" disabled={busy} onClick={registerExit}>Registrar salida</button>
          </div>
          {(layout.exits || []).length ? (
            <ul className="drv-notes">
              {layout.exits.map((item) => (
                <li key={item.id}>
                  <span>{item.iso} · {item.destination}{item.note ? ` · ${item.note}` : ""} · pendiente</span>
                  <button className="btn-ghost" type="button" onClick={() => api(`/yard/exit/${item.id}/cancel`, { method: "POST" }).then(onReload).catch((e) => setError(e.message))}>Anular</button>
                </li>
              ))}
            </ul>
          ) : <p className="section-sub">No hay salidas pendientes.</p>}
        </div>
      ) : null}

      {mode === "tipos" ? (
        <div>
          <p className="section-sub">Estos tipos se eligen al guardar un código que no está en ZDRY, junto con la nota. Agrega o quita los que use este patio.</p>
          <ul className="drv-notes yard-kind-list">
            {equipmentKinds.map((kind) => (
              <li key={kind}>
                <span>{kind}</span>
                <button className="btn-ghost" type="button" disabled={equipmentKinds.length < 2 || busy} onClick={() => changeKinds(equipmentKinds.filter((item) => item !== kind))}>Quitar</button>
              </li>
            ))}
          </ul>
          <div className="guest-form">
            <label className="zone-field">Tipo nuevo
              <input aria-label="Tipo nuevo" value={kindName} onChange={(e) => setKindName(e.target.value.toUpperCase())} placeholder="REEFER, TUNEL…" maxLength={24} />
            </label>
            <button className="btn-primary" type="button" disabled={busy || !kindName.trim()} onClick={() => {
              const name = kindName.trim().toUpperCase().replace(/\s+/g, " ").slice(0, 24);
              if (!name || equipmentKinds.includes(name) || equipmentKinds.length >= 24) return;
              setKindName("");
              changeKinds([...equipmentKinds, name]);
            }}>Agregar tipo</button>
          </div>
        </div>
      ) : null}

      {mode === "regularizar" || mode === "trasladar" ? (
        <div>
          {mode === "trasladar" ? (
            <>
              <p className="section-sub">
                Elige un equipo ubicado y toca el hueco destino, en una zona o en el cerco. El cerco se dibuja como una zona más: el cuadro amarillo es el puesto libre del mismo largo.
                {transferIso ? ` En traslado: ${transferIso}.` : ""}
              </p>
              <div className="action-row">
                <button className="btn-ghost" type="button" disabled={!transferIso} onClick={() => parkUnit(transferIso)}>Dejar en el pasillo</button>
                <button className="btn-ghost" type="button" disabled={!transferIso} onClick={() => returnUnit(transferIso)}>Devolver a sin posición</button>
              </div>
              <div className="pill-list">
                {layout.units.filter((unit) => unit.lado && !LEFT.has(unit.status)).map((unit) => (
                  <button
                    key={unit.iso}
                    className="pill-check"
                    type="button"
                    style={{ cursor: "pointer", background: transferIso === unit.iso ? "#12203a" : "#fff", color: transferIso === unit.iso ? "#fff" : "inherit" }}
                    onClick={() => { setTransferIso(unit.iso); loadHistory(unit.iso); }}
                  >
                    {unit.iso} — {unit.onAisle || unit.lado === "PASILLO" ? "Pasillo" : unit.posLabel || unit.lado}
                  </button>
                ))}
              </div>
              {history.length ? (
                <ul className="yard-history">
                  {history.slice(0, 8).map((row) => <li key={row.id}>{row.detail}</li>)}
                </ul>
              ) : null}
            </>
          ) : (
            <>
          <p className="section-sub">
            Aquí se arman las rumas como están en el patio: se puede cerrar Regularizar y volver a abrirlo para seguir una línea. Un 40 ocupa A y B. Un 20 ocupa solo la mitad que toques. Un doble clic, en la zona o en el cerco, pide confirmación para devolver el contenedor a sin sitio aunque otro equipo le tape la vista. Si hay equipos encima, primero hay que moverlos. Fuera de esta vista, el traslado solo entra en un puesto libre al que llega el stacker.
            {selectedIso ? ` Seleccionado: ${selectedIso}.` : ""}
          </p>
          <div className="guest-form">
            <label className="zone-field">Código que no es ZDRY
              <input aria-label="Código del equipo" value={guestCode} onChange={(e) => setGuestCode(e.target.value.toUpperCase())} placeholder="Código" />
            </label>
            <label className="zone-field">Largo
              <select aria-label="Largo del equipo" value={guestFeet} onChange={(e) => setGuestFeet(e.target.value)}>
                <option value="10">10 pies</option>
                <option value="20">20 pies</option>
                <option value="40">40 pies</option>
              </select>
            </label>
            <label className="zone-field">Color
              <input aria-label="Color del equipo" type="color" value={guestColor} onChange={(e) => setGuestColor(e.target.value)} />
            </label>
            <label className="zone-field">Tipo
              <select aria-label="Tipo del equipo" value={equipmentKinds.includes(guestKind) ? guestKind : equipmentKinds[0]} onChange={(e) => setGuestKind(e.target.value)}>
                {equipmentKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <label className="zone-field">Nota
              <input aria-label="Nota del equipo" value={guestNote} onChange={(e) => setGuestNote(e.target.value)} placeholder="Opcional" maxLength={120} />
            </label>
            <button className="btn-primary" type="button" disabled={busy} onClick={assimilate}>{guestEdit ? "Guardar cambios" : "Asimilar al depósito"}</button>
          </div>
          {guestEdit ? (
            <div className="action-row">
              <button className="btn-ghost" type="button" disabled={busy} onClick={removeGear}>Eliminar</button>
              {guestEdit.where === "outsider" && canGearMedia ? (
                <button className="btn-primary" type="button" onClick={() => setGearMediaId(guestEdit.id)}>Cargar fotos</button>
              ) : null}
              <button className="btn-ghost" type="button" onClick={() => { setGuestEdit(null); setGuestCode(""); setGuestNote(""); }}>Cancelar</button>
            </div>
          ) : null}
          <p className="section-sub">El tipo va antes que la nota. Asimilar lo guarda en el depósito. Elige un equipo de sin posición, o uno que no es DRY, y tócalo sobre un DESCONOCIDO de la zona o del cerco: ese puesto pasa a ser el equipo. Si no hay ninguno elegido, el DESCONOCIDO se edita en su celda. Un 40 ocupa el puesto completo. Un 20 o un 10 ocupa la mitad A o B.</p>
          <input className="odoo-search" aria-label="Buscar equipo" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar equipo" />
          <p className="section-sub">{needle ? `${gearMatch.length} que no son DRY y ${looseMatch.length} sin posición coinciden.` : `${gearRows.length} que no son DRY. ${loose.length} sin posición.`}</p>
          <div className="yard-outsiders">
            <b>Equipos que no son DRY</b>
            {gearRows.length ? (
              gearMatch.length ? (
                <div className="pill-list">
                  {gearMatch.map((row) => {
                    const on = guestEdit?.where === "outsider"
                      ? guestEdit.id === row.outsider?.id
                      : guestCode.trim().toUpperCase() === row.code && Boolean(guestEdit);
                    return (
                      <button
                        key={row.key}
                        className="pill-check"
                        type="button"
                        style={{ cursor: "pointer", background: on ? "#12203a" : "#fff", color: on ? "#fff" : "inherit" }}
                        onClick={() => {
                          setUnknownPick(null);
                          setSelectedIso(null);
                          if (row.outsider) {
                            setGuestCode(row.outsider.code);
                            setGuestFeet(String(row.outsider.feet || 20));
                            setGuestColor(row.outsider.color || "#8a90a2");
                            setGuestNote(row.outsider.note || "");
                            setGuestKind(row.outsider.kind || equipmentKinds[0]);
                            setGuestEdit({ where: "outsider", id: row.outsider.id });
                            return;
                          }
                          if (row.ghost) editZoneGuest(row.ghost);
                          else if (row.cell && row.side) editFenceGuest(row.cell, row.side, row.cell.slot, row.cell.level, row.cell.half || "", row.cell.row || 1);
                        }}
                      >
                        {row.code} — {row.size ? `${row.size} · ` : ""}{row.kind || "Sin tipo"}
                      </button>
                    );
                  })}
                </div>
              ) : <p className="section-sub">Ninguno coincide con la búsqueda.</p>
            ) : <p className="section-sub">Todavía no hay equipos asimilados al depósito.</p>}
          </div>
          <div className="yard-outsiders">
            <b>Sin posición</b>
            {looseMatch.length ? (
          <div className="pill-list">
            {looseShown.map((unit) => (
              <button
                key={unit.iso}
                className="pill-check"
                type="button"
                style={{ cursor: "pointer", background: selectedIso === unit.iso ? "#12203a" : "#fff", color: selectedIso === unit.iso ? "#fff" : "inherit" }}
                onClick={() => { setUnknownPick(null); setSelectedIso(selectedIso === unit.iso ? null : unit.iso); }}
              >
                {unit.iso} — {unit.typeLabel}
              </button>
            ))}
          </div>
            ) : <p className="section-sub">{needle ? "Ninguno coincide con la búsqueda." : "No hay equipos sin posición."}</p>}
          </div>
          {unknownPick ? (
            <div className="guest-form">
              <p className="section-sub">DESCONOCIDO. Espacio ocupado, pendiente de un equipo. Se edita desde su celda. Si eliges un equipo y tocas esta celda, el puesto pasa a ser ese equipo.</p>
              <label className="zone-field">Largo
                <select aria-label="Largo del desconocido" value={unknownFeet} onChange={(e) => setUnknownFeet(e.target.value)}>
                  <option value="10">10 pies</option>
                  <option value="20">20 pies</option>
                  <option value="40">40 pies</option>
                </select>
              </label>
              <label className="zone-field">Color
                <input aria-label="Color del desconocido" type="color" value={unknownColor} onChange={(e) => setUnknownColor(e.target.value)} />
              </label>
              <label className="zone-field">Nota
                <input aria-label="Nota del desconocido" value={unknownNote} onChange={(e) => setUnknownNote(e.target.value)} maxLength={120} />
              </label>
              <button className="btn-primary" type="button" disabled={busy} onClick={savePending}>Guardar</button>
              <button className="btn-ghost" type="button" disabled={busy} onClick={clearPending}>Quitar</button>
            </div>
          ) : null}
            </>
          )}
          {mode === "regularizar" ? info : null}
          <FencePlan
            perimeter={draft.perimeter}
            units={layout.units}
            incomingFeet={incomingFeet}
            placing={mode === "regularizar" && incomingFeet > 0}
            moving={mode === "trasladar" ? layout.units.find((unit) => unit.iso === transferIso) : null}
            onReturn={(unit) => { if (mode === "regularizar") askReturn(unit.iso); }}
            onMismatch={(wanted, sideFeet) => {
              if (wanted >= 40 && sideFeet === 20) setError("Ese puesto es de 20 pies. Un equipo de 40 solo entra en un puesto de 40.");
              else if (wanted >= 40) setError("Ese puesto no tiene el espacio completo de 40 pies.");
              else setError("Ese puesto no tiene un espacio de 20 pies.");
            }}
            onOccupy={(unit) => { if (mode === "trasladar") occupyFence(unit); }}
            onEmpty={(side, slot, level, half, row) => { if (mode === "trasladar") dropOnFence(side, slot, level, half, row); else placeOnFence(side, slot, level, half, row); }}
            onUnknown={(cell, side, slot, level, half, row) => {
              if (mode !== "regularizar") return;
              if (chosenDevice()) {
                placeOnFence(side, slot, level, half, row);
                return;
              }
              if (pendingCode(cell.iso)) {
                selectPending({
                  key: `f-${side.id}-${slot}-${row}-${level}-${half || ""}`,
                  where: "fence",
                  feet: String(cell.typeCode || "").startsWith("20") || half ? "20" : "40",
                  color: cell.color || "#8a90a2",
                  note: cell.note || "",
                  sideId: side.id,
                  slot,
                  level,
                  row,
                  half: half || cell.half || "",
                });
                return;
              }
              editFenceGuest(cell, side, slot, level, half, row);
            }}
          />
          <div className="yard-plan-2d">
            {Array.from({ length: gridRows }, (_, rowIndex) => {
              const gridRow = rowIndex + 1;
              return (
                <div key={gridRow}>
                  {rowIndex > 0 ? <div className="yard-aisle-band"><span>Pasillo</span></div> : null}
                  <div className="yard-plan-line">
                    {Array.from({ length: gridCols }, (_, colIndex) => {
                      const gridCol = colIndex + 1;
                      const zone = draft.zones.find((item) => Number(item.gridRow) === gridRow && Number(item.gridCol) === gridCol);
                      return (
                        <div className="yard-plan-slot" key={gridCol}>
                          {colIndex > 0 ? <div className="yard-aisle-gap">{zone ? <span>Pasillo</span> : null}</div> : null}
                          {zone ? (
                            <div className="zone-board">
                              <b>{zone.name}</b>
                              {Array.from({ length: zone.rows }, (_, fila) => {
                                const row = fila + 1;
                                return (
                                  <div className="fila-block" key={row}>
                                    <div className="fila-label">Fila {row}</div>
                                    <div className="zone-cols">
                                      {Array.from({ length: zone.cols }, (_, column) => {
                                        const col = column + 1;
                                        return (
                                          <div className="stack-col" key={col}>
                                            <span>Col {col}</span>
                                            {Array.from({ length: zone.levels }, (_, levelIndex) => {
                                              const level = zone.levels - levelIndex;
                                              const hereUnits = layout.units.filter((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel === level);
                                              const hereGhosts = ghosts.filter((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === level);
                                              const wideUnit = hereUnits.find((unit) => {
                                                const span = baySpan(unit.type, unit.bayHalf);
                                                return span === "full" || span === "center";
                                              });
                                              const wideGhost = hereGhosts.find((item) => {
                                                const span = baySpan(item.typeCode, item.half);
                                                return span === "full" || span === "center";
                                              });
                                              const hasHalf = hereUnits.some((unit) => {
                                                const span = baySpan(unit.type, unit.bayHalf);
                                                return span === "A" || span === "B";
                                              }) || hereGhosts.some((item) => {
                                                const span = baySpan(item.typeCode, item.half);
                                                return span === "A" || span === "B";
                                              });
                                              const showHalves = hasHalf || (!wideUnit && !wideGhost && incomingFeet > 0 && incomingFeet < 40);
                                              const halfSlot = (half) => ({
                                                half,
                                                occupant: hereUnits.find((unit) => baySpan(unit.type, unit.bayHalf) === half),
                                                ghost: hereGhosts.find((item) => baySpan(item.typeCode, item.half) === half),
                                              });
                                              const slots = showHalves
                                                ? (hasHalf ? ["A", "B"].map(halfSlot) : ["A", "center", "B"].map((half) => (half === "center" ? { half, occupant: null, ghost: null } : halfSlot(half))))
                                                : [{
                                                  half: "",
                                                  occupant: wideUnit,
                                                  ghost: wideGhost,
                                                  span: true,
                                                  center: wideUnit
                                                    ? baySpan(wideUnit.type, wideUnit.bayHalf) === "center"
                                                    : baySpan(wideGhost?.typeCode, wideGhost?.half) === "center",
                                                }];
                                              return (
                                                <div className={slots.length > 1 ? "yard-bay" : undefined} key={level}>
                                                  {slots.map((slot) => {
                                                    const occupant = slot.occupant;
                                                    const ghost = slot.ghost;
                                                    const named = Boolean(ghost?.code) && !pendingCode(ghost.code);
                                                    const color = occupant ? boxColor(occupant) : named ? (ghost.color || typeColor(ghost.typeCode)) : undefined;
                                                    const key = occupant?.iso || (ghost ? `g-${zone.id}-${row}-${col}-${level}-${ghost.half || "F"}` : "");
                                                    return (
                                                      <button
                                                        key={slot.half || "F"}
                                                        type="button"
                                                        className={`yard-cell${slot.span ? " span-bay" : ""}${occupant || named ? " full" : ""}${ghost && !occupant && !named ? " ghost" : ""}${key && picked?.key === key ? " on" : ""}`}
                                                        style={color ? { background: color } : undefined}
                                                        aria-label={`${zone.name} fila ${row} columna ${col} altura ${level}${slot.half ? ` mitad ${slot.half}` : ""}`}
                                                        onClick={() => {
                                                          if (mode === "trasladar") {
                                                            if (occupant) {
                                                              const pick = cellPick(zone, row, col, level, occupant, null);
                                                              setPicked(pick);
                                                              if (pick.blocked) {
                                                                setTransferIso(null);
                                                                setError(pick.access);
                                                                return;
                                                              }
                                                              setTransferIso(occupant.iso);
                                                              loadHistory(occupant.iso);
                                                              return;
                                                            }
                                                            if (transferIso) moveUnit(transferIso, zone.name, row, col, level, slot.half || undefined);
                                                            return;
                                                          }
                                                          onCell(zone, row, col, level, occupant, ghost, slot.half || undefined);
                                                        }}
                                                        onContextMenu={(event) => openCellMenu(event, zone, row, col, level, occupant, ghost)}
                      onDoubleClick={() => {
                        if (mode === "regularizar" && occupant) askReturn(occupant.iso);
                      }}
                                                      >
                                                        {occupant ? occupant.iso.slice(-4) : named ? ghost.code.slice(-4) : ghost && pendingCode(ghost.code) ? "DESC" : ghost ? (String(ghost.typeCode || "").startsWith("20") ? "20" : "?") : slot.half === "center" ? "Medio" : slot.half || (incomingFeet >= 40 ? "A+B" : level)}
                                                        {slot.span ? <small>{slot.center ? "centro" : "A+B"}</small> : null}
                                                      </button>
                                                    );
                                                  })}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <p className="section-sub yard-help">
            La vista muestra las rumas como las ve el operario. No se saca un equipo si hay otros encima o si una fila le tapa la vista al stacker: esos se marcan en naranja. El cuadro amarillo es un puesto libre al que el stacker llega. El rayado es un espacio ocupado sin identificar.
          </p>
          <div className="guest-form">
            <label className="zone-field">Buscar en el patio
              <input list="yard-units" value={yardQuery} onChange={(e) => setYardQuery(e.target.value.toUpperCase())} placeholder="Código del contenedor" onKeyDown={(e) => { if (e.key === "Enter") locateContainer(); }} />
            </label>
            <button className="btn-primary" type="button" onClick={locateContainer}>Ubicar</button>
          </div>
          <datalist id="yard-units">
            {(layout.units || []).map((unit) => <option key={unit.iso} value={unit.iso} />)}
          </datalist>
          <YardScene
            zones={draft.zones}
            perimeter={draft.perimeter}
            units={sceneUnits}
            ghosts={ghosts}
            typeColor={typeColor}
            picked={picked}
            targets={Boolean(transferIso)}
            incomingType={layout.units.find((unit) => unit.iso === transferIso)?.type || ""}
            movingIso={transferIso || ""}
            transferring={Boolean(transferIso)}
            blockers={picked?.blockers || []}
            fenceHint={(() => {
              if (!transferIso) return "";
              const moving = layout.units.find((unit) => unit.iso === transferIso);
              const feet = feetOf(moving?.type);
              const offers = fenceOffers(draft.perimeter, moving);
              if (feet !== 20 && feet !== 40) return "Solo un contenedor de 20 o de 40 pies puede ir al cerco.";
              return offers.length ? "" : `El cerco no tiene un puesto libre de ${feet} pies.`;
            })()}
            history={history}
            onTransfer={() => {
              if (!picked?.code || picked.unknown) return;
              if (picked.blocked) {
                setError(picked.access);
                return;
              }
              setError("");
              setTransferIso(picked.code);
              loadHistory(picked.code);
            }}
            onSlide={(half) => slideTo(half)}
            onUnplace={() => unplacePicked()}
            onSplit={() => splitPicked()}
            onContextMenu={(pick, x, y) => {
              if (!pick?.ghost) return;
              const zone = draft.zones.find((entry) => entry.id === pick.ghost.zoneId);
              if (!zone) return;
              const ghost = ghosts.find((entry) => entry.zoneId === pick.ghost.zoneId && entry.row === pick.ghost.row && entry.col === pick.ghost.col && entry.level === pick.ghost.level && (entry.half || "") === (pick.ghost.half || ""));
              const occupant = layout.units.find((unit) => unit.lado === zone.name && unit.ruma === pick.ghost.row && unit.columna === pick.ghost.col && unit.nivel === pick.ghost.level && baySpan(unit.type, unit.bayHalf) !== "A" && baySpan(unit.type, unit.bayHalf) !== "B");
              const actions = cellActions(zone, pick.ghost.row, pick.ghost.col, pick.ghost.level, occupant, ghost);
              if (!actions.length) return;
              setMenu({ x, y, actions, ghost: pick.ghost });
            }}
            onPark={() => {
              if (picked?.blocked) { setError(picked.access); return; }
              if (transferIso) parkUnit(transferIso);
            }}
            onRelease={() => {
              if (picked?.blocked) { setError(picked.access); return; }
              if (transferIso) returnUnit(transferIso);
            }}
            onClose={() => { setPicked(null); setTransferIso(null); }}
            onGearInfo={(draft.outsiders || []).some((item) => item.code === picked?.code) ? () => setGearMediaId((draft.outsiders || []).find((item) => item.code === picked.code)?.id || "") : null}
            onPick={(item) => {
              if (item.empty && item.fence && transferIso) {
                const side = (draft.perimeter?.sides || []).find((entry) => entry.id === item.sideId);
                if (side) dropOnFence(side, item.slot, item.level, item.half || "", item.row || 1);
                return;
              }
              if (item.empty && transferIso) {
                moveUnit(transferIso, item.zoneName, item.row, item.col, item.level, item.half);
                return;
              }
              if (item.ghost) {
                const zone = draft.zones.find((entry) => entry.id === item.ghost.zoneId);
                const ghost = ghosts.find((entry) => entry.zoneId === item.ghost.zoneId && entry.row === item.ghost.row && entry.col === item.ghost.col && entry.level === item.ghost.level && (entry.half || "") === (item.ghost.half || ""));
                if (zone && ghost) {
                  setPicked(cellPick(zone, ghost.row, ghost.col, ghost.level, null, ghost));
                  return;
                }
              }
              const unit = layout.units.find((entry) => entry.iso === item.key);
              const zone = draft.zones.find((entry) => entry.name === unit?.lado);
              if (unit && zone) setPicked(cellPick(zone, unit.ruma, unit.columna, unit.nivel, unit, null));
              else setPicked(item);
            }}
          />
          <FencePlan
            perimeter={draft.perimeter}
            units={layout.units}
            moving={layout.units.find((unit) => unit.iso === transferIso)}
            onOccupy={occupyFence}
            onEmpty={dropOnFence}
            onUnknown={(cell, side, slot, level, half, row) => setPicked({
              key: `unknown-${side.id}-${slot}-${row}-${level}-${half || "F"}`,
              code: cell.iso,
              unknown: true,
              typeLabel: cell.kind || "Desconocido",
              where: `Cerco · ${side.name} · puesto ${slot}${row > 1 ? ` · fila ${row}` : ""} · nivel ${level}${half ? ` · mitad ${half}` : ""}`,
              note: cell.note || "Contenedor sin ficha. El puesto queda lleno.",
            })}
          />
        </>
      )}
      {detailIso ? <YardUnitDetail iso={detailIso} onClose={() => setDetailIso("")} /> : null}
      {gearMediaId && (draft.outsiders || []).some((item) => item.id === gearMediaId) ? (
        <div className="overlay open yard-detail-overlay" role="presentation" onClick={() => setGearMediaId("")}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Fotos del equipo" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <b>{(draft.outsiders || []).find((item) => item.id === gearMediaId)?.code}</b>
              <button className="modal-close" type="button" aria-label="Cerrar" onClick={() => setGearMediaId("")}>×</button>
            </div>
            <div className="modal-body single yard-detail-body">
              <GearMedia
                depotId={layout.depotId}
                gear={(draft.outsiders || []).find((item) => item.id === gearMediaId)}
                canEdit={canGearMedia}
                onSaved={onReload}
              />
            </div>
          </div>
        </div>
      ) : null}
      {menu ? (
        <div className="yard-menu" style={{ left: menu.x, top: menu.y }}>
          {menu.actions.map((action) => (
            <button key={action.id} type="button" onClick={() => runMenu(action.id)}>{action.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
