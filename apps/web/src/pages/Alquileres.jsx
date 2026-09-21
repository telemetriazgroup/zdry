import { useCallback, useEffect, useState } from "react";
import { api, apiBlob } from "../api.js";

const money = (n) => "S/ " + Math.round(Number(n) || 0).toLocaleString("es-PE");

async function openBlob(path) {
  const blob = await apiBlob(path);
  window.open(URL.createObjectURL(blob));
}

export default function Alquileres() {
  const [quotes, setQuotes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [cuota, setCuota] = useState("");
  const [months, setMonths] = useState("12");

  const load = useCallback(() => {
    api("/quotes?kind=alquiler").then(setQuotes).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh(id) {
    const q = await api(`/quotes/${id}`);
    setSelected(q);
    setCuota(q.rent?.priceNet != null ? String(q.rent.priceNet) : "");
    setMonths(q.rent?.months != null ? String(q.rent.months) : "12");
    load();
    return q;
  }

  async function act(path, body, method = "POST") {
    setError("");
    try {
      const q = await api(path, { method, body: body || {} });
      setSelected(q);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const q = selected;

  return (
    <>
      <h2 className="section-title">Contratos de alquiler</h2>
      <p className="section-sub">
        SO Odoo con línea de servicio (cuota) + ISO a $0 y plan mensual. El cronograma es el reporte de Odoo. La cuota se puede cambiar hasta confirmar y, después, hasta la siguiente factura.
      </p>
      {error ? <div className="err">{error}</div> : null}
      <div className="dash-grid">
        <div className="panel">
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>N° Odoo</th>
                  <th>Cliente</th>
                  <th>Cuota</th>
                  <th>Estado</th>
                  <th>IN</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((row) => (
                  <tr key={row.id} className="expandable" onClick={() => refresh(row.id)}>
                    <td>{row.order?.displayNumber || row.odoo?.saleName || row.number}</td>
                    <td>{row.customer.companyName}</td>
                    <td>{money(row.rent?.priceNet)}</td>
                    <td>{row.odoo?.state || row.dealStatus}</td>
                    <td>{row.odoo?.close?.returnedOdoo ? "devuelto" : row.odoo?.close?.dispatchedOdoo ? "en cliente" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {q ? (
          <div className="panel">
            <h3>{q.order?.displayNumber || q.number}</h3>
            <p className="section-sub">{q.customer.companyName} · {q.dealStatus}</p>
            {q.odoo?.saleName ? (
              <p className="ok-msg">
                Odoo {q.odoo.saleName} · {q.odoo.state || "draft"}
                {q.odoo.url ? <> · <a href={q.odoo.url} target="_blank" rel="noreferrer">abrir en Odoo</a></> : null}
              </p>
            ) : q.odoo?.job?.status === "error" ? (
              <p className="err">
                Odoo: {q.odoo.job.error}
                <button className="link-btn" type="button" onClick={() => act(`/quotes/${q.id}/issue-odoo`)}>Reintentar</button>
              </p>
            ) : (
              <p className="section-sub">Presupuesto de alquiler en cola (Q6, draft, sin confirmar).</p>
            )}
            {q.odoo?.close?.quoted ? (
              <p className="ok-msg">
                Semáforo: cotización
                {q.odoo.close.confirmed ? " → confirmada" : " (draft)"}
                {q.odoo.close.invoiced ? ` → cuota ${q.odoo.invoiceName || ""}` : ""}
                {q.odoo.close.dispatchedOdoo ? " → OUT" : ""}
                {q.odoo.close.returnedOdoo ? " → IN" : ""}
              </p>
            ) : null}
            {q.odoo?.closeJob?.status === "error" ? (
              <p className="err">
                Cierre alquiler: {q.odoo.closeJob.error}
                <button className="link-btn" type="button" onClick={() => act(`/quotes/${q.id}/close-odoo`)}>Reintentar cierre</button>
              </p>
            ) : null}
            <ul>{q.lines.map((l) => <li key={l.id}>{l.iso} · {l.type} {l.cat}</li>)}</ul>
            {q.rent?.quotaEditable ? (
              <div className="form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Cuota mensual (neto)</label>
                  <input value={cuota} onChange={(e) => setCuota(e.target.value)} />
                </div>
                <div>
                  <label>Meses</label>
                  <input value={months} onChange={(e) => setMonths(e.target.value)} />
                </div>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => act(`/quotes/${q.id}/grant-rent`, { priceNet: Number(cuota), months: Number(months) })}
                >
                  Escribir cuota en Odoo
                </button>
              </div>
            ) : (
              <p className="section-sub">Cuota {money(q.rent?.priceNet)}. Contrato cerrado o cancelado: cambia el precio en Odoo.</p>
            )}
            {q.rent?.installments?.length ? (
              <div style={{ marginTop: 12 }}>
                <div className="box-kicker">Cuotas publicadas</div>
                {q.rent.installments.map((i) => (
                  <div key={i.id} className="muted">
                    {i.name} · {money(i.amountTotal)} · vence {i.dueDate ? new Date(i.dueDate).toLocaleDateString("es-PE") : "—"} · {i.paymentState || "posted"}
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ marginTop: 16 }}>
              <button className="link-btn" type="button" onClick={() => openBlob(`/quotes/${q.id}/pdf`)}>PDF Perú v2</button>
              {q.odoo?.pdf?.cronogramaReady || q.odoo?.saleName ? (
                <button className="link-btn" type="button" style={{ marginLeft: 8 }} onClick={() => openBlob(`/quotes/${q.id}/cronograma`)}>Cronograma</button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
