import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Inventory() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/inventory").then(setRows).catch((e) => setError(e.message));
  }, []);

  const showCosts = rows.some((r) => r.costs);
  const showMargin = rows.some((r) => r.marginPct != null);
  const showPrice = rows.some((r) => r.priceList != null);

  return (
    <>
      <h2 className="section-title">{user.role === "admin" ? "Inventario y costos" : "Inventario disponible"}</h2>
      <p className="section-sub">
        Unidades reales en BD. El servidor oculta FOB y C_T según el rol — el vendedor y el operador no reciben esos campos aunque inspeccionen la red.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {!showCosts && user.role !== "almacen" ? (
        <div className="locked-note">Costo real oculto para tu rol. Ves precio de lista y mínimo{showMargin ? " y margen %" : ""}.</div>
      ) : null}
      {user.role === "almacen" ? <div className="locked-note">Almacén no recibe precios ni costos.</div> : null}
      <div className="panel">
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
              {rows.length === 0 ? (
                <tr><td colSpan={showCosts ? 8 : 5} style={{ color: "var(--text-2)" }}>Aún no hay contenedores. Compras los crea al registrar una factura.</td></tr>
              ) : rows.map((r) => (
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
