import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function ConfigPage() {
  const [data, setData] = useState(null);
  const [rules, setRules] = useState(null);
  const [vis, setVis] = useState([]);
  const [pricing, setPricing] = useState([]);
  const [services, setServices] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api("/config/sections").then(setData).catch((e) => setError(e.message));
    api("/config/yard-columns").then(setRules).catch(() => {});
    api("/config/visibility").then(setVis).catch(() => {});
    api("/config/pricing").then(setPricing).catch(() => {});
    api("/config/commercial-services").then(setServices).catch(() => {});
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

  async function saveVis() {
    setSaved("");
    try {
      const out = await api("/config/visibility", { method: "PUT", body: { rules: vis } });
      setVis(out);
      setSaved("✓ Visibilidad de precios actualizada.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function savePricing() {
    setSaved("");
    try {
      const out = await api("/config/pricing", { method: "PUT", body: { rules: pricing } });
      setPricing(out);
      setSaved("✓ Reglas de precio actualizadas. Las unidades nuevas las usan al cotizar.");
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

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Visibilidad de precios en catálogo</h3>
        <p className="section-sub">Jerarquía global → tipo/categoría/depósito → fabricante → unidad. CIMC visible por defecto; el resto pide precio.</p>
        {vis.map((r, i) => (
          <div className="form-grid" key={r.id || i}>
            <div>
              <label>Ámbito</label>
              <input value={r.scope} onChange={(e) => setVis(vis.map((x, j) => j === i ? { ...x, scope: e.target.value } : x))} />
            </div>
            <div>
              <label>Target</label>
              <input value={r.target || ""} onChange={(e) => setVis(vis.map((x, j) => j === i ? { ...x, target: e.target.value || null } : x))} />
            </div>
            <div>
              <label>Mostrar precio</label>
              <select value={r.show ? "1" : "0"} onChange={(e) => setVis(vis.map((x, j) => j === i ? { ...x, show: e.target.value === "1" } : x))}>
                <option value="1">Sí</option>
                <option value="0">No</option>
              </select>
            </div>
          </div>
        ))}
        <button className="btn-ghost" type="button" onClick={() => setVis([...vis, { scope: "global", target: null, show: false }])}>Añadir regla</button>
        <button className="btn-primary" type="button" style={{ marginLeft: 8 }} onClick={saveVis}>Guardar visibilidad</button>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Reglas de precio (margen / descuento máximo)</h3>
        {pricing.map((r, i) => (
          <div className="form-grid" key={r.id || i}>
            <div>
              <label>Ámbito</label>
              <input value={r.scope} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, scope: e.target.value } : x))} />
            </div>
            <div>
              <label>Target</label>
              <input value={r.target || ""} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, target: e.target.value || null } : x))} />
            </div>
            <div>
              <label>Margen %</label>
              <input type="number" value={r.marginPct} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, marginPct: Number(e.target.value) } : x))} />
            </div>
            <div>
              <label>Dto. máx %</label>
              <input type="number" value={r.maxDiscountPct} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, maxDiscountPct: Number(e.target.value) } : x))} />
            </div>
          </div>
        ))}
        <button className="btn-primary" type="button" onClick={savePricing}>Guardar precios</button>
      </div>

      {services.length ? (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Servicios comerciales</h3>
          <table className="data">
            <thead><tr><th>Servicio</th><th>Precio</th></tr></thead>
            <tbody>{services.map((s) => <tr key={s.id}><td>{s.name}</td><td>${Number(s.price)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}

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
            ) : s.status === "partial" ? (
              <div className="locked-note" style={{ marginTop: 8 }}>Stub de zonas en cierre comercial (Sprint 4); Maps en Sprint 7</div>
            ) : (
              <div className="locked-note" style={{ marginTop: 8 }}>Ancla Sprint 1 — edición en sprints posteriores</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
