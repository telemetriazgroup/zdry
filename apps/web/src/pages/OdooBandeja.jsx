import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import OdooLotFicha, { SyncIcon } from "./OdooLotFicha.jsx";

const PAGE_SIZE = 20;

function searchable(r) {
  return [r.isoNormalized, r.serialRaw, r.productCode, r.productName, r.locationName, r.dua]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function canPick(r) {
  return (r.status === "pending" || r.status === "qty_anomaly") && r.iso6346Ok;
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
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [resetOn, setResetOn] = useState(false);
  const [resetText, setResetText] = useState("");

  async function load() {
    const list = await api("/odoo-import/candidates");
    setRows(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    if (canProbe) {
      api("/odoo-import/probe").then(setProbe).catch(() => {});
    }
  }, [canProbe]);

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase().replace(/[\s-]/g, "");
    return rows.filter((r) => {
      if (onlyReview && r.iso6346Ok) return false;
      if (!needle) return true;
      return searchable(r).replace(/[\s-]/g, "").includes(needle) || searchable(r).includes(q.trim().toUpperCase());
    });
  }, [rows, onlyReview, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pickable = filtered.filter(canPick);
  const selectedIds = pickable.filter((r) => sel[r.id]).map((r) => r.id);
  const allPickableSelected = pickable.length > 0 && pickable.every((r) => sel[r.id]);

  useEffect(() => {
    setPage(1);
  }, [q, onlyReview]);

  async function run(label, fn) {
    setBusy(label);
    setError("");
    setMsg("");
    try {
      const out = await fn();
      await load();
      setSel({});
      const n = out?.items?.length;
      setMsg(n != null ? `Listo. ${n} unidad(es) procesada(s).` : out?.message || "Listo.");
      return out;
    } catch (e) {
      setError(e.message);
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
        «Buscar en Odoo» baja solo lotes a la mano (existencias internas) con la ficha completa. Abre un serial para
        editar en local; Odoo se actualiza al guardar, y el sistema avisa si quedó en vivo o hubo un error.
      </p>
      {probe && !probe.ok ? <div className="err">{probe.message}</div> : null}
      {probe?.ok ? <div className="ok-msg">Odoo conectado{probe.user?.name ? ` · ${probe.user.name}` : ""}.</div> : null}
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {busy ? <div className="warn-inline">{busy}…</div> : null}

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
        {canReset ? (
          <button className="btn-ghost" type="button" disabled={!!busy} onClick={() => { setResetOn((v) => !v); setResetText(""); }}>
            Reiniciar módulo
          </button>
        ) : null}
        <Link className="btn-ghost" to="/app/almacen/recepcion">Ir a Recepción</Link>
      </div>

      {resetOn ? (
        <div className="odoo-reset">
          <b>Reiniciar módulo de asimilación</b>
          <p className="section-sub">
            Borra candidatos, writebacks y unidades creadas desde Odoo (no vendidas). Luego pulsa Buscar en Odoo para
            depurar de cero. Escribe REINICIAR para confirmar.
          </p>
          <div className="action-row">
            <input value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="REINICIAR" />
            <button
              className="btn-primary"
              type="button"
              disabled={!!busy || resetText.trim().toUpperCase() !== "REINICIAR"}
              onClick={() => run("Reiniciando", () => api("/odoo-import/reset", { method: "POST", body: { confirm: "REINICIAR" } })).then(() => { setResetOn(false); setResetText(""); })}
            >
              Vaciar y empezar de nuevo
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
              <th>Producto</th>
              <th>Almacén</th>
              <th>Color</th>
              <th>Tara</th>
              <th>DUA</th>
              <th>Estado</th>
              <th></th>
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
                  <button type="button" className="odoo-open" onClick={() => setOpenId(r.id)}>
                    <b className="card-iso">{r.isoNormalized || r.serialRaw}</b>
                  </button>
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
                <td>{r.productCode ? `[${r.productCode}] ` : ""}{r.productName}</td>
                <td>{r.locationName || "—"}</td>
                <td>{r.color || "—"}</td>
                <td>{r.tareKg || "—"}</td>
                <td>{r.dua || "—"}</td>
                <td>{r.status === "assimilated" ? `En ZDRY · ${r.containerIso}` : r.status}</td>
                <td>
                  <button className="btn-ghost" type="button" onClick={() => setOpenId(r.id)}>Ver ficha</button>
                  {r.status === "pending" || r.status === "qty_anomaly" ? (
                    <>
                      <button
                        className="btn-ghost"
                        type="button"
                        disabled={!!busy}
                        onClick={() => run("Asimilando", () => api("/odoo-import/assimilate", { method: "POST", body: { ids: [r.id] } }))}
                      >
                        Asimilar
                      </button>
                      <button
                        className="btn-ghost"
                        type="button"
                        disabled={!!busy}
                        onClick={() => run("Ignorando", () => api(`/odoo-import/candidates/${r.id}/ignore`, { method: "POST" }))}
                      >
                        Ignorar
                      </button>
                    </>
                  ) : null}
                </td>
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
