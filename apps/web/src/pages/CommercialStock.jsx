import { useMemo, useState } from "react";

function money(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "—";
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}

export default function CommercialStock({ rows, preview, onExit }) {
  const [q, setQ] = useState("");
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
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={8}>{rows.length ? "Ninguna unidad coincide con la búsqueda." : "No hay unidades publicadas."}</td></tr>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
