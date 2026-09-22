import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload, apiUrl, ApiError } from "../api.js";
import { useAuth } from "../auth.jsx";

function CommercePanel({ onSaved, onError }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setSt(await api("/config/catalog-commerce"));
  }

  useEffect(() => {
    refresh().catch((e) => onError(e.message));
  }, []);

  async function save(patch) {
    setBusy(true);
    onError("");
    onSaved("");
    try {
      const next = await api("/config/catalog-commerce", { method: "PUT", body: { ...st, ...patch } });
      setSt(next);
      onSaved(next.mode === "full"
        ? "Modo completo: el cliente puede crear cuenta y pedir cotización en el catálogo."
        : "Modo promoción: el catálogo se publica y el interés va por WhatsApp. El comercial genera enlaces temporizados.");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!st) return <div className="panel" style={{ marginBottom: 18 }}><h3>Modo del catálogo</h3><p className="section-sub">Cargando…</p></div>;

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3>Modo del catálogo público</h3>
      <p className="section-sub">
        Mientras afinamos la cotización en línea, publica el stock y atiende por WhatsApp. Cuando esté listo, activa el modo completo.
      </p>
      <div className="tile-row" style={{ margin: "12px 0" }}>
        <div className="tile">
          <div className="v">{st.mode === "full" ? "COMPLETO" : "WHATSAPP"}</div>
          <div className="l">Modo actual</div>
        </div>
        <div className="tile">
          <div className="v">{st.quotesEnabled ? "Sí" : "No"}</div>
          <div className="l">Cotización de clientes</div>
        </div>
        <div className="tile">
          <div className="v">{st.accountsEnabled ? "Sí" : "No"}</div>
          <div className="l">Crear cuentas</div>
        </div>
      </div>
      <div className="form-grid">
        <div>
          <label>WhatsApp de respaldo (catálogo sin enlace)</label>
          <input value={st.whatsapp || ""} onChange={(e) => setSt({ ...st, whatsapp: e.target.value })} placeholder="51 9XX XXX XXX" />
        </div>
        <div>
          <label>Nombre del coordinador</label>
          <input value={st.coordinatorName || ""} onChange={(e) => setSt({ ...st, coordinatorName: e.target.value })} placeholder="Ventas ZGROUP" />
        </div>
      </div>
      <div className="action-row">
        <button className="btn-primary" type="button" disabled={busy} onClick={() => save({ mode: "whatsapp" })}>
          Modo promoción (WhatsApp)
        </button>
        <button className="btn-ghost" type="button" disabled={busy} onClick={() => save({ mode: "full" })}>
          Modo completo (cotización + cuentas)
        </button>
        <button className="btn-ghost" type="button" disabled={busy} onClick={() => save({})}>
          Guardar número
        </button>
      </div>
    </div>
  );
}

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

function EvaluationPanel({ onSaved, onError }) {
  const [concepts, setConcepts] = useState([]);
  const [levels, setLevels] = useState([]);
  const [conceptLabel, setConceptLabel] = useState("");
  const [levelLabel, setLevelLabel] = useState("");
  const [levelColor, setLevelColor] = useState("#5c6370");

  async function load() {
    const d = await api("/config/evaluation");
    setConcepts(d.concepts || []);
    setLevels(d.levels || []);
  }

  useEffect(() => {
    load().catch((e) => onError(e.message));
  }, []);

  async function saveConcept(row, patch) {
    onError("");
    try {
      await api(`/config/evaluation/concepts/${row.id}`, { method: "PUT", body: patch });
      await load();
      onSaved("Concepto de evaluación actualizado.");
    } catch (e) {
      onError(e.message);
    }
  }

  async function saveLevel(row, patch) {
    onError("");
    try {
      await api(`/config/evaluation/levels/${row.id}`, { method: "PUT", body: patch });
      await load();
      onSaved("Nivel de evaluación actualizado.");
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3>Evaluación de unidades</h3>
      <p className="section-sub">Conceptos (piso, techo, y los que agregues) y niveles (excelente, bueno, pésimo…). Patio y recepción usan este catálogo.</p>
      <div className="tablewrap">
        <table className="data">
          <thead><tr><th>Concepto</th><th>Orden</th><th></th></tr></thead>
          <tbody>
            {concepts.filter((c) => !c.archivedAt).map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    defaultValue={c.label}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== c.label) saveConcept(c, { label: e.target.value }); }}
                  />
                  {c.system ? <span className="recv-who">sistema</span> : null}
                </td>
                <td>
                  <input
                    type="number"
                    defaultValue={c.sortOrder}
                    style={{ width: 70 }}
                    onBlur={(e) => saveConcept(c, { sortOrder: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button className="btn-ghost" type="button" onClick={() => saveConcept(c, { active: !c.active })}>
                    {c.active ? "Ocultar" : "Mostrar"}
                  </button>
                  {!c.system ? (
                    <button className="btn-ghost" type="button" onClick={() => saveConcept(c, { archived: true })}>Archivar</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <div><label>Nuevo concepto</label><input value={conceptLabel} onChange={(e) => setConceptLabel(e.target.value)} placeholder="Ej. Sellos" /></div>
      </div>
      <button
        className="btn-primary"
        type="button"
        style={{ marginTop: 8 }}
        onClick={async () => {
          onError("");
          try {
            await api("/config/evaluation/concepts", { method: "POST", body: { label: conceptLabel } });
            setConceptLabel("");
            await load();
            onSaved("Concepto agregado.");
          } catch (e) {
            onError(e.message);
          }
        }}
      >
        Agregar concepto
      </button>

      <h4 style={{ marginTop: 22 }}>Niveles</h4>
      <div className="tablewrap">
        <table className="data">
          <thead><tr><th>Nivel</th><th>Color</th><th>Orden</th><th></th></tr></thead>
          <tbody>
            {levels.filter((l) => !l.archivedAt).map((l) => (
              <tr key={l.id}>
                <td>
                  <input
                    defaultValue={l.label}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== l.label) saveLevel(l, { label: e.target.value }); }}
                  />
                  {l.system ? <span className="recv-who">sistema</span> : null}
                </td>
                <td>
                  <input
                    type="color"
                    defaultValue={l.color || "#5c6370"}
                    onBlur={(e) => saveLevel(l, { color: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    defaultValue={l.sortOrder}
                    style={{ width: 70 }}
                    onBlur={(e) => saveLevel(l, { sortOrder: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button className="btn-ghost" type="button" onClick={() => saveLevel(l, { active: !l.active })}>
                    {l.active ? "Ocultar" : "Mostrar"}
                  </button>
                  {!l.system ? (
                    <button className="btn-ghost" type="button" onClick={() => saveLevel(l, { archived: true })}>Archivar</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <div><label>Nuevo nivel</label><input value={levelLabel} onChange={(e) => setLevelLabel(e.target.value)} placeholder="Ej. Péssimo" /></div>
        <div><label>Color</label><input type="color" value={levelColor} onChange={(e) => setLevelColor(e.target.value)} /></div>
      </div>
      <button
        className="btn-primary"
        type="button"
        style={{ marginTop: 8 }}
        onClick={async () => {
          onError("");
          try {
            await api("/config/evaluation/levels", { method: "POST", body: { label: levelLabel, color: levelColor } });
            setLevelLabel("");
            await load();
            onSaved("Nivel agregado.");
          } catch (e) {
            onError(e.message);
          }
        }}
      >
        Agregar nivel
      </button>
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
  const [dryRef, setDryRef] = useState({ amount: "", windowMonths: 24, computed: null, effective: null, sample: 0, buckets: [] });
  const [services, setServices] = useState([]);
  const [overlays, setOverlays] = useState([]);
  const [overlayMeta, setOverlayMeta] = useState({ warehouses: [], vendors: [] });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const isSuper = user?.role === "superadmin";

  useEffect(() => {
    if (isSuper) {
      api("/config/sections").then(setData).catch((e) => setError(e.message));
    }
    api("/config/yard-columns").then(setRules).catch(() => {});
    api("/config/visibility").then(setVis).catch(() => {});
    api("/config/pricing").then(setPricing).catch(() => {});
    api("/config/acquisition-refs").then((d) => {
      setRefs(d.refs || []);
      setRefMeta({ types: d.types || [], categories: d.categories || [] });
    }).catch(() => {});
    api("/config/dry-referential").then((d) => {
      setDryRef({
        amount: d.amount ?? "",
        windowMonths: d.windowMonths || 24,
        computed: d.computed,
        effective: d.effective,
        sample: d.sample || 0,
        buckets: d.buckets || [],
      });
    }).catch(() => {});
    api("/config/commercial-services").then(setServices).catch(() => {});
    api("/config/acquisition-overlays").then((d) => {
      setOverlays(d.concepts || []);
      setOverlayMeta({ warehouses: d.warehouses || [], vendors: d.vendors || [] });
    }).catch(() => {});
  }, [isSuper]);

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

  async function saveDryRef() {
    setSaved("");
    try {
      const out = await api("/config/dry-referential", {
        method: "PUT",
        body: {
          amount: dryRef.amount === "" || dryRef.amount == null ? null : Number(dryRef.amount),
          windowMonths: Number(dryRef.windowMonths) || 24,
        },
      });
      setDryRef({
        amount: out.amount ?? "",
        windowMonths: out.windowMonths || 24,
        computed: out.computed,
        effective: out.effective,
        sample: out.sample || 0,
        buckets: out.buckets || [],
      });
      setSaved("✓ Referencial DRY guardado. Cubetas por tipo/plaza; el monto admin solo pisa el fallback global.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveOverlays() {
    setSaved("");
    try {
      const out = await api("/config/acquisition-overlays", { method: "PUT", body: { concepts: overlays } });
      setOverlays(out.concepts || []);
      setOverlayMeta({ warehouses: out.warehouses || [], vendors: out.vendors || [] });
      setSaved(`✓ Extras de costo guardados. Se recalcularon ${out.recalculated ?? 0} listas (no manuales).`);
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
      <p className="section-sub">{isSuper ? "Textos públicos, marca de agua, modo demo y anclas de desarrollo." : (data?.note || "Solo Administrador y Gerente.")}</p>
      {error ? <div className="err">{error}</div> : null}
      {saved ? <div className="ok-msg">{saved}</div> : null}

      {isSuper ? <CommercePanel onSaved={setSaved} onError={setError} /> : null}
      {isSuper ? <WatermarkPanel onSaved={setSaved} onError={setError} /> : null}

      {isSuper ? (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Textos del catálogo público</h3>
          <p className="section-sub">Titular, carrusel, pasos, botones, pie y legales. Editas a la izquierda y ves a la derecha cómo lo ve el cliente.</p>
          <Link className="btn-primary" to="/app/catalogo-textos">Abrir editor</Link>
        </div>
      ) : null}

      {isSuper ? <DemoPanel /> : null}

      {(user?.role === "admin" || isSuper) ? <DepotConceptsPanel onSaved={setSaved} onError={setError} /> : null}
      {(user?.role === "admin" || user?.role === "gerente" || isSuper) ? <EvaluationPanel onSaved={setSaved} onError={setError} /> : null}

      <>
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
        <h3>Extras de costo (almacén Odoo / proveedor)</h3>
        <p className="section-sub">
          Se suman a la OC o al referencial para armar la base. No pisan el costo Odoo. ZGROU y Piura son plazas de existencias;
          el patio fino (Principal / Gambeta) lo elige el coordinador y no cambia este extra.
        </p>
        {overlays.map((r, i) => (
          <div className="form-grid" key={r.id || i}>
            <div>
              <label>Concepto</label>
              <input value={r.label} onChange={(e) => setOverlays(overlays.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
            </div>
            <div>
              <label>Ámbito</label>
              <select value={r.scope} onChange={(e) => setOverlays(overlays.map((x, j) => j === i ? { ...x, scope: e.target.value, target: "" } : x))}>
                <option value="warehouse">Almacén Odoo</option>
                <option value="vendor">Proveedor OC</option>
              </select>
            </div>
            <div>
              <label>Destino</label>
              {r.scope === "vendor" ? (
                <input
                  list="odoo-vendors"
                  value={r.target || ""}
                  onChange={(e) => setOverlays(overlays.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}
                  placeholder="Razón social Odoo"
                />
              ) : (
                <select value={r.target || ""} onChange={(e) => setOverlays(overlays.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}>
                  <option value="">Elegir…</option>
                  {(overlayMeta.warehouses || []).map((w) => (
                    <option key={w.code} value={w.code}>{w.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label>USD</label>
              <input type="number" min="0" step="1" value={r.amount} onChange={(e) => setOverlays(overlays.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
            </div>
            <div>
              <label>Aplica a</label>
              <select value={r.applies || "all"} onChange={(e) => setOverlays(overlays.map((x, j) => j === i ? { ...x, applies: e.target.value } : x))}>
                <option value="all">OC y referencial</option>
                <option value="oc">Solo OC</option>
                <option value="referential">Solo referencial</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button className="btn-ghost" type="button" onClick={() => setOverlays(overlays.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          </div>
        ))}
        <datalist id="odoo-vendors">
          {(overlayMeta.vendors || []).map((v) => <option key={v} value={v} />)}
        </datalist>
        <div className="action-row">
          <button
            className="btn-ghost"
            type="button"
            onClick={() => setOverlays([...overlays, { label: "Traslado Piura", scope: "warehouse", target: "PIURA", amount: 0, applies: "all", active: true }])}
          >
            Añadir extra
          </button>
          <button className="btn-primary" type="button" onClick={saveOverlays}>Guardar extras y recalcular listas</button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Precio referencial DRY (ajustes de inventario)</h3>
        <p className="section-sub">
          Un ajuste o una MO sin costo usa el promedio de OC del mismo tipo, uso (nuevo/segundo uso) y plaza Odoo.
          Si ese tipo no tiene ninguna OC, cae al promedio general
          {dryRef.effective != null ? ` (USD ${Number(dryRef.effective).toLocaleString("en-US")}` : " (sin dato aún"}
          {dryRef.sample ? ` · ${dryRef.sample} lote(s)` : ""}).
          El monto admin solo pisa ese fallback global; no mezcla 20 con 40 ni Principal con Gambeta.
        </p>
        <div className="form-grid">
          <div>
            <label>Fallback global USD (opcional)</label>
            <input
              type="number"
              min="0"
              placeholder={dryRef.computed != null ? String(dryRef.computed) : "Promedio general"}
              value={dryRef.amount}
              onChange={(e) => setDryRef({ ...dryRef, amount: e.target.value })}
            />
          </div>
          <div>
            <label>Ventana (meses)</label>
            <input
              type="number"
              min="1"
              max="120"
              value={dryRef.windowMonths}
              onChange={(e) => setDryRef({ ...dryRef, windowMonths: e.target.value })}
            />
          </div>
        </div>
        {dryRef.buckets?.length ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Cubeta</th>
                  <th>Tipo</th>
                  <th>Uso</th>
                  <th>Plaza</th>
                  <th>SKU</th>
                  <th>n</th>
                  <th>Promedio USD</th>
                </tr>
              </thead>
              <tbody>
                {dryRef.buckets
                  .filter((b) => b.kind === "typeUsageWh" || b.kind === "typeUsage" || b.kind === "typeWh" || b.kind === "type")
                  .sort((a, b) => `${a.kind}${a.type}${a.warehouse}${a.usage}`.localeCompare(`${b.kind}${b.type}${b.warehouse}${b.usage}`))
                  .map((b) => (
                    <tr key={`${b.kind}-${b.type}-${b.usage}-${b.warehouse}-${b.productCode}`}>
                      <td>{b.kind === "typeUsageWh" ? "tipo · uso · plaza" : b.kind === "typeUsage" ? "tipo · uso" : b.kind === "typeWh" ? "tipo · plaza" : "tipo"}</td>
                      <td>{b.type || "—"}</td>
                      <td>{b.usage || "—"}</td>
                      <td>{b.warehouse || "—"}</td>
                      <td>{b.productCode || "—"}</td>
                      <td>{b.sample}</td>
                      <td>{Number(b.average).toLocaleString("en-US")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="section-sub">Aún no hay cubetas. Busca en Odoo para promediar OC por tipo.</p>
        )}
        <div className="action-row">
          <button className="btn-primary" type="button" onClick={saveDryRef}>Guardar referencial DRY</button>
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
      </>
      {isSuper ? (
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
      ) : null}
    </>
  );
}
