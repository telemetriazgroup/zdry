import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function ConfigPage() {
  const [data, setData] = useState(null);
  const [rules, setRules] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api("/config/sections").then(setData).catch((e) => setError(e.message));
    api("/config/yard-columns").then(setRules).catch(() => {});
  }, []);

  async function saveRules(next) {
    setSaved("");
    try {
      const out = await api("/config/yard-columns", { method: "PUT", body: next });
      setRules(out);
      setSaved("✓ Reglas de columna guardadas — el patio las aplica en el siguiente movimiento.");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Configuración</h2>
      <p className="section-sub">{data?.note || "Solo Administrador y Gerente."}</p>
      {error ? <div className="err">{error}</div> : null}
      {saved ? <div className="ok-msg">{saved}</div> : null}
      {rules ? (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Reglas de columna del patio</h3>
          <p className="section-sub">Controla cuánto se apila por columna y qué unidades pueden compartir una misma columna. Además, una columna nueva (Col. 2, Col. 3…) solo se habilita cuando la columna anterior de esa ruma está completamente llena — esto se aplica siempre, para que el patio se llene de forma ordenada.</p>
          <div className="form-grid">
            <div>
              <label>Nivel mínimo antes de considerarse "óptima"</label>
              <input
                type="number"
                min={1}
                value={rules.minNivel}
                onChange={(e) => saveRules({ ...rules, minNivel: parseInt(e.target.value, 10) || 1 })}
              />
            </div>
            <div>
              <label>Nivel máximo de apilamiento por columna</label>
              <input
                type="number"
                min={1}
                max={5}
                value={rules.maxNivel}
                onChange={(e) => saveRules({ ...rules, maxNivel: parseInt(e.target.value, 10) || 1 })}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", margin: "12px 0 4px" }}>Criterios de agrupación por columna</div>
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: "0 0 8px" }}>El tamaño (20'/40'/45') siempre se respeta — físicamente no se puede apilar tamaños distintos. Estos criterios son adicionales:</p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={!!rules.groupCategoria} onChange={(e) => saveRules({ ...rules, groupCategoria: e.target.checked })} />
              Agrupar por condición (nuevo/usado)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={!!rules.groupProveedor} onChange={(e) => saveRules({ ...rules, groupProveedor: e.target.checked })} />
              Agrupar por fabricante/proveedor
            </label>
          </div>
        </div>
      ) : null}
      <div className="config-grid">
        {(data?.sections || []).map((s) => (
          <div className="config-card" key={s.id}>
            <h4>{s.title}</h4>
            <p>{s.blurb}</p>
            {s.status === "live" ? (
              <div className="ok-msg" style={{ marginTop: 8 }}>Activo — edición arriba</div>
            ) : (
              <div className="locked-note" style={{ marginTop: 8 }}>Ancla Sprint 1 — edición en sprints posteriores</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
