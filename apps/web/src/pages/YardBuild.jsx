import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import YardScene from "./YardScene.jsx";

const LEFT = new Set(["Vendido", "Alquilado", "Retirado por cliente"]);
const FALLBACK_PLAN = {
  zones: [{ id: "zona-a", name: "Zona A", rows: 4, cols: 3, levels: 5, gridRow: 1, gridCol: 1 }],
  aisles: [],
  ghosts: [],
};

function freshId(prefix) {
  return `${prefix}-${Date.now().toString(36)}`;
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

function supportedGhosts(zones, units, ghosts) {
  const next = (ghosts || []).map((ghost) => ({ ...ghost }));
  const tops = new Map();
  const bump = (zoneId, row, col, level) => {
    if (level < 1) return;
    const key = `${zoneId}:${row}:${col}`;
    tops.set(key, Math.max(tops.get(key) || 0, level));
  };
  for (const ghost of next) bump(ghost.zoneId, ghost.row, ghost.col, ghost.level);
  for (const unit of units || []) {
    const zone = zones.find((item) => item.name === unit.lado);
    if (zone && unit.ruma && unit.columna && unit.nivel) bump(zone.id, unit.ruma, unit.columna, unit.nivel);
  }
  for (const [key, top] of tops) {
    const [zoneId, rowRaw, colRaw] = key.split(":");
    const zone = zones.find((item) => item.id === zoneId);
    if (!zone) continue;
    const row = Number(rowRaw);
    const col = Number(colRaw);
    for (let level = 1; level < top; level += 1) {
      const hasGhost = next.some((ghost) => ghost.zoneId === zoneId && ghost.row === row && ghost.col === col && ghost.level === level);
      const hasUnit = (units || []).some((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel === level);
      if (!hasGhost && !hasUnit) next.push({ zoneId, row, col, level });
    }
  }
  return next;
}

function movesAbove(zones, units, ghosts, zone, row, col, level, iso) {
  const unitsAbove = (units || []).filter(
    (unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel > level && unit.iso !== iso,
  ).length;
  const ghostsAbove = ghosts.filter((ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level).length;
  return unitsAbove + ghostsAbove;
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

export default function YardBuild({ layout, onReload, selectedIso, setSelectedIso }) {
  const [mode, setMode] = useState("3d");
  const [draft, setDraft] = useState(withSeats(layout.plan?.zones?.length ? layout.plan : FALLBACK_PLAN));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [guestType, setGuestType] = useState("");
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    setDraft(withSeats(layout.plan?.zones?.length ? layout.plan : FALLBACK_PLAN));
  }, [layout.depotId, layout.plan]);

  const types = useMemo(
    () => (layout.types || []).filter((type) => !type.archivedAt),
    [layout.types],
  );
  const typeByCode = useMemo(() => Object.fromEntries(types.map((type) => [type.code, type])), [types]);
  const typeColor = (code) => typeByCode[code]?.color || "#8a90a2";
  const typeLabel = (code) => typeByCode[code]?.label || code || "Sin tipo";

  if (!draft?.zones?.length) return null;

  const loose = layout.units.filter((unit) => !unit.lado && !LEFT.has(unit.status));
  const ghosts = supportedGhosts(draft.zones, layout.units, draft.ghosts);
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

  function updateZone(id, patch) {
    setDraft({ ...draft, zones: draft.zones.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)) });
  }

  function cellPick(zone, row, col, level, occupant, ghost) {
    const above = movesAbove(draft.zones, layout.units, ghosts, zone, row, col, level, occupant?.iso);
    const freeMoves = layout.retrieval?.freeMoves ?? 3;
    const rate = layout.retrieval?.rate ?? 25;
    const extraMoves = Math.max(0, above - freeMoves);
    const reference = extraMoves * rate;
    const access = above
      ? `Para sacarlo hay que mover ${above} ${above === 1 ? "equipo" : "equipos"}.`
      : "Está en la cima. Se saca sin movimientos.";
    const cost = extraMoves
      ? `Referencia de costo extra: USD ${reference} (${extraMoves} × ${rate}). ${freeMoves} movimientos van libres.`
      : `Sin cargo extra de movimientos. ${freeMoves} van libres.`;
    const where = `${zone.name} · fila ${row} · columna ${col} · altura ${level}`;
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
        note: `${occupant.status || ""}. ${access} ${cost}`,
      };
    }
    if (!ghost) return null;
    const named = Boolean(ghost.code);
    return {
      key: `g-${zone.id}-${row}-${col}-${level}`,
      code: named ? ghost.code : "Desconocido",
      title: named ? ghost.code : "Desconocido",
      unknown: !named,
      typeLabel: named ? typeLabel(ghost.typeCode) : "Desconocido",
      where,
      access,
      cost,
      note: named
        ? `Equipo ajeno a ZDRY. ${access} ${cost}`
        : `Desconocido. ${access} ${cost}`,
      ghost: above ? null : { zoneId: zone.id, row, col, level },
    };
  }

  async function onCell(zone, row, col, level, occupant, ghost) {
    setError("");
    const code = guestCode.trim().toUpperCase();
    if (occupant) {
      setPicked(cellPick(zone, row, col, level, occupant, null));
      if (selectedIso || code) setError("Esa posición ya tiene un equipo.");
      return;
    }
    if (!selectedIso && !code) {
      setPicked(cellPick(zone, row, col, level, null, ghost));
      const above = movesAbove(draft.zones, layout.units, ghosts, zone, row, col, level);
      if (ghost?.code || above) return;
      try {
        await api("/yard/ghost", {
          method: "POST",
          body: { depotId: layout.depotId, zoneId: zone.id, row, col, level, occupied: !ghost },
        });
        await onReload();
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    try {
      if (selectedIso) {
        await api("/yard/place", {
          method: "POST",
          body: { iso: selectedIso, depotId: layout.depotId, lado: zone.name, ruma: row, columna: col, nivel: level, regularize: true },
        });
        setSelectedIso(null);
      } else {
        const known = layout.units.find((unit) => unit.iso.toUpperCase() === code);
        if (known) {
          await api("/yard/place", {
            method: "POST",
            body: { iso: known.iso, depotId: layout.depotId, lado: zone.name, ruma: row, columna: col, nivel: level, regularize: true },
          });
        } else {
          await api("/yard/ghost", {
            method: "POST",
            body: { depotId: layout.depotId, zoneId: zone.id, row, col, level, occupied: true, code, typeCode: guestType },
          });
        }
        setGuestCode("");
      }
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
          {picked.ghost ? <button className="btn-ghost" type="button" onClick={clearPicked}>Liberar hueco</button> : null}
        </>
      ) : <span>Toca un contenedor para ver el código y el tipo.</span>}
    </div>
  );

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="action-row">
        <b>Plano del almacén</b>
        <button className={mode === "3d" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("3d")}>Vista del operario</button>
        <button className={mode === "armar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("armar")}>Armar zonas</button>
        <button className={mode === "regularizar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("regularizar")}>Regularizar</button>
      </div>
      {error ? <div className="err">{error}</div> : null}

      {mode === "armar" ? (
        <div>
          <p className="section-sub">Cada zona ocupa un puesto de la cuadrícula. La cuarta zona cae en la fila 2, columna 1, debajo de la A, con pasillo de por medio.</p>
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

      {mode === "regularizar" ? (
        <div>
          <p className="section-sub">
            Elige un equipo de la lista y toca la altura. Los niveles de abajo quedan ocupados sin identificar, para que la ruma no flote. Ese hueco se reemplaza con un equipo disponible o con un código ajeno a ZDRY. Sin equipo elegido, el toque marca la celda como ocupada.
            {selectedIso ? ` Seleccionado: ${selectedIso}.` : ""}
          </p>
          <div className="guest-form">
            <label className="zone-field">Código que no es dry
              <input aria-label="Código del equipo" value={guestCode} onChange={(e) => setGuestCode(e.target.value)} placeholder="Código" />
            </label>
            <label className="zone-field">Tipo
              <select aria-label="Tipo del equipo" value={guestType} onChange={(e) => setGuestType(e.target.value)}>
                <option value="">Sin tipo</option>
                {types.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
              </select>
            </label>
          </div>
          <p className="section-sub">Escribe el código y toca la celda. Si ese código ya está en el almacén, se ubica ese equipo. Si no es dry, queda en el patio con su código y su tipo.</p>
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
          {info}
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
                                              const occupant = layout.units.find((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel === level);
                                              const ghost = ghosts.find((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === level);
                                              const named = Boolean(ghost?.code);
                                              const color = occupant ? occupant.typeColor : named ? typeColor(ghost.typeCode) : undefined;
                                              return (
                                                <button
                                                  key={level}
                                                  type="button"
                                                  className={`yard-cell${occupant || named ? " full" : ""}${ghost && !occupant && !named ? " ghost" : ""}${picked?.key === (occupant?.iso || `g-${zone.id}-${row}-${col}-${level}`) ? " on" : ""}`}
                                                  style={color ? { background: color } : undefined}
                                                  aria-label={`${zone.name} fila ${row} columna ${col} altura ${level}`}
                                                  onClick={() => onCell(zone, row, col, level, occupant, ghost)}
                                                >
                                                  {occupant ? occupant.iso.slice(-4) : named ? ghost.code.slice(-4) : ghost ? "?" : level}
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
          <p className="section-sub">
            La vista muestra las rumas como las ve el operario. El largo sigue al tipo: un 40 pies ocupa el doble que un 20. El color es el del código. Sin color, el equipo se ve gris. El rayado es un espacio ocupado sin identificar.
          </p>
          <YardScene
            zones={draft.zones}
            units={layout.units}
            ghosts={ghosts}
            typeColor={typeColor}
            picked={picked}
            onClose={() => setPicked(null)}
            onPick={(item) => {
              if (item.ghost) {
                const zone = draft.zones.find((entry) => entry.id === item.ghost.zoneId);
                const ghost = ghosts.find((entry) => entry.zoneId === item.ghost.zoneId && entry.row === item.ghost.row && entry.col === item.ghost.col && entry.level === item.ghost.level);
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
        </>
      )}
    </div>
  );
}
