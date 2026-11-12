import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
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
  const length = Number(side.lengthM) || 0;
  const feet = Number(side.containerFeet) === 20 ? 6.1 : 12.2;
  const wall = side.kind === "pared" ? length : side.kind === "mixto" ? Math.min(Number(side.wallM) || 0, length) : 0;
  const room = Math.max(0, length - wall);
  if (side.kind === "pared") return "Pared en todo el lado.";
  const count = Math.floor((room + 0.05) / feet);
  const rest = Math.round((room - count * feet) * 10) / 10;
  return `${count} contenedores de ${Number(side.containerFeet) === 20 ? "20" : "40"} pies${rest > 0.2 ? ` y ${rest} m de cierre en pared` : ""}.`;
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

function fenceLevelCells(perimeter, sideId, slot, level) {
  return (perimeter?.cells || []).filter((item) => item.sideId === sideId && Number(item.slot) === slot && Number(item.level) === level);
}

function fenceHalfOpen(cells, half) {
  const others = cells || [];
  if (!half) return !others.length;
  return !others.some((cell) => !cell.half || cell.half === half);
}

function fenceHalfSupported(perimeter, side, slot, level, half, movingIso) {
  if (level <= 1) return true;
  const below = fenceLevelCells(perimeter, side.id, slot, level - 1).filter((cell) => cell.iso !== movingIso);
  if (!half) {
    return below.some((cell) => !cell.half) || (below.some((cell) => cell.half === "A") && below.some((cell) => cell.half === "B"));
  }
  return below.some((cell) => !cell.half || cell.half === half);
}

function fenceOpenLevel(perimeter, side, slot, half, movingIso) {
  const levels = Math.min(3, Math.max(1, Number(side.levels) || 1));
  for (let level = 1; level <= levels; level += 1) {
    if (!fenceHalfOpen(fenceLevelCells(perimeter, side.id, slot, level), half, movingIso)) continue;
    if (!fenceHalfSupported(perimeter, side, slot, level, half, movingIso)) return 0;
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
    const sideFeet = Number(side.containerFeet) === 20 ? 20 : 40;
    if (sideFeet === 20 && feet !== 20) return;
    const halves = feet === 20 && sideFeet === 40 ? ["A", "B"] : [""];
    for (let slot = 1; slot <= slotCount(side); slot += 1) {
      if ((side.wallSlots || []).includes(slot)) continue;
      halves.forEach((half) => {
        const level = fenceOpenLevel(perimeter, side, slot, half, unit?.iso);
        if (level) offers.push({ sideId: side.id, slot, level, half });
      });
    }
  });
  return offers;
}

function FencePlan({ perimeter, units, moving, onOccupy, onEmpty }) {
  const sides = (perimeter?.sides || []).filter((side) => slotCount(side) > 0);
  if (!sides.length) return null;
  const feet = feetOf(moving?.type);
  return (
    <div className="yard-fence-plan">
      <b>Cerco</b>
      <p className="section-sub">Cada lado con contenedores es una zona. Un puesto de 40 pies admite un 40, o dos de 20 en las mitades A y B. El cuadro amarillo es el lugar libre.</p>
      <div className="yard-plan-line">
        {sides.map((side) => {
          const sideFeet = Number(side.containerFeet) === 20 ? 20 : 40;
          return (
            <div className="zone-board" key={side.id}>
              <b>{side.name}</b>
              <div className="fila-label">{sideFeet} pies{side.kind === "mixto" ? " · parte pared" : ""}</div>
              <div className="zone-cols">
                {Array.from({ length: slotCount(side) }, (_, index) => {
                  const slot = index + 1;
                  const walled = (side.wallSlots || []).includes(slot);
                  const levels = Math.min(3, Number(side.levels) || 1);
                  return (
                    <div className="stack-col" key={slot}>
                      <span>Puesto {slot}</span>
                      {walled ? <button className="yard-cell ghost" type="button" disabled>Pared</button> : Array.from({ length: levels }, (_, levelIndex) => {
                        const level = levels - levelIndex;
                        const here = fenceLevelCells(perimeter, side.id, slot, level);
                        const full = here.find((cell) => !cell.half);
                        if (sideFeet === 40 && !full) {
                          return (
                            <div className="yard-bay" key={level}>
                              {["A", "B"].map((half) => {
                                const cell = here.find((item) => item.half === half);
                                const unit = cell ? (units || []).find((item) => item.iso === cell.iso) : null;
                                const open = feet === 20 && fenceOpenLevel(perimeter, side, slot, half, moving?.iso) === level;
                                return (
                                  <button
                                    key={half}
                                    type="button"
                                    className={`yard-cell${unit ? " full" : ""}${open ? " fence-target" : ""}`}
                                    style={unit?.typeColor ? { background: unit.typeColor } : undefined}
                                    aria-label={`Cerco ${side.name} puesto ${slot} nivel ${level} mitad ${half}`}
                                    onClick={() => (unit ? onOccupy(unit) : onEmpty(side, slot, level, half))}
                                  >
                                    {unit ? unit.iso.slice(-4) : half}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        }
                        const unit = full ? (units || []).find((item) => item.iso === full.iso) : null;
                        const open = feet === sideFeet && fenceOpenLevel(perimeter, side, slot, "", moving?.iso) === level;
                        return (
                          <button
                            key={level}
                            type="button"
                            className={`yard-cell${unit ? " full" : ""}${open ? " fence-target" : ""}`}
                            style={unit?.typeColor ? { background: unit.typeColor } : undefined}
                            aria-label={`Cerco ${side.name} puesto ${slot} nivel ${level}`}
                            onClick={() => (unit ? onOccupy(unit) : onEmpty(side, slot, level, ""))}
                          >
                            {unit ? unit.iso.slice(-4) : open ? "Libre" : level}
                          </button>
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
  const gap = closureGap(perimeter.sides);
  const setPerimeter = (next) => setDraft((current) => ({ ...current, perimeter: next }));
  const updateSide = (id, patch) => setPerimeter({
    ...perimeter,
    sides: perimeter.sides.map((side) => (side.id === id ? { ...side, ...patch } : side)),
  });
  return (
    <div>
      <p className="section-sub">
        El perímetro es el cerco del depósito, aparte de las zonas. Puede tener de 3 a 8 lados. Cada lado es pared, contenedores del almacén, o una mezcla, y se apila hasta 3 niveles.
        Un dry de 20 pies mide 6,1 m y uno de 40 mide 12,2 m. Poner un código lo saca de su ruma y lo deja en ese puesto. Pasar a pared suelta los dry de ese puesto. El giro de 90° cierra un rectángulo.
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
              {slotCount(side) ? (
                <div className="fence-slots">
                  {Array.from({ length: slotCount(side) }, (_, index) => {
                    const slot = index + 1;
                    const walled = (side.wallSlots || []).includes(slot);
                    return (
                      <div key={slot} className="fence-slot">
                        <b>Puesto {slot}{walled ? " · pared" : ""}</b>
                        {walled ? (
                          <button className="btn-ghost" type="button" disabled={busy} onClick={() => onFence({ sideId: side.id, slot, wall: false })}>Volver a puesto</button>
                        ) : Array.from({ length: side.levels || 1 }, (_, levelIndex) => {
                          const level = levelIndex + 1;
                          const cell = cells.find((item) => item.sideId === side.id && item.slot === slot && item.level === level);
                          const key = `${side.id}:${slot}:${level}`;
                          return (
                            <div key={level} className="fence-slot-row">
                              <span>Nivel {level}</span>
                              <div className="fence-suggest">
                                <input
                                  value={slotCode[key] ?? cell?.iso ?? ""}
                                  onChange={(e) => setSlotCode((current) => ({ ...current, [key]: e.target.value.toUpperCase() }))}
                                  placeholder="Código dry"
                                  aria-label={`Código del puesto ${slot} nivel ${level}`}
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
                                  {!rankFenceUnits(units, slotCode[key] ?? "").length ? <li className="fence-suggest-empty">Ningún contenedor coincide.</li> : null}
                                </ul>
                              </div>
                              <button className="btn-primary" type="button" disabled={busy} onClick={() => {
                                const iso = slotCode[key] ?? cell?.iso ?? "";
                                const unit = (units || []).find((item) => item.iso === iso.trim().toUpperCase());
                                if (unit?.lado) {
                                  onWarn("Ese contenedor ya está en el patio. Para llevarlo al cerco usa Trasladar.");
                                  return;
                                }
                                onFence({ sideId: side.id, slot, level, iso });
                              }}>Poner</button>
                              {level === 1 ? <button className="btn-ghost" type="button" disabled={busy} onClick={() => onFence({ sideId: side.id, slot, wall: true })}>Pasar a pared</button> : null}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {perimeter.sides.length > 3 ? (
                <button className="btn-ghost" type="button" onClick={() => setPerimeter({
                  ...perimeter,
                  sides: perimeter.sides.filter((item) => item.id !== side.id),
                  gates: perimeter.gates.filter((gate) => gate.sideId !== side.id),
                  cells: cells.filter((item) => item.sideId !== side.id),
                })}>Quitar lado</button>
              ) : null}
            </div>
          ))}
          <h4>Entradas</h4>
          {perimeter.gates.map((gate) => (
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
          ))}
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
  const [mode, setMode] = useState("3d");
  const [draft, setDraft] = useState(withSeats(layout.plan?.zones?.length ? layout.plan : FALLBACK_PLAN));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [guestFeet, setGuestFeet] = useState("20");
  const [guestColor, setGuestColor] = useState("#8a90a2");
  const [guestNote, setGuestNote] = useState("");
  const [picked, setPicked] = useState(null);
  const [transferIso, setTransferIso] = useState(null);
  const [history, setHistory] = useState([]);
  const [detailIso, setDetailIso] = useState("");
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
  const looseShown = loose.filter((unit) => !needle || `${unit.iso} ${unit.typeLabel}`.toUpperCase().includes(needle)).slice(0, 30);
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
    } catch (e) {
      setError(e.message);
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
    const named = Boolean(ghost.code);
    return {
      key: `g-${zone.id}-${row}-${col}-${level}-${ghost.half || "F"}`,
      code: named ? ghost.code : "Desconocido",
      title: named ? ghost.code : "Desconocido",
      unknown: !named,
      typeLabel: named ? feetName(ghost.typeCode) : "Desconocido",
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
    if (!selectedIso && !code) {
      setPicked(cellPick(zone, row, col, level, null, ghost || (half ? { half } : null)));
      const above = movesAbove(draft.zones, layout.units, ghosts, zone, row, col, level, undefined, ghost?.half || half, ghost?.typeCode);
      if (ghost?.code || above) return;
      try {
        await api("/yard/ghost", {
          method: "POST",
          body: { depotId: layout.depotId, zoneId: zone.id, row, col, level, occupied: !ghost, ...(half ? { half } : {}) },
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

  function dropOnFence(side, slot, level, half) {
    const moving = layout.units.find((unit) => unit.iso === transferIso);
    if (!moving) {
      setError("Elige primero el contenedor que vas a trasladar.");
      return;
    }
    const feet = feetOf(moving.type);
    const sideFeet = Number(side.containerFeet) === 20 ? 20 : 40;
    if (feet !== 20 && feet !== 40) {
      setError("Solo un contenedor de 20 o de 40 pies puede ir al cerco.");
      return;
    }
    if (sideFeet === 20 && feet !== 20) {
      setError("Ese lado es de 20 pies y este contenedor es de 40.");
      return;
    }
    const placeHalf = feet === 20 && sideFeet === 40 ? half : "";
    if (feet === 20 && sideFeet === 40 && placeHalf !== "A" && placeHalf !== "B") {
      setError("Ese puesto es de 40 pies. Un 20 ocupa la mitad A o la mitad B.");
      return;
    }
    if (fenceOpenLevel(draft.perimeter, side, slot, placeHalf, moving.iso) !== level) {
      setError("Ese puesto no tiene base libre. Un 40 necesita debajo el puesto completo, o las dos mitades de 20.");
      return;
    }
    putFence({ sideId: side.id, slot, level, iso: moving.iso, move: true, ...(placeHalf ? { half: placeHalf } : {}) });
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
            const placed = unit ? unit.lado && unit.lado !== "PASILLO" : Boolean(ghost?.code);
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
      </div>
      {error ? <div className="err">{error}</div> : null}

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
                <button className="btn-ghost" type="button" onClick={() => setDraft({
                  ...draft,
                  zones: draft.zones.filter((item) => item.id !== zone.id),
                  ghosts: draft.ghosts.filter((ghost) => ghost.zoneId !== zone.id),
                })}>Quitar</button>
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
            Aquí se arman las rumas como están en el patio: se puede cerrar Regularizar y volver a abrirlo para seguir una línea. Un 40 ocupa A y B. Un 20 ocupa solo la mitad que toques. Volver a sin sitio, o un doble clic, lo saca de la ruma aunque otro equipo le tape la vista. Si hay equipos encima, primero hay que moverlos. Fuera de esta vista, el traslado solo entra en un puesto libre al que llega el stacker.
            {selectedIso ? ` Seleccionado: ${selectedIso}.` : ""}
          </p>
          <div className="guest-form">
            <label className="zone-field">Código que no es dry
              <input aria-label="Código del equipo" value={guestCode} onChange={(e) => setGuestCode(e.target.value)} placeholder="Código" />
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
            <label className="zone-field">Nota
              <input aria-label="Nota del equipo" value={guestNote} onChange={(e) => setGuestNote(e.target.value)} placeholder="Opcional" maxLength={120} />
            </label>
          </div>
          <p className="section-sub">Escribe el código y toca la celda. Un 40 ocupa la columna completa. Un 20 o un 10 ocupa la mitad A o B. Dos de 20, uno en cada mitad, aguantan un 40 encima. Si no es dry, queda con su largo, su color y la nota.</p>
          <input className="odoo-search" aria-label="Buscar equipo sin posición" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar equipo sin posición" />
          <p className="section-sub">{loose.length} sin posición. {needle ? `Coincidencias: ${loose.filter((unit) => `${unit.iso} ${unit.typeLabel}`.toUpperCase().includes(needle)).length}.` : ""}</p>
          <div className="pill-list">
            {looseShown.map((unit) => (
              <button
                key={unit.iso}
                className="pill-check"
                type="button"
                style={{ cursor: "pointer", background: selectedIso === unit.iso ? "#12203a" : "#fff", color: selectedIso === unit.iso ? "#fff" : "inherit" }}
                onClick={() => setSelectedIso(selectedIso === unit.iso ? null : unit.iso)}
              >
                {unit.iso} — {unit.typeLabel}
              </button>
            ))}
          </div>
            </>
          )}
          {mode === "regularizar" ? info : null}
          <FencePlan
            perimeter={draft.perimeter}
            units={layout.units}
            moving={mode === "trasladar" ? layout.units.find((unit) => unit.iso === transferIso) : null}
            onOccupy={(unit) => { if (mode === "trasladar") occupyFence(unit); }}
            onEmpty={(side, slot, level, half) => { if (mode === "trasladar") dropOnFence(side, slot, level, half); }}
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
                                                    const named = Boolean(ghost?.code);
                                                    const color = occupant ? occupant.typeColor : named ? (ghost.color || typeColor(ghost.typeCode)) : undefined;
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
                        if (mode === "regularizar" && occupant) returnUnit(occupant.iso, true);
                      }}
                                                      >
                                                        {occupant ? occupant.iso.slice(-4) : named ? ghost.code.slice(-4) : ghost ? (String(ghost.typeCode || "").startsWith("20") ? "20" : "?") : slot.half === "center" ? "Medio" : slot.half || (incomingFeet >= 40 ? "A+B" : level)}
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
            onPick={(item) => {
              if (item.empty && item.fence && transferIso) {
                const side = (draft.perimeter?.sides || []).find((entry) => entry.id === item.sideId);
                if (side) dropOnFence(side, item.slot, item.level, item.half || "");
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
          />
        </>
      )}
      {detailIso ? <YardUnitDetail iso={detailIso} onClose={() => setDetailIso("")} /> : null}
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
