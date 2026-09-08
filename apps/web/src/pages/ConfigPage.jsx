import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload, apiUrl, ApiError } from "../api.js";
import { useAuth } from "../auth.jsx";

function DemoPanel() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function refresh() {
    const d = await api("/demo");
    setSt(d);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function run(label, path, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setError("");
    setMsg("");
    try {
      await api(path, { method: "POST" });
      await refresh();
      setMsg("Listo.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  if (!st) {
    return (
      <div className="panel demo-panel" style={{ marginBottom: 18 }}>
        <h3>Modo demostración</h3>
        {error ? <div className="err">{error}</div> : <p className="section-sub">Cargando…</p>}
      </div>
    );
  }

  const disabled = !!busy;

  return (
    <div className="panel demo-panel" style={{ marginBottom: 18 }}>
      <h3>Modo demostración</h3>
      <p className="section-sub">
        Solo superusuario. Carga un dataset etiquetado que convive con los datos reales: al volver a producción
        se oculta, no se borra. Las fotos salen de Wikimedia Commons (CC BY-SA).
      </p>
      <div className="tile-row" style={{ margin: "12px 0" }}>
        <div className="tile">
          <div className="v">{st.on ? "DEMO" : "PROD"}</div>
          <div className="l">Modo actual</div>
        </div>
        <div className="tile">
          <div className="v">{st.counts?.containers ?? 0}</div>
          <div className="l">Unidades demo</div>
        </div>
        <div className="tile">
          <div className="v">{st.counts?.quotes ?? 0}</div>
          <div className="l">Cotizaciones demo</div>
        </div>
        <div className="tile">
          <div className="v">{st.backups?.length ?? 0}</div>
          <div className="l">Backups</div>
        </div>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {busy ? <div className="warn-inline">{busy}… puede tardar un minuto si descarga fotos.</div> : null}
      <div className="action-row">
        <button className="btn-primary" type="button" disabled={disabled || st.on} onClick={() => run("Activando demo", "/demo/activate")}>
          Activar modo demo
        </button>
        <button className="btn-ghost" type="button" disabled={disabled || !st.on} onClick={() => run("Volviendo a producción", "/demo/production")}>
          Volver a producción
        </button>
        <button className="btn-ghost" type="button" disabled={disabled || !st.loaded} onClick={() => run("Recargando dataset", "/demo/reload", "¿Recargar el dataset demo? Se hace backup automático. Los datos de producción no se tocan.")}>
          Recargar dataset
        </button>
        <button className="btn-ghost" type="button" disabled={disabled} onClick={() => run("Creando backup", "/demo/backups")}>
          Backup ahora
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={disabled || !st.loaded}
          onClick={() => run("Vaciando demo", "/demo/purge", "¿Eliminar solo los datos etiquetados como demo? Producción se conserva. Se crea un backup antes.")}
        >
          Vaciar datos demo
        </button>
      </div>
      {st.demoLogins?.length ? (
        <p className="section-sub" style={{ marginTop: 12 }}>
          Clientes demo (clave {st.demoLogins[0].password}): {st.demoLogins.map((u) => u.email).join(" · ")}
        </p>
      ) : null}
      {st.backups?.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="box-kicker">Backups (restaurar reinyecta filas por ID; no borra lo creado después)</div>
          <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Etiqueta</th>
                <th>Tipo</th>
                <th>Tamaño</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {st.backups.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.createdAt).toLocaleString("es-PE")}</td>
                  <td>{b.label}</td>
                  <td>{b.kind}</td>
                  <td>{Math.round(b.sizeBytes / 1024)} KB</td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={disabled}
                      onClick={() => run("Restaurando", `/demo/backups/${b.id}/restore`, "¿Restaurar este backup? Se reinyectan los registros. Los datos actuales no se eliminan.")}
                    >
                      Restaurar
                    </button>
                  </td>
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

function WatermarkPanel({ onSaved, onError }) {
  const [meta, setMeta] = useState({ watermarkSource: "default", watermarkName: "zg_marca.png" });
  const [bust, setBust] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const d = await api("/catalog-media/meta");
    setMeta(d);
    setBust(Date.now());
  }

  useEffect(() => {
    refresh().catch((e) => onError(e.message));
  }, []);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    onError("");
    onSaved("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiUpload("/catalog-media/watermark", fd);
      await refresh();
      onSaved(`Marca de agua guardada. Se reaplicó a ${res.applied || 0} ficha(s) ya publicadas.`);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm("¿Volver a zg_marca.png en las fotos públicas?")) return;
    setBusy(true);
    onError("");
    onSaved("");
    try {
      const res = await api("/catalog-media/watermark", { method: "DELETE" });
      await refresh();
      onSaved(`Predeterminado zg_marca.png. Se reaplicó a ${res.applied || 0} ficha(s) publicadas.`);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3>Marca de agua del catálogo</h3>
      <p className="section-sub">
        Se repite sobre toda la foto pública (no sobre el original de patio). Si no subes una, se usa{" "}
        <b>zg_marca.png</b>. Al publicar, la imagen se ajusta al recuadro de la ficha del cliente (sin franjas azules).
      </p>
      <div className="watermark-config">
        <div className="watermark-preview">
          <img src={`${apiUrl("/catalog-media/watermark")}?t=${bust}`} alt="Marca de agua actual" />
        </div>
        <div>
          <p className="section-sub" style={{ marginTop: 0 }}>
            Actual: {meta.watermarkSource === "custom" ? `personalizada (${meta.watermarkName})` : "predeterminada zg_marca.png"}
          </p>
          <div className="action-row">
            <label className="btn-primary" style={{ display: "inline-block", cursor: busy ? "wait" : "pointer" }}>
              {busy ? "Aplicando…" : "Subir logo"}
              <input
                type="file"
                accept="image/png,image/jpeg"
                hidden
                disabled={busy}
                onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
            <button className="btn-ghost" type="button" disabled={busy || meta.watermarkSource !== "custom"} onClick={reset}>
              Usar zg_marca.png
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DepotConceptsPanel({ onSaved, onError }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("0");

  async function load() {
    const list = await api("/config/depot-concepts");
    setRows(list);
  }

  useEffect(() => {
    load().catch((e) => onError(e.message));
  }, []);

  async function saveRow(row) {
    onError("");
    try {
      await api(`/config/depot-concepts/${row.id}`, { method: "PUT", body: { amount: Number(row.amount), label: row.label, active: row.active } });
      await load();
      onSaved("Conceptos de patio actualizados.");
    } catch (e) {
      onError(e.message);
    }
  }

  async function add() {
    onError("");
    try {
      await api("/config/depot-concepts", { method: "POST", body: { label, amount: Number(amount) } });
      setLabel("");
      setAmount("0");
      await load();
      onSaved("Concepto agregado.");
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3>Conceptos de patio (precios)</h3>
      <p className="section-sub">El coordinador registra actividades sin ver el monto. Gate-In se aplica solo una vez al enviar a campo.</p>
      <div className="tablewrap">
        <table className="data">
          <thead><tr><th>Concepto</th><th>Monto USD</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.label}{r.system ? " · sistema" : ""}</td>
                <td>
                  <input
                    type="number"
                    value={r.amount}
                    onChange={(e) => setRows(rows.map((x) => x.id === r.id ? { ...x, amount: e.target.value } : x))}
                    onBlur={(e) => saveRow({ ...r, amount: e.target.value })}
                    style={{ width: 90 }}
                  />
                </td>
                <td>{r.active ? "Activo" : "Oculto"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <div><label>Nuevo concepto</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej. Lavado especial" /></div>
        <div><label>Monto</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
      <button className="btn-primary" type="button" style={{ marginTop: 8 }} onClick={add}>Agregar concepto</button>
    </div>
  );
}

export default function ConfigPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [rules, setRules] = useState(null);
  const [vis, setVis] = useState([]);
  const [pricing, setPricing] = useState([]);
  const [refs, setRefs] = useState([]);
  const [refMeta, setRefMeta] = useState({ types: [], categories: [] });
  const [services, setServices] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api("/config/sections").then(setData).catch((e) => setError(e.message));
    api("/config/yard-columns").then(setRules).catch(() => {});
    api("/config/visibility").then(setVis).catch(() => {});
    api("/config/pricing").then(setPricing).catch(() => {});
    api("/config/acquisition-refs").then((d) => {
      setRefs(d.refs || []);
      setRefMeta({ types: d.types || [], categories: d.categories || [] });
    }).catch(() => {});
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

  async function saveRefs() {
    setSaved("");
    try {
      const out = await api("/config/acquisition-refs", { method: "PUT", body: { refs } });
      setRefs(out.refs || []);
      setSaved("✓ Costos de referencia guardados. El cálculo de lista usa estos montos si la unidad no tiene FOB/CIF.");
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

      <WatermarkPanel onSaved={setSaved} onError={setError} />

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Textos del catálogo público</h3>
        <p className="section-sub">Titular, carrusel, pasos, botones, pie y legales. Editas a la izquierda y ves a la derecha cómo lo ve el cliente.</p>
        <Link className="btn-primary" to="/app/catalogo-textos">Abrir editor</Link>
      </div>

      {user?.role === "admin" ? <DemoPanel /> : null}

      {user?.role === "admin" ? <DepotConceptsPanel onSaved={setSaved} onError={setError} /> : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Visibilidad de precios en catálogo</h3>
        <p className="section-sub">Jerarquía global → tipo/categoría/depósito → fabricante → unidad. CIMC visible por defecto; el resto pide precio. El neto, IGV e historial de una unidad se fijan en Ficha catálogo.</p>
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
        <div className="action-row">
          <button className="btn-ghost" type="button" onClick={() => setVis([...vis, { scope: "global", target: null, show: false }])}>Añadir regla</button>
          <button className="btn-primary" type="button" onClick={saveVis}>Guardar visibilidad</button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Costos de referencia (tipo / condición)</h3>
        <p className="section-sub">
          Base en USD cuando la unidad no tiene FOB/CIF. Una fila por tipo vale para todas las condiciones; si pones tipo + condición (ej. 20FR · 1TRIP), esa gana. El margen de abajo convierte esta base en neto de lista.
        </p>
        {refs.map((r, i) => (
          <div className="form-grid" key={`${r.type}-${r.cat || "all"}-${i}`}>
            <div>
              <label>Tipo</label>
              <select value={r.type} onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                {(refMeta.types.length ? refMeta.types : [{ code: r.type, label: r.type }]).map((t) => (
                  <option key={t.code} value={t.code}>{t.code} · {t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Condición (opcional)</label>
              <select value={r.cat || ""} onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, cat: e.target.value || null } : x))}>
                <option value="">Todas</option>
                {refMeta.categories.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Costo referencia USD</label>
              <input type="number" min="1" value={r.amount} onChange={(e) => setRefs(refs.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button className="btn-ghost" type="button" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          </div>
        ))}
        <div className="action-row">
          <button
            className="btn-ghost"
            type="button"
            onClick={() => setRefs([...refs, { type: refMeta.types[0]?.code || "20GP", cat: null, amount: 2800 }])}
          >
            Añadir referencia
          </button>
          <button className="btn-primary" type="button" onClick={saveRefs}>Guardar referencias</button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Reglas de precio (margen / descuento máximo)</h3>
        <p className="section-sub">Se aplica sobre el costo de referencia o el FOB/CIF. Ámbito más específico gana (unidad → fabricante → tipo/condición → global).</p>
        {pricing.map((r, i) => (
          <div className="form-grid" key={r.id || i}>
            <div>
              <label>Ámbito</label>
              <select value={r.scope} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, scope: e.target.value } : x))}>
                <option value="global">global</option>
                <option value="type">tipo</option>
                <option value="category">condición</option>
                <option value="manufacturer">fabricante</option>
                <option value="container">unidad</option>
              </select>
            </div>
            <div>
              <label>Target</label>
              {r.scope === "type" ? (
                <select value={r.target || ""} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, target: e.target.value || null } : x))}>
                  <option value="">—</option>
                  {refMeta.types.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
                </select>
              ) : r.scope === "category" ? (
                <select value={r.target || ""} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, target: e.target.value || null } : x))}>
                  <option value="">—</option>
                  {refMeta.categories.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              ) : (
                <input value={r.target || ""} onChange={(e) => setPricing(pricing.map((x, j) => j === i ? { ...x, target: e.target.value || null } : x))} placeholder={r.scope === "global" ? "—" : "CIMC / ISO"} />
              )}
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
        <div className="action-row">
          <button className="btn-ghost" type="button" onClick={() => setPricing([...pricing, { scope: "category", target: "1TRIP", marginPct: 14, maxDiscountPct: 5 }])}>Añadir regla</button>
          <button className="btn-primary" type="button" onClick={savePricing}>Guardar precios</button>
        </div>
      </div>

      {services.length ? (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Servicios comerciales</h3>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Servicio</th><th>Precio</th></tr></thead>
              <tbody>{services.map((s) => <tr key={s.id}><td>{s.name}</td><td>${Number(s.price)}</td></tr>)}</tbody>
            </table>
          </div>
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
