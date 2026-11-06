import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import YardBuild from "./YardBuild.jsx";

export default function Patio() {
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState(null);
  const [selectedIso, setSelectedIso] = useState(null);
  const [error, setError] = useState("");

  const depotId = params.get("depotId") || layout?.depotId || "";

  async function load(id) {
    const data = await api(`/yard/${id}`);
    setLayout(data);
    return data;
  }

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

  return (
    <>
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
      </div>
      {error ? <div className="err">{error}</div> : null}
      <YardBuild
        layout={layout}
        selectedIso={selectedIso}
        setSelectedIso={setSelectedIso}
        onReload={() => load(layout.depotId)}
      />
      {placed.length ? (
        <div className="panel" style={{ marginTop: 18 }}>
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
                    <td>{unit.movesToRetrieve ? `${unit.movesToRetrieve} movimiento(s)` : "En la cima"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
