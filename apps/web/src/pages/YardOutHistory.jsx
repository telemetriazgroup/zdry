import { useEffect, useState } from "react";
import { api } from "../api.js";
import YardScene, { yardMoveNote, yardSpotText } from "./YardScene.jsx";

const SOURCE = {
  odoo: "Al detectar el OUT",
  manual: "Actualización manual",
  periodico: "Revisión de 10 minutos",
};

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
}

function seatsToUnits(seats) {
  return (seats || []).map((seat) => ({
    iso: seat.iso,
    type: seat.type || "",
    typeLabel: seat.type || "",
    lado: seat.lado,
    ruma: seat.ruma,
    columna: seat.columna,
    nivel: seat.nivel,
    bayHalf: seat.bayHalf || "",
    status: seat.status || "",
    onAisle: seat.lado === "PASILLO",
  }));
}

export default function YardOutHistory({ depotId, onClose }) {
  const [updates, setUpdates] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [view, setView] = useState("antes");
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setSelectedId("");
    setPicked(null);
    setError("");
    api(`/yard/${depotId}/out-history`)
      .then((data) => {
        if (cancelled) return;
        const list = data.updates || [];
        setUpdates(list);
        setSelectedId(list[0]?.id || "");
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [depotId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setPicked(null);
    setView("antes");
    api(`/yard/${depotId}/out-history/${selectedId}`)
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [depotId, selectedId]);

  const moves = Array.isArray(detail?.moves) ? detail.moves : [];
  const snap = view === "ahora" ? detail?.after : detail?.before;
  const plan = snap?.plan || {};
  const index = updates.findIndex((item) => item.id === selectedId);

  function focusMove(move) {
    if (move.kind === "salida") setView("antes");
    const spot = move.kind === "salida" || view === "antes" ? move.from : (move.to || move.from);
    setPicked({
      key: move.iso,
      code: move.iso,
      typeLabel: move.kind === "salida" ? "Salió" : "Bajó de nivel",
      where: yardSpotText(spot),
      note: yardMoveNote(move),
    });
  }

  return (
    <section className="yard-out-history">
      <div className="action-row">
        <button className="btn-ghost" type="button" onClick={onClose}>Volver al patio</button>
        <button className="btn-ghost" type="button" disabled={index < 0 || index >= updates.length - 1} onClick={() => setSelectedId(updates[index + 1].id)}>Más antigua</button>
        <button className="btn-ghost" type="button" disabled={index <= 0} onClick={() => setSelectedId(updates[index - 1].id)}>Más reciente</button>
        <button className={view === "antes" ? "btn-primary" : "btn-ghost"} type="button" disabled={!detail} onClick={() => { setView("antes"); setPicked(null); }}>Antes</button>
        <button className={view === "ahora" ? "btn-primary" : "btn-ghost"} type="button" disabled={!detail} onClick={() => { setView("ahora"); setPicked(null); }}>Ahora</button>
      </div>
      <p className="section-sub">
        {view === "antes"
          ? "Así estaba el patio antes de esta actualización. El rojo salió. El borde ámbar bajó, y el recuadro ámbar es el puesto al que pasó."
          : "Así quedó el patio después. El borde ámbar marca al que cambió de puesto."}
      </p>
      {error ? <p className="section-sub">{error}</p> : null}
      {loading ? <p className="section-sub">Cargando el historial…</p> : null}
      {!loading && !updates.length ? (
        <p className="section-sub">Todavía no hay una actualización de OUT en este depósito. Cuando un equipo salga, aquí queda el patio como estaba y a dónde pasó cada uno.</p>
      ) : null}
      {updates.length ? (
        <div className="yard-out-layout">
          <aside className="panel yard-out-list">
            {updates.map((item) => (
              <button key={item.id} type="button" className={item.id === selectedId ? "is-on" : ""} onClick={() => setSelectedId(item.id)}>
                <b>{when(item.createdAt)}</b>
                <span>{SOURCE[item.source] || item.source}</span>
                <span>{item.leftCount} salieron · {item.dropCount} bajaron</span>
              </button>
            ))}
            {moves.length ? <h3>En esta actualización</h3> : null}
            {moves.map((move) => (
              <button key={`${move.iso}-${move.kind}`} type="button" className={`yard-out-move ${move.kind}${picked?.key === move.iso ? " is-on" : ""}`} onClick={() => focusMove(move)}>
                <b>{move.iso}</b>
                <span>{yardMoveNote(move)}</span>
              </button>
            ))}
          </aside>
          {detail ? (
            <YardScene
              zones={plan.zones || []}
              ghosts={plan.ghosts || []}
              perimeter={plan.perimeter}
              units={seatsToUnits(snap?.seats)}
              moves={view === "antes" ? moves : moves.filter((move) => move.kind === "baja")}
              replay
              typeColor={() => "#8a90a2"}
              picked={picked}
              onPick={setPicked}
              onClose={() => setPicked(null)}
            />
          ) : <p className="section-sub">Cargando esta actualización…</p>}
        </div>
      ) : null}
    </section>
  );
}
