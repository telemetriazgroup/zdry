import { useEffect, useState } from "react";
import { api } from "../api.js";
import { downloadAuditExcel, downloadAuditPdf } from "../audit-export.js";

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

export default function AuditPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState({ rows: [], total: 0, truncated: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(nextFrom = from, nextTo = to) {
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (nextFrom) q.set("from", nextFrom);
      if (nextTo) q.set("to", nextTo);
      const out = await api(`/audit?${q.toString()}`);
      setData({
        rows: Array.isArray(out?.rows) ? out.rows : Array.isArray(out) ? out : [],
        total: out?.total ?? (Array.isArray(out) ? out.length : 0),
        truncated: !!out?.truncated,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  function onSearch(e) {
    e.preventDefault();
    if (from && to && from > to) {
      setError("La fecha inicial no puede ser mayor que la final.");
      return;
    }
    load();
  }

  const rows = data.rows || [];

  return (
    <>
      <h2 className="section-title">Auditoría</h2>
      <p className="section-sub">
        Registro append-only de logins, maestros, personas y cambios de sistema. Solo superusuario.
        Busca por rango de fechas (hora de Lima) y descarga el reporte.
      </p>
      {error ? <div className="err">{error}</div> : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <form className="form-grid" onSubmit={onSearch}>
          <div>
            <label>Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Buscando…" : "Buscar"}</button>
          </div>
        </form>
        <div className="action-row">
          <button className="btn-ghost" type="button" disabled={!rows.length} onClick={() => downloadAuditPdf(rows, from, to)}>
            Descargar PDF
          </button>
          <button className="btn-ghost" type="button" disabled={!rows.length} onClick={() => downloadAuditExcel(rows, from, to)}>
            Descargar Excel
          </button>
        </div>
        <p className="section-sub" style={{ marginTop: 10 }}>
          {data.total} evento(s) en el rango
          {data.truncated ? ` · se muestran los ${rows.length} más recientes` : ""}.
        </p>
      </div>

      <div className="panel">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>Id</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString("es-PE")}</td>
                  <td>{r.user?.email || "—"}</td>
                  <td>{r.action}</td>
                  <td>{r.entity}</td>
                  <td>{r.entityId || "—"}</td>
                  <td>{r.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && !busy ? <p className="section-sub">No hay eventos en ese rango.</p> : null}
      </div>
    </>
  );
}
