import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api.js";
import { hasRole, useAuth } from "../auth.jsx";
import { useNotice } from "../notice.jsx";
import { downloadCsv } from "../csv.js";

export default function Inventory() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterDepot, setFilterDepot] = useState("");
  const canRecalc = hasRole(user, "admin", "gerente");
  const { notify, toastNode } = useNotice();

  useEffect(() => {
    if (msg) notify(msg);
  }, [msg]);
  useEffect(() => {
    if (error) notify(error, "err");
  }, [error]);

  function load() {
    api("/inventory").then(setRows).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function recalculateLists() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const out = await api("/config/recalculate-prices", { method: "POST", body: {} });
      setMsg(`Listas recalculadas: ${out.updated ?? 0}. Las ofertas fijadas a mano no se tocaron.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    } finally {
      setBusy(false);
    }
  }

  const showCosts = rows.some((r) => r.costs);
  const showMargin = rows.some((r) => r.marginPct != null);
  const showPrice = rows.some((r) => r.priceList != null);
  const typeOptions = useMemo(() => [...new Set(rows.map((r) => r.type).filter(Boolean))].sort(), [rows]);
  const catOptions = useMemo(() => [...new Set(rows.map((r) => r.cat).filter(Boolean))].sort(), [rows]);
  const depotOptions = useMemo(() => [...new Set(rows.map((r) => r.depot).filter(Boolean))].sort(), [rows]);
  const visible = rows.filter((r) => (
    (!filterType || r.type === filterType)
    && (!filterCat || r.cat === filterCat)
    && (!filterDepot || r.depot === filterDepot)
  ));

  function downloadInventory() {
    const headers = ["ISO", "Tipo", "Condición", "Estado", "Depósito", "Posición"];
    if (showPrice) headers.push("Precio min", "Precio lista");
    if (showMargin) headers.push("Margen %");
    if (showCosts) headers.push("FOB", "C_T", "C_T real");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`zdry-inventario-${stamp}.csv`, headers, visible.map((r) => {
      const line = [r.iso, r.type, r.cat, r.status, r.depot, r.posLabel || ""];
      if (showPrice) line.push(r.priceMin ?? "", r.priceList ?? "");
      if (showMargin) line.push(r.marginPct ?? "");
      if (showCosts) line.push(r.costs?.fob ?? "", r.costs?.cT ?? "", r.costs?.cTReal ?? "");
      return line;
    }));
  }

  return (
    <>
    <h2 className="section-title">{hasRole(user, "admin", "compras") ? "Inventario y costos" : "Inventario disponible"}</h2>
    <p className="section-sub">
      Unidades reales en BD. El servidor oculta FOB y C_T según el rol — el vendedor y el operador no reciben esos campos aunque inspeccionen la red.
      {canRecalc ? " El precio de lista es el último guardado; si cambiaste margen o extras, recalcula para alinearlo con la regla." : ""}
    </p>
    {error ? <div className="err">{error}</div> : null}
    {msg ? <div className="ok-msg">{msg}</div> : null}
    {toastNode}
    {!showCosts && user.role !== "almacen" ? (
      <div className="locked-note">Costo real oculto para tu rol. Ves precio de lista y mínimo{showMargin ? " y margen %" : ""}.</div>
    ) : null}
    {user.role === "almacen" ? <div className="locked-note">Almacén no recibe precios ni costos.</div> : null}
    {canRecalc ? (
      <div className="action-row" style={{ marginBottom: 12 }}>
        <button className="btn-primary" type="button" disabled={busy} onClick={recalculateLists}>
          {busy ? "Recalculando…" : "Recalcular todas las listas"}
        </button>
      </div>
    ) : null}
      <div className="panel">
        <div className="odoo-toolbar">
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Filtrar por tipo">
            <option value="">Tipo</option>
            {typeOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} aria-label="Filtrar por condición">
            <option value="">Condición</option>
            {catOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <select value={filterDepot} onChange={(e) => setFilterDepot(e.target.value)} aria-label="Filtrar por depósito">
            <option value="">Depósito</option>
            {depotOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button className="btn-ghost" type="button" disabled={!visible.length} onClick={downloadInventory}>
            Descargar{visible.length !== rows.length ? ` (${visible.length})` : ""}
          </button>
        </div>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>ISO</th><th>Tipo</th><th>Condición</th><th>Estado</th><th>Depósito</th><th>Posición</th>
                {showPrice ? <><th>Precio min</th><th>Precio lista</th></> : null}
                {showMargin ? <th>Margen %</th> : null}
                {showCosts ? <><th>FOB</th><th>C_T</th><th>C_T real</th></> : null}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={showCosts ? 8 : 5} style={{ color: "var(--text-2)" }}>{rows.length ? "Ninguna unidad coincide con el filtro." : "Aún no hay contenedores. Compras los crea al registrar una factura."}</td></tr>
              ) : visible.map((r) => (
                <tr key={r.iso}>
                  <td>{r.iso}{r.demo ? <span className="demo-chip">DEMO</span> : null}</td>
                  <td>{r.type}</td>
                  <td>{r.cat}</td>
                  <td>{r.status}</td>
                    <td>{r.depot}</td>
                    <td>{r.posLabel || "—"}</td>
                  {showPrice ? <><td>{r.priceMin ?? "—"}</td><td><b>{r.priceList ?? "—"}</b></td></> : null}
                  {showMargin ? <td>{r.marginPct}</td> : null}
                  {showCosts ? <><td>{r.costs.fob}</td><td>{r.costs.cT}</td><td>{r.costs.cTReal}</td></> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
