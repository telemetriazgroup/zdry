import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

function money(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  return `USD ${Number(value).toLocaleString("en-US")}`;
}

function day(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

const PAY = {
  paid: "Pagada",
  not_paid: "Sin pagar",
  partial: "Pago parcial",
  in_payment: "En pago",
  invoiced: "Facturada",
  to_invoice: "Por facturar",
  no: "Sin factura",
};

function payLabel(value) {
  if (!value) return "Sin factura";
  return PAY[value] || value;
}

export default function RealizedSales({ embedded = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [openIso, setOpenIso] = useState("");

  function load() {
    return api("/warehouse/realized-sales")
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshFromOdoo() {
    setBusy(true);
    setError("");
    try {
      await api("/warehouse/realized-sales/refresh", { method: "POST", body: {} });
      await load();
    } catch (e) {
      setError(e.message || "Odoo no respondió. Se muestran los expedientes ya guardados.");
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary || {};
  const rows = data?.rows || [];
  const visible = useMemo(() => {
    const needle = q.trim().toUpperCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.iso, row.saleName, row.customer, row.origin, row.outName, ...(row.history || []).map((item) => item.saleName)]
        .join(" ")
        .toUpperCase()
        .includes(needle),
    );
  }, [rows, q]);

  return (
    <div style={embedded ? { marginTop: 12 } : undefined}>
      {embedded ? null : <h2 className="section-title">Ventas realizadas</h2>}
      <p className="section-sub">
        Cuando una serie sale a cliente, el expediente guarda el pedido de Odoo, el precio de esa unidad
        (no el total del pedido), la factura y el día de la salida. La ganancia es ese neto menos la base
        de hoy: OC o ajuste, extras de almacén y margen de seguridad. Óptima si el neto queda en el rango
        calculado o en el precio de inventario fijado a mano, o por encima. Admin y superadmin.
        {embedded ? (
          <>
            {" "}
            <Link to="/app/ventas-realizadas">Abrir el módulo</Link>
          </>
        ) : null}
      </p>
      {error ? <div className="err">{error}</div> : null}
      {!data && !error ? <p className="section-sub">Leyendo ventas realizadas…</p> : null}
      {data ? (
        <>
          <div className="panel" style={{ marginBottom: 12 }}>
            <p className="section-sub" style={{ marginTop: 0 }}>
              <b>{summary.last7 || 0}</b> venta(s) o salida(s) en los últimos 7 días.
              {" "}{summary.units || 0} equipo(s) en cliente.
              {" "}{summary.withPrice || 0} con precio de línea.
              {" "}{summary.missingPrice || 0} todavía sin el neto de Odoo.
              {" "}{summary.optimal || 0} óptima(s), {summary.below || 0} por debajo.
              {" "}Ganancia {money(summary.gain)}. Pérdida {money(summary.loss)}.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar ISO, pedido, cliente…"
                style={{ minWidth: 240 }}
              />
              <button className="btn" type="button" disabled={busy} onClick={refreshFromOdoo}>
                {busy ? "Leyendo Odoo…" : "Completar precios y facturas"}
              </button>
            </div>
          </div>
          <div className="panel">
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>Día</th>
                    <th>Pedido</th>
                    <th>Vendido</th>
                    <th>Base</th>
                    <th>Resultado</th>
                    <th>Factura</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const open = openIso === row.iso;
                    return (
                      <Fragment key={row.iso}>
                        <tr onClick={() => setOpenIso(open ? "" : row.iso)} style={{ cursor: "pointer" }}>
                          <td>
                            <b>{row.iso}</b>
                            <br />
                            {row.type} · {row.cat}
                          </td>
                          <td>{day(row.date)}</td>
                          <td>
                            {row.saleName || "Sin pedido"}
                            <br />
                            {row.customer || row.outName || ""}
                          </td>
                          <td>
                            {row.soldNet != null ? money(row.soldNet) : "—"}
                            {row.unitPrice != null ? (
                              <span className="section-sub">
                                <br />
                                unitario {money(row.unitPrice)}
                                {row.discount ? ` · desc. ${row.discount}` : ""}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            {money(row.costBase)}
                            <br />
                            <span className="section-sub">{row.origin}</span>
                          </td>
                          <td>
                            {row.result == null ? "—" : money(row.result)}
                            <br />
                            <span className="section-sub">{row.verdictLabel}</span>
                          </td>
                          <td>
                            {row.invoiceName || "Sin factura"}
                            <br />
                            <span className="section-sub">{payLabel(row.invoicePayment)}</span>
                          </td>
                        </tr>
                        {open ? (
                          <tr key={`${row.iso}-hist`}>
                            <td colSpan={7}>
                              <p className="section-sub">
                                Base de hoy {money(row.rawBase)}
                                {row.overlayTotal ? ` + extras ${money(row.overlayTotal)}` : ""}
                                {row.safetyAdd ? ` + margen ${money(row.safetyAdd)}` : ""}
                                {" = "}
                                {money(row.costBase)}.
                                {row.comparedTo === "inventario"
                                  ? ` Se compara contra el precio de inventario ${money(row.referenceList)}.`
                                  : row.referenceMin != null
                                    ? ` Rango calculado ${money(row.referenceMin)} a ${money(row.referenceList)}.`
                                    : ""}
                              </p>
                              {row.history?.length ? (
                                <table className="data">
                                  <thead>
                                    <tr>
                                      <th>Día de salida</th>
                                      <th>Pedido</th>
                                      <th>Cliente</th>
                                      <th>Neto</th>
                                      <th>Resultado</th>
                                      <th>Salida</th>
                                      <th>Factura</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.history.map((item) => (
                                      <tr key={item.saleName}>
                                        <td>{day(item.date)}{item.saleDate && day(item.saleDate) !== day(item.date) ? ` · pedido ${day(item.saleDate)}` : ""}</td>
                                        <td>{item.saleName}</td>
                                        <td>{item.customer || "—"}</td>
                                        <td>{item.soldNet != null ? money(item.soldNet) : "Falta la línea"}</td>
                                        <td>{item.result == null ? "—" : money(item.result)}<br /><span className="section-sub">{item.verdictLabel}</span></td>
                                        <td>{item.outName || "—"}</td>
                                        <td>{item.invoiceName || "Sin factura"} · {payLabel(item.invoicePayment)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="section-sub">Hay salida, pero el pedido todavía no está en el expediente. Completar precios lo lee en Odoo.</p>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {!visible.length ? (
                    <tr>
                      <td colSpan={7}>No hay ventas realizadas con ese filtro.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
