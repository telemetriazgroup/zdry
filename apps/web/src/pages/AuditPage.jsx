import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { downloadAuditExcel, downloadAuditPdf } from "../audit-export.js";
import { NoticeModal } from "../notice.jsx";

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

export default function AuditPage() {
  const { user } = useAuth();
  const adminView = user?.role === "admin";
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState({ rows: [], total: 0, skip: 0, take: 50, page: 1, pages: 1 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(nextFrom = from, nextTo = to, skip = 0) {
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (nextFrom) q.set("from", nextFrom);
      if (nextTo) q.set("to", nextTo);
      q.set("skip", String(Math.max(0, skip)));
      const out = await api(`/audit?${q.toString()}`);
      setData({
        rows: Array.isArray(out?.rows) ? out.rows : [],
        total: out?.total ?? 0,
        skip: out?.skip ?? skip,
        take: out?.take ?? 50,
        page: out?.page ?? 1,
        pages: out?.pages ?? 1,
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
    load(from, to, 0);
  }

  const rows = data.rows || [];

  return (
    <>
      <h2 className="section-title">Auditoría</h2>
      <p className="section-sub">
        Movimientos de inventario y del patio, de 50 en 50. Las dos primeras páginas son los últimos 100. Si pides otra, se consulta la base de nuevo y no se carga el historial completo.
        {adminView ? " No incluye las acciones del superadmin." : ""}
      </p>
      <NoticeModal title="Aviso" text={error} onClose={() => setError("")} />

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
          {data.total} movimiento(s) en el rango. Página {data.page} de {data.pages}, {rows.length} en esta consulta.
        </p>
        <div className="action-row">
          <button className="btn-ghost" type="button" disabled={busy || data.page <= 1} onClick={() => load(from, to, Math.max(0, data.skip - data.take))}>Anterior</button>
          <button className="btn-ghost" type="button" disabled={busy || data.page >= data.pages} onClick={() => load(from, to, data.skip + data.take)}>Siguiente</button>
        </div>
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
