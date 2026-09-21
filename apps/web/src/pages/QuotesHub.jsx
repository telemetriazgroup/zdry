import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api, apiBlob, ApiError } from "../api.js";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const STATUS_LABEL = {
  nueva: "Nueva",
  cotizada: "Cotizada",
  reservada: "Reservada",
  en_negociacion: "Negociación",
  comprobante_subido: "Comprobante",
  en_verificacion: "En verificación",
  pago_validado: "Pago validado",
  pago_rechazado: "Rechazado",
  asignacion_confirmada: "Asignada",
  despacho_programado: "Despacho",
  perdida: "Perdida",
  expirada: "Expirada",
};

function tabOf(path) {
  if (path.includes("/negociacion")) return "negociacion";
  if (path.includes("/pagos")) return "pagos";
  if (path.includes("/seguimiento")) return "seguimiento";
  return "bandeja";
}

function matchTab(tab, status) {
  if (tab === "bandeja") return ["nueva", "cotizada", "reservada"].includes(status);
  if (tab === "negociacion") return status === "en_negociacion";
  if (tab === "pagos") return ["comprobante_subido", "en_verificacion", "pago_rechazado"].includes(status);
  return true;
}

async function openBlob(path) {
  const blob = await apiBlob(path);
  window.open(URL.createObjectURL(blob));
}

export default function QuotesHub() {
  const loc = useLocation();
  const tab = tabOf(loc.pathname);
  const [quotes, setQuotes] = useState([]);
  const [zones, setZones] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("esperando CCI 24–48 h");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const [discIso, setDiscIso] = useState("");
  const [discNet, setDiscNet] = useState("");
  const [moves, setMoves] = useState(0);
  const [zoneId, setZoneId] = useState("fz20");
  const [sellFreight, setSellFreight] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");

  const load = useCallback(() => {
    api("/quotes").then(setQuotes).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    api("/catalog/meta").then((m) => setZones(m.freightZones || [])).catch(() => {});
  }, [load]);

  const filtered = useMemo(() => quotes.filter((q) => matchTab(tab, q.dealStatus)), [quotes, tab]);

  async function refresh(id) {
    const q = await api(`/quotes/${id}`);
    setSelected(q);
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
      const err = e instanceof ApiError ? e : null;
      const url = err?.data?.odooUrl;
      setError(url ? `${err.message} Abrir en Odoo: ${url}` : (err ? err.message : e.message));
    }
  }

  const q = selected;

  return (
    <>
      <h2 className="section-title">Comercial</h2>
      <p className="section-sub">
        El voucher del cliente registra el pedido en ZDRY (atado a la cotización Odoo). No es una OC de Odoo.
        La SO sigue draft / cotización hasta el cierre. No existe «Marcar Ganada»: el ISO se confirma después de validar el pago.
      </p>
      <div className="subtab-row">
        <NavLink to="/app/bandeja" className={`subtab ${tab === "bandeja" ? "active" : ""}`}>Bandeja</NavLink>
        <NavLink to="/app/negociacion" className={`subtab ${tab === "negociacion" ? "active" : ""}`}>Negociación</NavLink>
        <NavLink to="/app/pagos" className={`subtab ${tab === "pagos" ? "active" : ""}`}>Pagos por validar</NavLink>
        <NavLink to="/app/seguimiento" className={`subtab ${tab === "seguimiento" ? "active" : ""}`}>Seguimiento</NavLink>
      </div>
      {error ? <div className="err">{error}</div> : null}
      <div className="dash-grid">
        <div className="panel">
          <div className="tablewrap">
          <table className="data">
            <thead><tr><th>N° Odoo</th><th>ZDRY</th><th>Cliente</th><th>Estado</th><th>PDF</th><th>Voucher</th><th>Total</th></tr></thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="expandable" onClick={() => refresh(row.id)}>
                  <td>{row.order?.displayNumber || row.odoo?.saleName || "—"}{row.demo ? <span className="demo-chip">DEMO</span> : null}</td>
                  <td>{row.number}</td>
                  <td>{row.customer.companyName}</td>
                  <td>{STATUS_LABEL[row.dealStatus] || row.dealStatus}</td>
                  <td>{row.order?.pdfReady || row.odoo?.pdf?.ready ? "Perú v2" : "—"}</td>
                  <td>{row.order?.voucherCount || row.vouchers?.length || 0}</td>
                  <td>{money(row.totals.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {q ? (
          <div className="panel">
            <h3>{q.order?.displayNumber || q.odoo?.saleName || q.number}{q.demo ? <span className="demo-chip">DEMO</span> : null}</h3>
            <p className="section-sub">{q.customer.companyName} · {STATUS_LABEL[q.dealStatus]} {q.holdPaused ? "· hold en pausa" : ""} · ZDRY {q.number}</p>
            {q.order?.registered ? (
              <p className="ok-msg">Pedido registrado en ZDRY sobre {q.odoo?.saleName || q.number}. El voucher no confirma la SO.</p>
            ) : null}
            {q.odoo?.saleName ? (
              <p className="ok-msg">
                Odoo {q.odoo.saleName} · {q.odoo.state || "draft"}
                {q.odoo.url ? <> · <a href={q.odoo.url} target="_blank" rel="noreferrer">abrir en Odoo</a></> : null}
              </p>
            ) : q.odoo?.job?.status === "error" ? (
              <p className="err">Odoo: {q.odoo.job.error || "error al emitir"} <button className="link-btn" type="button" onClick={() => act(`/quotes/${q.id}/issue-odoo`)}>Reintentar</button></p>
            ) : q.kind === "venta" && !q.demo ? (
              <p className="section-sub">Presupuesto Odoo: {q.odoo?.job?.status === "running" ? "creando…" : "en cola (Q2, draft, sin confirmar)."}</p>
            ) : null}
            {q.odoo?.saleName && q.amend && !q.amend.allowed ? (
              <p className="err">
                Esta cotización ya está confirmada. Modifícala en Odoo
                {q.odoo.url ? <> · <a href={q.odoo.url} target="_blank" rel="noreferrer">abrir formulario</a></> : null}.
              </p>
            ) : null}
            {q.dispatchNotes ? (
              <p className="ok-msg">Destino referencial del cliente: {q.dispatchNotes}. Confirma el flete al cotizar.</p>
            ) : null}
            <ul>{q.lines.map((l) => (
              <li key={l.id}>{l.iso} lista {money(l.listPrice)} / piso {money(l.minPrice)} / neto {money(l.priceNet)}</li>
            ))}</ul>

            {q.dealStatus === "nueva" ? (
              <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/send`)}>Enviar cotización (PDF Odoo)</button>
            ) : null}
            {q.dealStatus === "cotizada" ? (
              <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/reserve`)}>Reservar 48 h</button>
            ) : null}

            {["reservada", "en_negociacion"].includes(q.dealStatus) ? (
              <>
                <div style={{ maxHeight: 140, overflow: "auto", margin: "10px 0" }}>
                  {q.messages.map((m) => <div key={m.id}><b>{m.authorName}:</b> {m.body}</div>)}
                </div>
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act(`/quotes/${q.id}/thread`, { body: msg }); setMsg(""); }}>
                  <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Responder…" />
                  <button className="btn-ghost" type="submit">Enviar</button>
                </form>
                <div className="form-grid" style={{ marginTop: 10 }}>
                  <div>
                    <label>ISO</label>
                    <select value={discIso} onChange={(e) => setDiscIso(e.target.value)}>
                      <option value="">—</option>
                      {q.lines.map((l) => <option key={l.iso} value={l.iso}>{l.iso}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Nuevo neto (≥ piso)</label>
                    <input value={discNet} onChange={(e) => setDiscNet(e.target.value)} />
                  </div>
                </div>
                <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/grant-discount`, { iso: discIso, priceNet: Number(discNet) })} disabled={q.amend && !q.amend.allowed}>Otorgar descuento (−5 % o piso)</button>
                {q.dealStatus === "en_negociacion" ? (
                  <button className="btn-primary" type="button" style={{ marginLeft: 8 }} onClick={() => act(`/quotes/${q.id}/close-thread`)}>Cerrar hilo (vuelve a reservada)</button>
                ) : null}
                {q.amend?.allowed ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="box-kicker">Flete en el presupuesto Odoo (Q4b)</div>
                    <div className="form-grid">
                      <div>
                        <label>Zona flete</label>
                        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label>Venta flete (vacío = mínimo +15%)</label>
                        <input value={sellFreight} onChange={(e) => setSellFreight(e.target.value)} />
                      </div>
                    </div>
                    <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/extras/freight`, { zoneId, sellAmount: sellFreight ? Number(sellFreight) : undefined })}>Poner flete en la SO draft</button>
                    <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/extras/freight`, { clientPickup: true })}>Cliente retira</button>
                  </div>
                ) : null}
              </>
            ) : null}

            {q.vouchers.map((v) => (
              <div key={v.id} style={{ marginTop: 12, padding: 10, border: "1px solid var(--line)", borderRadius: 8 }}>
                <div>{v.originalName} · {v.bank} · {v.operationNumber} · {v.status}</div>
                <button className="link-btn" type="button" onClick={() => openBlob(`/quotes/${q.id}/vouchers/${v.id}`)}>Ver voucher</button>
                {q.dealStatus === "comprobante_subido" ? (
                  <>
                    <input value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/vouchers/${v.id}/verify`, { note })}>Marcar en verificación</button>
                    <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/vouchers/${v.id}/validate`)}>Validar ya</button>
                  </>
                ) : null}
                {q.dealStatus === "en_verificacion" ? (
                  <>
                    <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/vouchers/${v.id}/validate`)}>Validar pago</button>
                    <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo rechazo" />
                    <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/vouchers/${v.id}/reject`, { motivo })}>Rechazar</button>
                  </>
                ) : null}
              </div>
            ))}

            {["pago_validado", "asignacion_confirmada"].includes(q.dealStatus) ? (
              <div style={{ marginTop: 16 }}>
                <div className="box-kicker">Wizard de cierre (después del pago)</div>
                <label>Movimientos de patio</label>
                <input type="number" min={0} value={moves} onChange={(e) => setMoves(e.target.value)} />
                <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/extras/movement`, { moves: Number(moves) })}>Informar movimientos</button>
                <div className="form-grid" style={{ marginTop: 10 }}>
                  <div>
                    <label>Zona flete</label>
                    <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                      {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Venta flete (vacío = mínimo +15%)</label>
                    <input value={sellFreight} onChange={(e) => setSellFreight(e.target.value)} />
                  </div>
                </div>
                {q.amend?.allowed ? (
                  <>
                    <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/extras/freight`, { zoneId, sellAmount: sellFreight ? Number(sellFreight) : undefined })}>Poner flete en la SO draft</button>
                    <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/extras/freight`, { clientPickup: true })}>Cliente retira</button>
                  </>
                ) : q.odoo?.url ? (
                  <p className="section-sub">Flete/descuento: solo en Odoo · <a href={q.odoo.url} target="_blank" rel="noreferrer">abrir formulario</a></p>
                ) : null}
                {q.dealStatus === "pago_validado" ? (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/assign`)}>Confirmar ISO</button>
                  </div>
                ) : null}
                {q.dealStatus === "asignacion_confirmada" ? (
                  <div style={{ marginTop: 10 }}>
                    <label>Fecha despacho</label>
                    <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
                    <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/schedule`, { date: dispatchDate })}>Programar despacho</button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ marginTop: 16 }}>
              <button className="link-btn" type="button" onClick={() => openBlob(`/quotes/${q.id}/pdf`)}>
                {q.odoo?.pdf?.ready ? "PDF Perú v2" : "PDF"}
              </button>
              {q.odoo?.pdf?.ready ? <span className="muted"> · archivo de Odoo {q.odoo.saleName || ""}</span> : q.odoo?.saleName ? <span className="muted"> · aún prototipo si Odoo no renderizó</span> : null}
              {q.amend?.allowed ? (
                <button className="link-btn" type="button" style={{ marginLeft: 8 }} onClick={() => act(`/quotes/${q.id}/amend-odoo`, {}, "PATCH")}>Reescribir SO draft</button>
              ) : null}
            </div>
            {q.revisions?.length ? (
              <div style={{ marginTop: 12 }}>
                <div className="box-kicker">Enmiendas Odoo</div>
                {q.revisions.slice(0, 8).map((r) => (
                  <div key={r.id} className="muted">{new Date(r.at).toLocaleString("es-PE")} · {r.source} · total {r.amountTotal} · {r.state}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
