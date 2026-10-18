import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

const PAGE_SIZE = 10;

const TRACE_LABEL = {
  picking_in: "Entrada",
  transfer: "Traslado",
  picking_out: "Despacho",
  repair: "Reparación",
};

const PAY = {
  paid: "Pagada",
  not_paid: "Sin pagar",
  partial: "Pago parcial",
  in_payment: "En pago",
  invoiced: "Facturada",
  to_invoice: "Por facturar",
  no: "Sin factura",
};

function money(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  return `USD ${Number(value).toLocaleString("en-US")}`;
}

function day(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function payLabel(value) {
  if (!value) return "";
  return PAY[value] || value;
}

function resultWord(value, kind) {
  if (kind === "alquiler") return "Alquiler";
  if (value == null) return "Sin cálculo";
  if (value > 0) return "Ganancia";
  if (value < 0) return "Pérdida";
  return "En equilibrio";
}

function traceStamp(raw) {
  const value = String(raw || "").trim();
  if (!value) return Number.MAX_SAFE_INTEGER;
  const t = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

function SaleExpediente({ iso }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    setData(null);
    setError("");
    api(`/warehouse/units/${iso}/expediente`)
      .then((next) => { if (!stop) setData(next); })
      .catch((e) => { if (!stop) setError(e.message); });
    return () => { stop = true; };
  }, [iso]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="section-sub">Cargando expediente…</p>;
  const trace = [...(data.trace || [])].sort((a, b) => traceStamp(a.date) - traceStamp(b.date) || String(a.name).localeCompare(String(b.name)));
  const empty = !data.sale?.length && !data.repairs?.length && !data.dispatch?.length && !trace.length;
  return (
    <div>
      <h3>Expediente</h3>
      {empty ? <p className="section-sub">Esta serie no tiene pedido, salida ni trazabilidad guardados.</p> : null}
      {data.sale?.length ? (
        <p className="section-sub">
          Pedidos: {data.sale.map((doc) => doc.title).filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {data.dispatch?.length ? (
        <p className="section-sub">
          Salidas: {data.dispatch.map((doc) => doc.title).filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {trace.length ? (
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Desde</th><th>Hacia</th></tr></thead>
            <tbody>
              {trace.map((row) => (
                <tr key={`${row.kind}-${row.name}`}>
                  <td>{row.date || "—"}</td>
                  <td>{TRACE_LABEL[row.kind] || row.kind} · {row.name}</td>
                  <td>{row.from || "—"}</td>
                  <td>{row.to || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Calculation({ row, deal }) {
  const kind = deal?.dealKind || row.dealKind;
  const sold = deal?.soldNet ?? row.soldNet;
  const result = deal?.result ?? row.result;
  const word = resultWord(result, kind);
  const tone = kind === "alquiler" ? "" : result > 0 ? "gain" : result < 0 ? "loss" : "";
  const vendor = deal?.vendorName || row.vendorName;
  if (kind === "alquiler") {
    return (
      <div>
        <h3 style={{ marginBottom: 4 }}>{row.iso}</h3>
        <p className="section-sub" style={{ marginTop: 0 }}>
          Alquiler · {row.type} · {row.cat}
          {deal?.customer || row.customer ? ` · ${deal?.customer || row.customer}` : ""}
          {" · "}{day(deal?.date || row.date)}
        </p>
        <p className="sale-result" style={{ fontSize: 22, margin: "8px 0" }}>
          Cuota {sold != null ? money(sold) : "sin precio"}
        </p>
        <p className="section-sub">
          No es una venta. El equipo vuelve al almacén cuando termina el alquiler
          {(deal?.rentEnd || row.rentEnd) ? ` (${day(deal?.rentEnd || row.rentEnd)})` : ""}.
          La cuota no se resta del costo del equipo.
        </p>
        <div className="sale-math">
          <div><span>Cotización {deal?.saleName || row.saleName || "sin pedido"}</span><b>{sold != null ? money(sold) : "Sin cuota"}</b></div>
          <div><span>Comercial</span><b>{vendor || "Sin comercial en la cotización"}</b></div>
          <div><span>Costo del equipo, no se resta</span><b>{money(row.costBase)}</b></div>
        </div>
        <p className="section-sub">{deal?.verdictLabel || row.verdictLabel}</p>
        <p className="section-sub">
          {(deal?.invoiceName || row.invoiceName)
            ? `Factura ${deal?.invoiceName || row.invoiceName}${payLabel(deal?.invoicePayment || row.invoicePayment) ? ` · ${payLabel(deal?.invoicePayment || row.invoicePayment)}` : ""}`
            : "Sin factura todavía."}
          {(deal?.outName || row.outName) ? ` Salida ${deal?.outName || row.outName}.` : ""}
        </p>
        {row.history?.length > 1 ? <History row={row} deal={deal} /> : null}
      </div>
    );
  }
  return (
    <div>
      <h3 style={{ marginBottom: 4 }}>{row.iso}</h3>
      <p className="section-sub" style={{ marginTop: 0 }}>
        {row.type} · {row.cat}
        {deal?.customer ? ` · ${deal.customer}` : row.customer ? ` · ${row.customer}` : ""}
        {" · "}{day(deal?.date || row.date)}
      </p>
      <p className={`sale-result ${tone}`} style={{ fontSize: 22, margin: "8px 0" }}>
        {word} {result == null ? "" : money(result)}
      </p>
      <div className="sale-math">
        <div><span>Origen {row.origin || "sin OC"}</span><b>{money(row.rawBase)}</b></div>
        <div><span>Extras de almacén</span><b>{money(row.overlayTotal || 0)}</b></div>
        <div><span>Margen de seguridad</span><b>{money(row.safetyAdd || 0)}</b></div>
        <div><span>Base de hoy</span><b>{money(row.costBase)}</b></div>
        <div><span>Comercial</span><b>{vendor || "Sin comercial en la cotización"}</b></div>
        <div>
          <span>
            Cotización {deal?.saleName || row.saleName || "sin pedido"}
            {deal?.unitPrice != null || row.unitPrice != null ? ` · unitario ${money(deal?.unitPrice ?? row.unitPrice)}` : ""}
            {(deal?.discount ?? row.discount) ? ` · desc. ${deal?.discount ?? row.discount}` : ""}
          </span>
          <b>{sold != null ? money(sold) : "Sin precio"}</b>
        </div>
        <div className="total">
          <span>{sold != null ? `${money(sold)} − ${money(row.costBase)}` : "Falta el precio de la cotización"}</span>
          <b className={`sale-result ${tone}`}>{result == null ? "—" : `${word} ${money(result)}`}</b>
        </div>
      </div>
      <p className="section-sub">
        {deal?.verdictLabel || row.verdictLabel}
        {row.comparedTo === "inventario"
          ? ` Se compara contra el precio de inventario ${money(row.referenceList)}.`
          : row.referenceMin != null
            ? ` Rango calculado ${money(deal?.referenceMin ?? row.referenceMin)} a ${money(deal?.referenceList ?? row.referenceList)}.`
            : ""}
      </p>
      <p className="section-sub">
        {(deal?.invoiceName || row.invoiceName)
          ? `Factura ${deal?.invoiceName || row.invoiceName}${payLabel(deal?.invoicePayment || row.invoicePayment) ? ` · ${payLabel(deal?.invoicePayment || row.invoicePayment)}` : ""}`
          : "Sin factura todavía. El cálculo usa el precio de la cotización."}
        {(deal?.outName || row.outName) ? ` Salida ${deal?.outName || row.outName}.` : ""}
      </p>
      {row.history?.length > 1 ? <History row={row} deal={deal} /> : null}
    </div>
  );
}

function History({ row, deal }) {
  return (
    <div>
      <b>Historial de esta serie</b>
      {row.history.map((item) => (
        <button
          key={item.saleName}
          type="button"
          className={deal?.saleName === item.saleName ? "sale-pick on" : "sale-pick"}
          onClick={() => deal?.onPick?.(item.saleName)}
        >
          <b>{day(item.date)} · {item.saleName}</b>
          <span className="section-sub">
            {" "}{item.dealKind === "alquiler" ? "Alquiler" : item.soldNet != null ? money(item.soldNet) : "Sin precio"}
            {" · "}{resultWord(item.result, item.dealKind)} {item.dealKind === "alquiler" || item.result == null ? "" : money(item.result)}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function RealizedSales({ embedded = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openIso, setOpenIso] = useState("");
  const [dealName, setDealName] = useState("");

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

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = visible.find((row) => row.iso === openIso) || null;
  const deal = selected?.history?.find((item) => item.saleName === dealName) || selected?.history?.[0] || null;

  useEffect(() => {
    setPage(1);
  }, [q]);

  useEffect(() => {
    if (!visible.length) {
      setOpenIso("");
      return;
    }
    if (!visible.some((row) => row.iso === openIso)) {
      setOpenIso(visible[0].iso);
      setDealName(visible[0].saleName || visible[0].history?.[0]?.saleName || "");
    }
  }, [visible, openIso]);

  function choose(row) {
    setOpenIso(row.iso);
    setDealName(row.saleName || row.history?.[0]?.saleName || "");
  }

  const from = visible.length ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(safePage * PAGE_SIZE, visible.length);

  return (
    <div style={embedded ? { marginTop: 12 } : undefined}>
      {embedded ? null : <h2 className="section-title">Ventas realizadas</h2>}
      <p className="section-sub">
        Diez ventas por página. Al elegir un equipo, a la derecha se arma la ganancia o la pérdida y se abre su expediente.
        {embedded ? <> <Link to="/app/ventas-realizadas">Abrir el módulo</Link></> : null}
      </p>
      {error ? <div className="err">{error}</div> : null}
      {!data && !error ? <p className="section-sub">Leyendo ventas realizadas…</p> : null}
      {data ? (
        <>
          <div className="panel" style={{ marginBottom: 12 }}>
            <p className="section-sub" style={{ marginTop: 0 }}>
              <b>{summary.last7Sales || 0}</b> venta(s) en los últimos 7 días.
              {" "}{summary.last7Rents || 0} alquiler(es), que vuelven al almacén.
              {" "}{summary.units || 0} en cliente.
              {" "}{summary.optimal || 0} óptima(s), {summary.below || 0} por debajo.
              {" "}Ganancia de ventas {money(summary.gain)}. Pérdida de ventas {money(summary.loss)}.
            </p>
            {summary.vendors?.length ? (
              <div className="share-bars">
                <b>Comerciales que cotizaron las salidas de estos 7 días</b>
                {summary.vendors.map((vendor) => (
                  <div className="share-bar-row" key={vendor.name}>
                    <span>{vendor.name}</span>
                    <div className="share-bar"><span style={{ width: `${vendor.share || 0}%` }} /></div>
                    <b>{vendor.sales} venta{vendor.sales === 1 ? "" : "s"}{vendor.rents ? ` · ${vendor.rents} alquiler` : ""}</b>
                  </div>
                ))}
                <p className="section-sub">
                  Ritmo si esta semana se repite: {summary.vendors.reduce((sum, vendor) => sum + (vendor.monthPace || 0), 0)} ventas de dry al mes.
                  Quien más vende ahora: {summary.vendors[0]?.name} ({summary.vendors[0]?.sales} en 7 días).
                </p>
              </div>
            ) : (
              <p className="section-sub">En los últimos 7 días no hay ventas de dry con comercial en la cotización.</p>
            )}
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
          <div className="share-board">
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Ventas</h3>
              <div className="tablewrap share-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Equipo</th>
                      <th>Día</th>
                      <th>Vendido</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr
                        key={row.iso}
                        className={row.iso === openIso ? "share-row-on" : ""}
                        onClick={() => choose(row)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <b>{row.iso}</b>
                          <br />
                          <span className="section-sub">{row.saleName || "Sin pedido"}</span>
                        </td>
                        <td>{day(row.date)}</td>
                        <td>{row.soldNet != null ? money(row.soldNet) : "—"}</td>
                        <td className={row.dealKind === "alquiler" ? "" : row.result > 0 ? "sale-result gain" : row.result < 0 ? "sale-result loss" : ""}>
                          {row.dealKind === "alquiler" ? (row.soldNet != null ? money(row.soldNet) : "—") : row.result == null ? "—" : money(row.result)}
                          <br />
                          <span className="section-sub">{resultWord(row.result, row.dealKind)}</span>
                        </td>
                      </tr>
                    ))}
                    {!pageRows.length ? (
                      <tr><td colSpan={4}>No hay ventas con ese filtro.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="odoo-pager">
                <button className="btn-ghost" type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Anterior</button>
                <span>{from}–{to} de {visible.length} · Página {safePage} / {pages}</span>
                <button className="btn-ghost" type="button" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Siguiente</button>
              </div>
            </div>
            <div className="panel share-scroll">
              {selected ? (
                <>
                  <Calculation
                    row={selected}
                    deal={deal ? { ...deal, onPick: setDealName } : null}
                  />
                  <SaleExpediente iso={selected.iso} />
                </>
              ) : (
                <p className="section-sub">Elige una venta para ver el cálculo y el expediente.</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
