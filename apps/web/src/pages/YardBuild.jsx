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
  const [guestFeet, setGuestFeet] = useState("20");
  const [guestColor, setGuestColor] = useState("#8a90a2");
  const [guestNote, setGuestNote] = useState("");
  const [picked, setPicked] = useState(null);
  const [transferIso, setTransferIso] = useState(null);
  const [history, setHistory] = useState([]);
  const [detailIso, setDetailIso] = useState("");

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

  function updateZone(id, patch) {
    setDraft({ ...draft, zones: draft.zones.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)) });
  }

  function cellPick(zone, row, col, level, occupant, ghost) {
    const span = occupant ? baySpan(occupant.type, occupant.bayHalf) : baySpan(ghost?.typeCode, ghost?.half);
    const half = span === "A" || span === "B" ? span : "";
    const above = movesAbove(draft.zones, layout.units, ghosts, zone, row, col, level, occupant?.iso, half, occupant?.type || ghost?.typeCode);
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
      note: named
        ? `${ghost.note ? `${ghost.note}. ` : ""}Equipo ajeno a ZDRY, ${feetName(ghost.typeCode)}. ${access} ${cost}`
        : `Desconocido. ${access} ${cost}`,
      splittable: !named && !ghost.half,
      ghost: above ? null : { zoneId: zone.id, row, col, level, ...(ghost.half ? { half: ghost.half } : {}) },
    };
  }

  function clickedHalf(typeCode, half) {
    return feetOf(typeCode) >= 40 ? undefined : half;
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

  async function returnUnit(iso) {
    setError("");
    try {
      await api("/yard/release", { method: "POST", body: { iso, depotId: layout.depotId } });
      setPicked(null);
      setTransferIso(null);
      await onReload();
      await loadHistory(iso);
    } catch (e) {
      setError(e.message);
    }
  }

  async function moveUnit(iso, zoneName, row, col, level, half) {
    setError("");
    try {
      const moving = layout.units.find((unit) => unit.iso === iso);
      const placeHalf = clickedHalf(moving?.type, half);
      await api("/yard/place", {
        method: "POST",
        body: { iso, depotId: layout.depotId, lado: zoneName, ruma: row, columna: col, nivel: level, regularize: true, ...(placeHalf ? { half: placeHalf } : {}) },
      });
      setTransferIso(null);
      await onReload();
      await loadHistory(iso);
    } catch (e) {
      setError(e.message);
    }
  }

  async function slideTo(half) {
    if (half !== "A" && half !== "B") return;
    setError("");
    try {
      if (picked?.ghost) {
        const ghost = ghosts.find((item) => item.zoneId === picked.ghost.zoneId && item.row === picked.ghost.row && item.col === picked.ghost.col && item.level === picked.ghost.level && (item.half || "") === (picked.ghost.half || ""));
        if (!ghost?.code || feetOf(ghost.typeCode) <= 0 || feetOf(ghost.typeCode) >= 40 || ghost.half === half) return;
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
            half,
          },
        });
      } else {
        const unit = layout.units.find((item) => item.iso === picked?.code);
        if (!unit?.lado || unit.lado === "PASILLO" || !unit.ruma || !unit.columna || !unit.nivel) return;
        if (feetOf(unit.type) <= 0 || feetOf(unit.type) >= 40 || unit.bayHalf === half) return;
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
            half,
          },
        });
        await loadHistory(unit.iso);
      }
      setPicked((current) => (current ? {
        ...current,
        where: String(current.where || "").replace(/ · (mitad [AB]|al centro)$/, "") + ` · mitad ${half}`,
        ghost: current.ghost ? { ...current.ghost, half } : current.ghost,
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

  async function splitPicked() {
    if (!picked?.ghost || picked.ghost.half) return;
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
                <span>{side ? `Está en la mitad ${side}.` : "Está al centro. Muévelo a un lado para dejar espacio a otro de 20 pies."}</span>
                <button className={side === "A" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => slideTo("A")}>A la izquierda</button>
                <button className={side === "B" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => slideTo("B")}>A la derecha</button>
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
        <button className={mode === "regularizar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => { setMode("regularizar"); setTransferIso(null); }}>Regularizar</button>
        <button className={mode === "trasladar" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setMode("trasladar")}>Trasladar</button>
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

      {mode === "regularizar" || mode === "trasladar" ? (
        <div>
          {mode === "trasladar" ? (
            <>
              <p className="section-sub">
                Elige un equipo ubicado y toca el hueco destino. También puede quedar en el pasillo, en el suelo, hasta que tenga lugar. Cada traslado queda en su historial.
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
            Elige un equipo de la lista y toca la altura. Un 40 ocupa A y B. Un 20 ocupa solo la mitad que toques, y al lado puede ir otro 20. Lo que queda debajo sin identificar se ve como un 40. Si esa fila son dos de 20, usa Dividir en dos de 20. Doble clic en un equipo lo devuelve a sin posición.
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
                                              const slots = showHalves
                                                ? ["A", "B"].map((half) => ({
                                                  half,
                                                  occupant: hereUnits.find((unit) => baySpan(unit.type, unit.bayHalf) === half),
                                                  ghost: hereGhosts.find((item) => baySpan(item.typeCode, item.half) === half),
                                                }))
                                                : [{ half: "", occupant: wideUnit, ghost: wideGhost }];
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
                                                        className={`yard-cell${occupant || named ? " full" : ""}${ghost && !occupant && !named ? " ghost" : ""}${key && picked?.key === key ? " on" : ""}`}
                                                        style={color ? { background: color } : undefined}
                                                        aria-label={`${zone.name} fila ${row} columna ${col} altura ${level}${slot.half ? ` mitad ${slot.half}` : ""}`}
                                                        onClick={() => {
                                                          if (mode === "trasladar") {
                                                            if (occupant) {
                                                              setTransferIso(occupant.iso);
                                                              setPicked(cellPick(zone, row, col, level, occupant, null));
                                                              loadHistory(occupant.iso);
                                                              return;
                                                            }
                                                            if (transferIso) moveUnit(transferIso, zone.name, row, col, level, slot.half || undefined);
                                                            return;
                                                          }
                                                          onCell(zone, row, col, level, occupant, ghost, slot.half || undefined);
                                                        }}
                                                        onDoubleClick={() => {
                                                          if (mode === "regularizar" && occupant) returnUnit(occupant.iso);
                                                        }}
                                                      >
                                                        {occupant ? occupant.iso.slice(-4) : named ? ghost.code.slice(-4) : ghost ? (String(ghost.typeCode || "").startsWith("20") ? "20" : "?") : slot.half || (incomingFeet >= 40 ? "A+B" : level)}
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
            La vista muestra las rumas como las ve el operario. Un 40 ocupa la columna. Un 20 o un 10 ocupa una mitad, y dos de 20 aguantan un 40 encima. El color es el del código. Sin color, el equipo se ve gris. El rayado es un espacio ocupado sin identificar.
          </p>
          <YardScene
            zones={draft.zones}
            units={layout.units}
            ghosts={ghosts}
            typeColor={typeColor}
            picked={picked}
            targets={Boolean(transferIso)}
            incomingType={layout.units.find((unit) => unit.iso === transferIso)?.type || ""}
            transferring={Boolean(transferIso)}
            history={history}
            onTransfer={() => {
              if (!picked?.code || picked.unknown) return;
              setTransferIso(picked.code);
              loadHistory(picked.code);
            }}
            onSlide={(half) => slideTo(half)}
            onSplit={() => splitPicked()}
            onPark={() => transferIso && parkUnit(transferIso)}
            onRelease={() => transferIso && returnUnit(transferIso)}
            onClose={() => { setPicked(null); setTransferIso(null); }}
            onPick={(item) => {
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
        </>
      )}
      {detailIso ? <YardUnitDetail iso={detailIso} onClose={() => setDetailIso("")} /> : null}
    </div>
  );
}
