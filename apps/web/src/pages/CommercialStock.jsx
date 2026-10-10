import { useMemo, useState } from "react";

function money(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "—";
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}

export default function CommercialStock({ rows, preview, onExit, canRequest, exceptions, onRequest }) {
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState(null);
  const [form, setForm] = useState({ clientName: "", clientCompany: "", ruc: "", requestedPrice: "", reason: "" });
  const [sending, setSending] = useState(false);
  const visible = useMemo(() => {
    const raw = q.trim().toUpperCase();
    if (!raw) return rows;
    const compact = raw.replace(/[\s-]/g, "");
    return rows.filter((r) => {
      const hay = [r.iso, r.type, r.cat, r.status, r.depot].filter(Boolean).join(" ").toUpperCase();
      return hay.includes(raw) || hay.replace(/[\s-]/g, "").includes(compact);
    });
  }, [rows, q]);
  return (
    <>
      {preview ? (
        <div className="commercial-view-bar">
          <div>
            <b>Estás viendo como comercial.</b>
            <span> Solo las unidades publicadas. El rango va del precio de lista al mínimo que puede ofrecer. Con esto vende el área comercial.</span>
          </div>
          <button className="btn-primary" type="button" onClick={onExit}>Salir de la vista comercial</button>
        </div>
      ) : (
        <p className="section-sub">Solo lo publicado está disponible para la venta. Puedes ofrecer desde el mínimo hasta el precio de lista.</p>
      )}
      <div className="panel">
        <div className="odoo-toolbar">
          <input
            className="odoo-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ISO, tipo, estado, depósito…"
            aria-label="Buscar en el inventario del comercial"
          />
        </div>
        <p className="section-sub">{visible.length} unidad{visible.length === 1 ? "" : "es"} publicada{visible.length === 1 ? "" : "s"}{q.trim() ? ` de ${rows.length}` : ""}.</p>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>ISO</th>
                <th>Tipo</th>
                <th>Condición</th>
                <th>Estado</th>
                <th>Depósito</th>
                <th>Precio de lista</th>
                <th>Mínimo permitido</th>
                <th>Rango</th>
                {canRequest ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={canRequest ? 9 : 8}>{rows.length ? "Ninguna unidad coincide con la búsqueda." : "No hay unidades publicadas."}</td></tr>
              ) : visible.map((r) => (
                <tr key={r.iso}>
                  <td>{r.iso}{r.demo ? <span className="demo-chip">DEMO</span> : null}</td>
                  <td>{r.type}</td>
                  <td>{r.cat}</td>
                  <td>{r.status}</td>
                  <td>{r.depot}</td>
                  <td><b>{money(r.priceList)}</b></td>
                  <td>{money(r.priceMin)}</td>
                  <td>{money(r.priceMin)} – {money(r.priceList)}</td>
                  {canRequest && r.priceMin ? (
                    <td>
                      <button className="btn-ghost" type="button" onClick={() => { setAsk(r); setForm({ clientName: "", clientCompany: "", ruc: "", requestedPrice: "", reason: "" }); }}>
                        Pedir menos
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ask ? (
          <form className="form-grid" style={{ marginTop: 14 }} onSubmit={async (e) => {
            e.preventDefault();
            setSending(true);
            try {
              await onRequest?.({ ...form, iso: ask.iso, requestedPrice: Number(form.requestedPrice) });
              setAsk(null);
            } finally {
              setSending(false);
            }
          }}>
            <div>
              <label>Unidad</label>
              <input value={`${ask.iso} · mínimo ${money(ask.priceMin)}`} readOnly />
            </div>
            <div><label>Cliente</label><input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required /></div>
            <div><label>Empresa</label><input value={form.clientCompany} onChange={(e) => setForm({ ...form, clientCompany: e.target.value })} /></div>
            <div><label>RUC</label><input value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value })} inputMode="numeric" /></div>
            <div><label>Precio que pide</label><input type="number" min="1" value={form.requestedPrice} onChange={(e) => setForm({ ...form, requestedPrice: e.target.value })} required /></div>
            <div><label>Por qué está debajo del mínimo</label><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></div>
            <div className="action-row">
              <button className="btn-primary" type="submit" disabled={sending}>{sending ? "Enviando…" : "Enviar a aprobación"}</button>
              <button className="btn-ghost" type="button" onClick={() => setAsk(null)}>Cancelar</button>
            </div>
          </form>
        ) : null}
        {Array.isArray(exceptions) && exceptions.length ? (
          <div style={{ marginTop: 14 }}>
            <h3>Solicitudes de precio</h3>
            <table className="data">
              <thead><tr><th>Unidad</th><th>Cliente</th><th>Pedido</th><th>Aprobado</th><th>Estado</th></tr></thead>
              <tbody>
                {exceptions.map((x) => (
                  <tr key={x.id}>
                    <td>{x.iso}</td>
                    <td>{x.clientName}</td>
                    <td>{money(x.requestedPrice)}</td>
                    <td>{x.approvedPrice == null ? "—" : money(x.approvedPrice)}</td>
                    <td>{x.status}{x.reviewNote ? ` · ${x.reviewNote}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  );
}
