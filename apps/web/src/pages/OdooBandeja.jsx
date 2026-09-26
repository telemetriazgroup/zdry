import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiBlob } from "../api.js";
import { useAuth } from "../auth.jsx";
import { costLabel, originBadge } from "../odoo-origin.js";
import OdooLotFicha, { SyncIcon } from "./OdooLotFicha.jsx";

const PAGE_SIZE = 20;

function searchable(r) {
  return [r.isoNormalized, r.serialRaw, r.productCode, r.productName, r.locationName, r.dua, r.odooMoName, r.odooSourceProductCode]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function canPick(r) {
  return (r.status === "pending" || r.status === "qty_anomaly") && r.iso6346Ok;
}

function IconBtn({ title, onClick, disabled, danger, children }) {
  return (
    <button
      type="button"
      className={`icon-btn ${danger ? "danger" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function OdooBandeja() {
  const { user } = useAuth();
  const canProbe = user?.role === "superadmin" || user?.role === "admin";
  const canReset = canProbe;
  const [rows, setRows] = useState([]);
  const [probe, setProbe] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState({});
  const [onlyReview, setOnlyReview] = useState(false);
  const [originFilter, setOriginFilter] = useState("");
  const [referential, setReferential] = useState(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [resetOn, setResetOn] = useState(false);
  const [resetText, setResetText] = useState("");
  const [resyncOn, setResyncOn] = useState(false);
  const [resyncText, setResyncText] = useState("");
  const [progress, setProgress] = useState(null);
  const [diary, setDiary] = useState({ runs: [], current: null, entries: [], total: 0, take: 5 });
  const [logLevel, setLogLevel] = useState("all");
  const [logTake, setLogTake] = useState(5);
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [openLogId, setOpenLogId] = useState("");
  const [watch, setWatch] = useState({ mode: "manual", lastRunAt: null, lastMessage: "", lastNew: 0, lastAssimilated: 0 });
  const [expediente, setExpediente] = useState({ status: "idle", current: 0, total: 0, left: 0, message: "" });
  const [departed, setDeparted] = useState([]);

  async function load() {
    const list = await api("/odoo-import/candidates");
    setRows(Array.isArray(list) ? list : []);
    api("/odoo-import/referential").then(setReferential).catch(() => {});
  }

  async function loadLog(runId, take) {
    const q = new URLSearchParams();
    if (runId) q.set("runId", runId);
    if (logLevel && logLevel !== "all") q.set("level", logLevel);
    if (logFrom) q.set("from", logFrom);
    if (logTo) q.set("to", logTo);
    q.set("take", String(take || logTake || 5));
    const out = await api(`/odoo-import/log?${q}`);
    setDiary(out || { runs: [], current: null, entries: [], total: 0, take: 5 });
    return out;
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    loadLog().catch(() => {});
    api("/odoo-import/watch").then((w) => { if (w?.mode) setWatch(w); }).catch(() => {});
    api("/warehouse/at-customer").then((rows) => setDeparted(Array.isArray(rows) ? rows : [])).catch(() => {});
    api("/odoo-import/expedientes/status").then((p) => { if (p?.status) setExpediente(p); }).catch(() => {});
    if (canProbe) {
      api("/odoo-import/probe").then(setProbe).catch(() => {});
    }
  }, [canProbe]);

  useEffect(() => {
    loadLog().catch(() => {});
  }, [logLevel, logTake, logFrom, logTo]);

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase().replace(/[\s-]/g, "");
    return rows.filter((r) => {
      if (onlyReview && r.iso6346Ok) return false;
      if (originFilter && (r.odooIntakeKind || (r.odooPoName ? "purchase" : "unknown")) !== originFilter) return false;
      if (!needle) return true;
      return searchable(r).replace(/[\s-]/g, "").includes(needle) || searchable(r).includes(q.trim().toUpperCase());
    });
  }, [rows, onlyReview, originFilter, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pickable = filtered.filter(canPick);
  const selectedIds = pickable.filter((r) => sel[r.id]).map((r) => r.id);
  const allPickableSelected = pickable.length > 0 && pickable.every((r) => sel[r.id]);

  useEffect(() => {
    setPage(1);
  }, [q, onlyReview, originFilter]);

  useEffect(() => {
    if (busy !== "Buscando en Odoo" && busy !== "Asimilando" && busy !== "Sincronizando") return undefined;
    let stop = false;
    const tick = () => {
      api("/odoo-import/progress")
        .then((p) => { if (!stop) setProgress(p); })
        .catch(() => {});
      loadLog().catch(() => {});
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [busy, logLevel]);

  useEffect(() => {
    if (watch.mode !== "auto") return undefined;
    const tick = () => {
      api("/odoo-import/watch").then((w) => { if (w?.mode) setWatch(w); }).catch(() => {});
      api("/odoo-import/progress").then(setProgress).catch(() => {});
      loadLog().catch(() => {});
      load().catch(() => {});
      api("/odoo-import/expedientes/status").then((p) => { if (p?.status) setExpediente(p); }).catch(() => {});
      api("/warehouse/at-customer").then((rows) => setDeparted(Array.isArray(rows) ? rows : [])).catch(() => {});
    };
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [watch.mode, logLevel, logTake, logFrom, logTo]);

  async function refreshExpedientes() {
    setBusy("Actualizando expedientes");
    setError("");
    setMsg("");
    try {
      const out = await api("/odoo-import/expedientes/refresh", { method: "POST" });
      if (!out?.running) {
        setError(out?.message || "No se inició la actualización.");
        return;
      }
      for (let i = 0; i < 3600; i += 1) {
        const p = await api("/odoo-import/expedientes/status");
        setExpediente(p);
        if (!p || p.status !== "running") {
          if (p?.status === "error") setError(p.message || "No se pudieron actualizar los expedientes.");
          else setMsg(p?.message || out.message || "Expedientes al día.");
          api("/warehouse/at-customer").then((rows) => setDeparted(Array.isArray(rows) ? rows : [])).catch(() => {});
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function setWatchMode(mode) {
    setError("");
    try {
      const next = await api("/odoo-import/watch", { method: "PUT", body: { mode } });
      setWatch(next);
      setMsg(mode === "auto"
        ? "Cada 5 minutos se buscan equipos nuevos y se actualizan los expedientes. Una salida a cliente queda en Equipos con salida y en Venta / en cliente."
        : "Búsqueda automática apagada. Buscar en Odoo y Actualizar expedientes siguen siendo manuales.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function waitForPass() {
    for (let i = 0; i < 1800; i += 1) {
      const p = await api("/odoo-import/progress").catch(() => null);
      if (p) setProgress(p);
      await loadLog(p?.runId).catch(() => {});
      if (!p || p.status === "done" || p.status === "error" || p.status === "idle" || p.status === "cancelled") return p;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  async function run(label, fn) {
    setBusy(label);
    setError("");
    setMsg("");
    if (label === "Buscando en Odoo" || label === "Asimilando" || label === "Sincronizando") setLogTake(5);
    try {
      const out = await fn();
      let p = null;
      if (out?.running || label === "Buscando en Odoo" || label === "Asimilando" || label === "Sincronizando") {
        p = await waitForPass();
        if (p?.status === "error") setError(p.message || "La pasada terminó con error. Revisa el diario.");
        else setMsg(p?.message || out?.message || "Listo.");
      } else {
        const n = out?.items?.length;
        setMsg(n != null ? `Listo. ${n} unidad(es) procesada(s).` : out?.message || "Listo.");
      }
      await load();
      const cancelled = p?.status === "idle" || p?.status === "cancelled";
      await loadLog(cancelled ? undefined : out?.runId).catch(() => {});
      setSel({});
      return out;
    } catch (e) {
      setError(e.message);
      await loadLog().catch(() => {});
      return null;
    } finally {
      setBusy("");
    }
  }

  function toggleSelectAll() {
    if (allPickableSelected) {
      setSel({});
      return;
    }
    const next = {};
    for (const r of pickable) next[r.id] = true;
    setSel(next);
  }

  if (openId) {
    return (
      <OdooLotFicha
        id={openId}
        busy={busy}
        onClose={() => { setOpenId(null); load().catch((e) => setError(e.message)); }}
        onSaved={() => load().catch(() => {})}
        onAssimilated={(id) => run("Asimilando", () => api("/odoo-import/assimilate", { method: "POST", body: { ids: [id] } })).then(() => setOpenId(null))}
      />
    );
  }

  return (
    <>
      <h2 className="section-title">Odoo — regularizar DRY</h2>
      <p className="section-sub">
        El puente J2 aplica cambios de Odoo solos (tara, IN, OC). «Buscar en Odoo» es un <b>forzar</b> completo.
        Clasifica si entraron por <b>ajuste</b>, <b>OC/IN</b> o <b>fabricación (MO)</b>.
        Un ajuste o una MO no inventa factura; usa el promedio de OC del mismo tipo/plaza.
        Si el tipo no tiene OC, cae al promedio general
        {referential?.effective != null ? ` (USD ${Number(referential.effective).toLocaleString("en-US")})` : ""}.
      </p>
      {probe && !probe.ok ? <div className="err">{probe.message}</div> : null}
      {probe?.ok ? <div className="ok-msg">Odoo conectado{probe.user?.name ? ` · ${probe.user.name}` : ""}.</div> : null}
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {busy ? <div className="warn-inline">{busy}…</div> : null}
      {diary.current ? (
        <div className="odoo-log">
          <div className="odoo-log-head">
            <div>
              <b>Diario de asimilación</b>
              <div className="section-sub">
                {diary.current.kind === "sync" ? "Buscar en Odoo" : diary.current.kind === "watch" ? "Búsqueda automática" : diary.current.kind === "reset" ? "Reinicio" : "Asimilar a Recepción"}
                {" · "}
                {diary.current.status === "running"
                  ? "en curso"
                  : diary.current.status === "error"
                    ? "con errores"
                    : diary.current.status === "cancelled"
                      ? "cancelada"
                      : "terminada"}
                {" · "}
                {diary.current.okCount} ok · {diary.current.errorCount} error · {diary.current.skipCount} omitido
                {diary.current.startedBy ? ` · ${diary.current.startedBy}` : ""}
              </div>
            </div>
            <div className="odoo-log-filters">
              <label className="odoo-filter">
                Desde
                <input type="date" value={logFrom} onChange={(e) => setLogFrom(e.target.value)} style={{ marginLeft: 6 }} />
              </label>
              <label className="odoo-filter">
                Hasta
                <input type="date" value={logTo} onChange={(e) => setLogTo(e.target.value)} style={{ marginLeft: 6 }} />
              </label>
              <label className="odoo-filter">
                Ver
                <select value={logLevel} onChange={(e) => setLogLevel(e.target.value)} style={{ marginLeft: 6 }}>
                  <option value="all">Todo</option>
                  <option value="error">Solo errores</option>
                  <option value="ok">Solo ok</option>
                  <option value="warn">Omitidos</option>
                </select>
              </label>
              <button
                className="btn-ghost"
                type="button"
                onClick={async () => {
                  const q = new URLSearchParams();
                  if (logLevel && logLevel !== "all") q.set("level", logLevel);
                  if (logFrom) q.set("from", logFrom);
                  if (logTo) q.set("to", logTo);
                  if (diary.current?.id && !logFrom && !logTo) q.set("runId", diary.current.id);
                  const blob = await apiBlob(`/odoo-import/log/export?${q}`);
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `diario-asimilacion${logFrom || logTo ? `-${logFrom || "inicio"}_${logTo || "hoy"}` : ""}.csv`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Descargar
              </button>
            </div>
          </div>
          {diary.current.message ? <p className="section-sub">{diary.current.message}</p> : null}
          <p className="section-sub">Últimas {diary.entries?.length || 0} de {diary.total || 0} líneas. La lista de lotes está debajo.</p>
          <div className="tablewrap">
            <table className="data odoo-log-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Nivel</th>
                  <th>Paso</th>
                  <th>Serie</th>
                  <th>Producto</th>
                  <th>Qué pasó</th>
                </tr>
              </thead>
              <tbody>
                {(diary.entries || []).map((e) => (
                  <tr key={e.id} className={e.level === "error" ? "iso-review-row" : ""}>
                    <td>{new Date(e.createdAt).toLocaleTimeString("es-PE")}</td>
                    <td>
                      <span className="badge-scope" style={{ background: e.level === "error" ? "#c92a2a" : e.level === "warn" ? "#e8590c" : e.level === "ok" ? "#2f9e44" : "#495057" }}>
                        {e.level}
                      </span>
                    </td>
                    <td>{e.step}</td>
                    <td>
                      <b className="card-iso">{e.iso || e.serialRaw || "—"}</b>
                      {e.odooLotId ? <div className="muted">lote {e.odooLotId}</div> : null}
                    </td>
                    <td>{e.product || "—"}</td>
                    <td>
                      <button type="button" className="odoo-open" onClick={() => setOpenLogId(openLogId === e.id ? "" : e.id)}>
                        {e.message}
                      </button>
                      {openLogId === e.id && e.detail ? (
                        <pre className="odoo-log-detail">{e.detail}</pre>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!diary.entries?.length ? <p className="section-sub">Aún no hay líneas en esta pasada.</p> : null}
          {(diary.total || 0) > (diary.entries?.length || 0) ? (
            <div className="action-row" style={{ marginTop: 8 }}>
              <button className="btn-ghost" type="button" onClick={() => setLogTake((n) => n + 20)}>
                Ver más ({diary.total - (diary.entries?.length || 0)} restantes)
              </button>
            </div>
          ) : logTake > 5 ? (
            <div className="action-row" style={{ marginTop: 8 }}>
              <button className="btn-ghost" type="button" onClick={() => setLogTake(5)}>Ver menos</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {progress && (busy === "Buscando en Odoo" || busy === "Asimilando" || busy === "Sincronizando" || progress.status === "running") ? (
        <div className="odoo-progress">
          <div className="odoo-progress-msg">
            {busy || "Progreso"} · {progress.step || "…"}
            {progress.iso ? ` · ${progress.iso}` : ""}
            {progress.total ? ` · ${progress.current || 0}/${progress.total}` : ""}
          </div>
          <div className="odoo-progress-bar" aria-valuemin={0} aria-valuemax={progress.total || 5} aria-valuenow={progress.current || 0}>
            <i style={{ width: `${Math.min(100, ((progress.current || 0) / (progress.total || 5)) * 100)}%` }} />
          </div>
          <div className="section-sub">{progress.message || "Un pase de Odoo a la copia local."}</div>
        </div>
      ) : null}

      <div className="odoo-watch">
        <b>Equipos nuevos</b>
        <div className="action-row">
          <button className={watch.mode === "manual" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setWatchMode("manual")}>Manual</button>
          <button className={watch.mode === "auto" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setWatchMode("auto")}>Cada 5 minutos</button>
        </div>
        <p className="section-sub">
          {watch.mode === "auto"
            ? "Cada 5 minutos asimila equipos nuevos y, al terminar, actualiza el expediente de los ya asimilados. Si detecta una salida a cliente, el equipo pasa a Equipos con salida y a Recepción · Venta / en cliente."
            : "Como ahora: el stock y los expedientes se recorren solo cuando pulsas Buscar en Odoo o Actualizar expedientes."}
          {watch.lastRunAt ? ` Última revisión: ${new Date(watch.lastRunAt).toLocaleString("es-PE")}. ${watch.lastMessage || ""}` : ""}
        </p>
      </div>

      <div className="odoo-watch">
        <b>Expediente por serie</b>
        <div className="action-row">
          <button className="btn-primary" type="button" disabled={!!busy || progress?.status === "running"} onClick={refreshExpedientes}>
            Actualizar expedientes
          </button>
        </div>
        <p className="section-sub">
          Recorre las series ya asimiladas y deja en cada expediente solo lo de esa serie: su ingreso, salida, venta, reparación y traslados.
          No borra unidades ni las vuelve a asimilar. Si detecta una salida hecha a cliente, la unidad sale de recepción y del catálogo.
        </p>
        <div className="odoo-watch" style={{ marginTop: 12 }}>
          <b>Equipos con salida ({departed.length})</b>
          <p className="section-sub">
            Series asimiladas cuyo último movimiento en Odoo es una salida a cliente. También están en Recepción, pestaña Venta / en cliente.
          </p>
          {departed.length ? (
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ISO</th>
                    <th>Tipo</th>
                    <th>Depósito</th>
                    <th>Por qué</th>
                  </tr>
                </thead>
                <tbody>
                  {departed.slice(0, 40).map((u) => (
                    <tr key={u.iso}>
                      <td className="card-iso">{u.iso}</td>
                      <td>{u.typeLabel || u.type}</td>
                      <td>{u.depotName || "—"}</td>
                      <td>Salida a cliente. Fuera de pendientes y del catálogo.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="section-sub">Todavía no hay equipos con salida detectada.</p>
          )}
          {departed.length > 40 ? <p className="section-sub">Se muestran 40 de {departed.length}. El resto está en Recepción · Venta / en cliente.</p> : null}
        </div>
        {expediente.status === "running" || expediente.message ? (
          <div className="odoo-progress">
            <div className="odoo-progress-msg">
              {expediente.status === "running" ? "Actualizando expedientes" : "Expedientes"}
              {expediente.total ? ` · ${expediente.current || 0}/${expediente.total}` : ""}
              {expediente.left ? ` · ${expediente.left} con salida` : ""}
            </div>
            {expediente.total ? (
              <div className="odoo-progress-bar" aria-valuemin={0} aria-valuemax={expediente.total} aria-valuenow={expediente.current || 0}>
                <i style={{ width: `${Math.min(100, ((expediente.current || 0) / expediente.total) * 100)}%` }} />
              </div>
            ) : null}
            <div className="section-sub">{expediente.message}</div>
          </div>
        ) : null}
      </div>

      <div className="odoo-toolbar">
        <input
          className="odoo-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar código, producto, DUA o almacén…"
          aria-label="Buscar lote"
        />
        <button
          className="btn-primary"
          type="button"
          disabled={!!busy}
          onClick={() => run("Buscando en Odoo", () => api("/odoo-import/sync", { method: "POST" }))}
        >
          Buscar en Odoo
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={!!busy}
          onClick={() => run("Leyendo eventos", () => api("/odoo-import/events/poll", { method: "POST" }))}
        >
          Leer eventos
        </button>
        <button className="btn-ghost" type="button" disabled={!!busy || !pickable.length} onClick={toggleSelectAll}>
          {allPickableSelected ? "Quitar selección" : `Seleccionar todo (${pickable.length}, excepto por revisar)`}
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={!!busy || !selectedIds.length}
          onClick={() => run("Asimilando", () => api("/odoo-import/assimilate", { method: "POST", body: { ids: selectedIds } }))}
        >
          Asimilar seleccionados ({selectedIds.length})
        </button>
        <label className="odoo-filter">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
          Solo por revisar
        </label>
        <label className="odoo-filter">
          Origen
          <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)} style={{ marginLeft: 6 }}>
            <option value="">Todos</option>
            <option value="adjustment">Ajuste</option>
            <option value="purchase">OC / IN</option>
            <option value="fabrication">Fabricación</option>
            <option value="unknown">Sin origen</option>
          </select>
        </label>
        {canReset ? (
          <>
            <button className="btn-ghost" type="button" disabled={busy === "Reiniciando" || busy === "Sincronizando"} onClick={() => { setResyncOn((v) => !v); setResyncText(""); setResetOn(false); }}>
              Re-sincronizar asimilados
            </button>
            <button className="btn-ghost" type="button" disabled={busy === "Reiniciando"} onClick={() => { setResetOn((v) => !v); setResetText(""); setResyncOn(false); }}>
              Reiniciar módulo
            </button>
          </>
        ) : null}
        <Link className="btn-ghost" to="/app/almacen/recepcion">Ir a Recepción</Link>
      </div>

      {resyncOn ? (
        <div className="odoo-resync">
          <b>Quitar solo lo asimilado y sincronizar</b>
          <p className="section-sub">
            Borra las unidades asimiladas desde Odoo (no vendidas) y sus candidatos. Conserva ventas y reentregas
            manuales. Luego lanza Buscar en Odoo. Escribe SINCRONIZAR.
          </p>
          <div className="action-row">
            <input value={resyncText} onChange={(e) => setResyncText(e.target.value)} placeholder="SINCRONIZAR" />
            <button
              className="btn-primary"
              type="button"
              disabled={!!busy || resyncText.trim().toUpperCase() !== "SINCRONIZAR"}
              onClick={() =>
                run("Sincronizando", () => api("/odoo-import/resync", { method: "POST", body: { confirm: "SINCRONIZAR" } })).then((out) => {
                  if (out) {
                    setResyncOn(false);
                    setResyncText("");
                  }
                })
              }
            >
              Borrar asimilados y buscar
            </button>
          </div>
        </div>
      ) : null}

      {resetOn ? (
        <div className="odoo-reset">
          <b>Reiniciar módulo de asimilación</b>
          <p className="section-sub">
            Cancela la búsqueda en curso, cierra esa pasada en el diario y vacía candidatos / unidades Odoo no vendidas.
            El diario queda listo para una pasada nueva (el historial se puede descargar por fecha). Escribe REINICIAR.
          </p>
          <div className="action-row">
            <input value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="REINICIAR" />
            <button
              className="btn-primary"
              type="button"
              disabled={busy === "Reiniciando" || resetText.trim().toUpperCase() !== "REINICIAR"}
              onClick={async () => {
                setBusy("Reiniciando");
                setError("");
                setMsg("");
                try {
                  const out = await api("/odoo-import/reset", { method: "POST", body: { confirm: "REINICIAR" } });
                  setProgress({ status: "idle", step: "", message: out.message });
                  setLogTake(5);
                  setSel({});
                  await load();
                  await loadLog(out.runId);
                  setMsg(out.message || "Búsqueda cancelada. Módulo vaciado.");
                  setResetOn(false);
                  setResetText("");
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy("");
                }
              }}
            >
              Cancelar búsqueda y vaciar
            </button>
          </div>
        </div>
      ) : null}

      <p className="section-sub">
        {filtered.length} lote(s){q || onlyReview ? " (filtro activo)" : ""} · página {safePage} de {pages}. Toca un serial para abrir la ficha.
      </p>

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th></th>
              <th>Odoo</th>
              <th>Serial</th>
              <th>ISO 6346</th>
              <th>Origen</th>
              <th>Costo</th>
              <th>Producto</th>
              <th>Almacén</th>
              <th>Color</th>
              <th>Tara</th>
              <th>DUA</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className={!r.iso6346Ok ? "iso-review-row" : ""}>
                <td>
                  {r.status === "pending" || r.status === "qty_anomaly" ? (
                    <input
                      type="checkbox"
                      disabled={!r.iso6346Ok}
                      title={!r.iso6346Ok ? "Por revisar: no entra en seleccionar todo" : "Seleccionar"}
                      checked={!!sel[r.id]}
                      onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))}
                    />
                  ) : null}
                </td>
                <td><SyncIcon status={r.odooSyncStatus} compact /></td>
                <td>
                  <div className="odoo-code-cell">
                    <button type="button" className="odoo-open" onClick={() => setOpenId(r.id)}>
                      <b className="card-iso">{r.isoNormalized || r.serialRaw}</b>
                    </button>
                    <span className="odoo-row-icons">
                      <IconBtn title="Ver ficha" onClick={() => setOpenId(r.id)}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </IconBtn>
                      {r.status === "pending" || r.status === "qty_anomaly" ? (
                        <>
                          <IconBtn
                            title="Asimilar"
                            disabled={!!busy}
                            onClick={() => run("Asimilando", () => api("/odoo-import/assimilate", { method: "POST", body: { ids: [r.id] } }))}
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          </IconBtn>
                          <IconBtn
                            title="Ignorar"
                            danger
                            disabled={!!busy}
                            onClick={() => run("Ignorando", () => api(`/odoo-import/candidates/${r.id}/ignore`, { method: "POST" }))}
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </IconBtn>
                        </>
                      ) : null}
                    </span>
                  </div>
                  {r.serialRaw && r.serialRaw.replace(/[\s-]/g, "").toUpperCase() !== r.isoNormalized ? (
                    <div className="muted">{r.serialRaw}</div>
                  ) : null}
                </td>
                <td>
                  {r.iso6346Ok ? (
                    <span className="badge-scope" style={{ background: "#2f9e44" }}>OK</span>
                  ) : (
                    <span className="badge-scope" style={{ background: "#c92a2a" }}>Por revisar</span>
                  )}
                </td>
                <td>
                  <span className="badge-scope" style={{ background: originBadge(r).color }} title={r.odooPickingName || ""}>
                    {originBadge(r).label}
                  </span>
                </td>
                <td>{costLabel(r, referential)}</td>
                <td>{r.productCode ? `[${r.productCode}] ` : ""}{r.productName}</td>
                <td>
                  {r.odooWarehouse === "PIURA" ? "Piura" : r.odooWarehouse === "ZGROU" ? "ZGROU / Callao" : r.odooWarehouse || ""}
                  {r.locationName ? <div className="muted">{r.locationName}</div> : "—"}
                </td>
                <td>{r.color || "—"}</td>
                <td>{r.tareKg || "—"}</td>
                <td>{r.dua || "—"}</td>
                <td>{r.status === "assimilated" ? `En ZDRY · ${r.containerIso}` : r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length ? <p className="section-sub">No hay candidatos con ese filtro. Configura Odoo y pulsa Buscar.</p> : null}

      {pages > 1 ? (
        <div className="odoo-pager">
          <button className="btn-ghost" type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Anterior</button>
          <span>Página {safePage} / {pages}</span>
          <button className="btn-ghost" type="button" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Siguiente</button>
        </div>
      ) : null}
    </>
  );
}
