import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { hasRole, isSuperadmin, useAuth } from "../auth.jsx";
import YardBuild from "./YardBuild.jsx";

export default function Patio() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState(null);
  const [selectedIso, setSelectedIso] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState("guardado");
  const [withPerimeter, setWithPerimeter] = useState(true);
  const [ruma, setRuma] = useState("cargado");

  const depotId = params.get("depotId") || layout?.depotId || "";

  async function load(id) {
    const data = await api(`/yard/${id}`);
    setLayout(data);
    return data;
  }

  useEffect(() => {
    if (!layout?.activeScenario) return;
    setScenario(layout.activeScenario);
    setWithPerimeter(layout.withPerimeter === true);
  }, [layout?.activeScenario, layout?.withPerimeter]);

  useEffect(() => {
    if (layout?.activeRuma) setRuma(layout.activeRuma);
  }, [layout?.activeRuma]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (depotId) {
          const data = await load(depotId);
          if (!cancelled) setLayout(data);
          return;
        }
        const meta = await api("/warehouse/meta");
        const first = meta.depots[0]?.id;
        if (first) {
          setParams({ depotId: first }, { replace: true });
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [depotId]);

  if (!layout) {
    return (
      <>
        <h2 className="section-title">Layout de patio</h2>
        {error ? <div className="err">{error}</div> : <p className="section-sub">Cargando…</p>}
      </>
    );
  }

  const placed = layout.units.filter((unit) => unit.lado);

  async function resetDepot() {
    const text = layout.simulation
      ? "Reiniciar la simulación: los equipos vuelven a sin posición y se borran los huecos desconocidos. Las zonas se conservan. El patio real no cambia."
      : `Devolver a sin posición todos los equipos de ${layout.depotName}. El plano de zonas se conserva.`;
    if (!window.confirm(text)) return;
    setBusy(true);
    setError("");
    try {
      await api("/yard/reset", { method: "POST", body: { depotId: layout.depotId } });
      setSelectedIso(null);
      await load(layout.depotId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadScenario() {
    const chosen = (layout.scenarios || []).find((item) => item.id === scenario);
    const name = chosen?.name || "el escenario";
    const fence = withPerimeter ? "con perímetro" : "sin perímetro";
    if (!window.confirm(`Cargar ${name}, ${fence}. Se vacían las posiciones y se vuelven a poner las zonas de ese escenario.`)) return;
    setBusy(true);
    setError("");
    try {
      await api("/yard/scenario", { method: "POST", body: { depotId: layout.depotId, scenario, withPerimeter } });
      setSelectedIso(null);
      await load(layout.depotId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadRumas() {
    const chosen = (layout.rumas || []).find((item) => item.id === ruma);
    const name = chosen?.name || "la plantilla";
    if (!window.confirm(`Cargar ${name}. Se reemplazan las posiciones de esta simulación con esa estructura de rumas. Los equipos se reparten al azar y el patio real no cambia.`)) return;
    setBusy(true);
    setError("");
    try {
      await api("/yard/rumas", { method: "POST", body: { depotId: layout.depotId, template: ruma } });
      setSelectedIso(null);
      await load(layout.depotId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function restoreScenario() {
    if (!layout.activeScenario) return;
    setBusy(true);
    setError("");
    try {
      await api("/yard/scenario", {
        method: "POST",
        body: { depotId: layout.depotId, scenario: layout.activeScenario, withPerimeter: layout.withPerimeter === true },
      });
      setSelectedIso(null);
      await load(layout.depotId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yard-page">
      <h2 className="section-title">Patio</h2>
      <div className="unit-picker">
        <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>Depósito:</label>
        <select
          value={layout.depotId}
          onChange={(e) => {
            setSelectedIso(null);
            setParams({ depotId: e.target.value });
          }}
        >
          {layout.depots.map((depot) => <option key={depot.id} value={depot.id}>{depot.name}</option>)}
        </select>
        {selectedIso ? (
          <button className="btn-ghost" type="button" onClick={() => setSelectedIso(null)}>
            Cancelar selección ({selectedIso})
          </button>
        ) : null}
        {(layout.simulation ? hasRole(user, "admin") : isSuperadmin(user)) ? (
          <button className="btn-ghost yard-reset" type="button" disabled={busy} onClick={resetDepot}>
            {layout.simulation ? "Reiniciar simulación" : "Vaciar posiciones"}
          </button>
        ) : null}
      </div>
      {layout.simulation ? (
        <p className="section-sub">
          {layout.depotId === "yard-demo-2"
            ? "Depósito demo 2. Carga un escenario y una plantilla de rumas para practicar traslados. Vaciar posiciones no borra las zonas. El patio real no se mueve."
            : "Depósito demo. Carga una plantilla de rumas para simular el patio. Los equipos se reparten al azar y lo que muevas aquí no cambia el depósito real."}
        </p>
      ) : null}
      {layout.simulation && hasRole(user, "admin") ? (
        <div className="action-row" style={{ marginTop: 8 }}>
          <label className="zone-field">Plantilla de rumas
            <select aria-label="Plantilla de rumas" value={ruma} onChange={(e) => setRuma(e.target.value)}>
              {(layout.rumas || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button className="btn-primary" type="button" disabled={busy || !(layout.rumas || []).length} onClick={loadRumas}>Cargar rumas</button>
          <p className="section-sub" style={{ margin: 0 }}>{(layout.rumas || []).find((item) => item.id === ruma)?.detail}</p>
        </div>
      ) : null}
      {layout.depotId === "yard-demo-2" && hasRole(user, "admin") ? (
        <div className="action-row" style={{ marginTop: 8 }}>
          <label className="zone-field">Escenario
            <select aria-label="Escenario del depósito demo 2" value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {(layout.scenarios || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="zone-field">Perímetro
            <select aria-label="Perímetro del escenario" value={withPerimeter ? "si" : "no"} onChange={(e) => setWithPerimeter(e.target.value === "si")}>
              <option value="si">Con perímetro</option>
              <option value="no">Sin perímetro</option>
            </select>
          </label>
          <button className="btn-primary" type="button" disabled={busy} onClick={loadScenario}>Cargar escenario</button>
          <button className="btn-ghost" type="button" disabled={busy || !layout.activeScenario} onClick={restoreScenario}>Volver a poner las zonas</button>
        </div>
      ) : null}
      {error ? <div className="err">{error}</div> : null}
      <YardBuild
        layout={layout}
        selectedIso={selectedIso}
        setSelectedIso={setSelectedIso}
        onReload={() => load(layout.depotId)}
      />
      {placed.length ? (
        <div className="panel yard-table" style={{ marginTop: 18 }}>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ISO</th><th>Tipo</th><th>Condición</th><th>Estado</th><th>Posición</th><th>Para acceder</th>
                </tr>
              </thead>
              <tbody>
                {placed.map((unit) => (
                  <tr key={unit.iso}>
                    <td>{unit.iso}</td>
                    <td>{unit.typeLabel}</td>
                    <td style={{ color: unit.catColor }}>{unit.catLabel}</td>
                    <td>{unit.status}</td>
                    <td>{unit.posLabel}</td>
                    <td>{unit.onAisle ? "En el pasillo" : unit.lado ? (unit.movesToRetrieve ? `${unit.movesToRetrieve} movimiento(s)` : "Con vista") : "Sin posición"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
