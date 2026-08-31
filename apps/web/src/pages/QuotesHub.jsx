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
  if (tab === "bandeja") return ["nueva", "cotizada"].includes(status);
  if (tab === "negociacion") return status === "en_negociacion";
  if (tab === "pagos") return ["comprobante_subido", "en_verificacion"].includes(status);
  return true;
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

  async function act(path, body) {
    setError("");
    try {
      const q = await api(path, { method: "POST", body: body || {} });
      setSelected(q);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  const q = selected;

  return (
    <>
      <h2 className="section-title">Comercial</h2>
      <p className="section-sub">Cierre por comprobante. No existe «Marcar Ganada»: el ISO se confirma después de validar el pago.</p>
      <div className="subtab-row">
        <NavLink to="/app/bandeja" className={`subtab ${tab === "bandeja" ? "active" : ""}`}>Bandeja</NavLink>
        <NavLink to="/app/negociacion" className={`subtab ${tab === "negociacion" ? "active" : ""}`}>Negociación</NavLink>
        <NavLink to="/app/pagos" className={`subtab ${tab === "pagos" ? "active" : ""}`}>Pagos por validar</NavLink>
        <NavLink to="/app/seguimiento" className={`subtab ${tab === "seguimiento" ? "active" : ""}`}>Seguimiento</NavLink>
      </div>
      {error ? <div className="err">{error}</div> : null}
      <div className="dash-grid">
        <div className="panel">
          <table className="data">
            <thead><tr><th>N°</th><th>Cliente</th><th>Estado</th><th>Total</th></tr></thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="expandable" onClick={() => refresh(row.id)}>
                  <td>{row.number}</td>
                  <td>{row.customer.companyName}</td>
                  <td>{STATUS_LABEL[row.dealStatus] || row.dealStatus}</td>
                  <td>{money(row.totals.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q ? (
          <div className="panel">
            <h3>{q.number}</h3>
            <p className="section-sub">{q.customer.companyName} · {STATUS_LABEL[q.dealStatus]} {q.holdPaused ? "· hold en pausa" : ""}</p>
            <ul>{q.lines.map((l) => (
              <li key={l.id}>{l.iso} lista {money(l.listPrice)} / piso {money(l.minPrice)} / neto {money(l.priceNet)}</li>
            ))}</ul>

            {q.dealStatus === "nueva" ? (
              <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/send`)}>Enviar cotización</button>
            ) : null}
            {q.dealStatus === "cotizada" ? (
              <button className="btn-primary" type="button" onClick={() => act(`/quotes/${q.id}/reserve`)}>Reservar 48 h</button>
            ) : null}

            {["reservada", "en_negociacion"].includes(q.dealStatus) ? (
              <>
                <div style={{ maxHeight: 140, overflow: "auto", margin: "10px 0" }}>
                  {q.messages.map((m) => <div key={m.id}><b>{m.authorName}:</b> {m.body}</div>)}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); act(`/quotes/${q.id}/thread`, { body: msg }); setMsg(""); }} style={{ display: "flex", gap: 8 }}>
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
                <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/grant-discount`, { iso: discIso, priceNet: Number(discNet) })}>Otorgar descuento</button>
                {q.dealStatus === "en_negociacion" ? (
                  <button className="btn-primary" type="button" style={{ marginLeft: 8 }} onClick={() => act(`/quotes/${q.id}/close-thread`)}>Cerrar hilo (vuelve a reservada)</button>
                ) : null}
              </>
            ) : null}

            {q.vouchers.map((v) => (
              <div key={v.id} style={{ marginTop: 12, padding: 10, border: "1px solid var(--line)", borderRadius: 8 }}>
                <div>{v.originalName} · {v.bank} · {v.operationNumber} · {v.status}</div>
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
                <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/extras/freight`, { zoneId, sellAmount: sellFreight ? Number(sellFreight) : undefined })}>Ofrecer flete</button>
                <button className="btn-ghost" type="button" onClick={() => act(`/quotes/${q.id}/extras/freight`, { clientPickup: true })}>Cliente retira</button>
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
              <button className="link-btn" type="button" onClick={async () => {
                const blob = await apiBlob(`/quotes/${q.id}/pdf`);
                const url = URL.createObjectURL(blob);
                window.open(url);
              }}>PDF</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
