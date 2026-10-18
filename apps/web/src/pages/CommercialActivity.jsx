import { useEffect, useState } from "react";
import { api } from "../api.js";

function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-PE");
}

export default function CommercialActivity() {
  const [data, setData] = useState({ vendors: [], topUnits: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    api("/audit/comerciales")
      .then((out) => setData({ vendors: out?.vendors || [], topUnits: out?.topUnits || [] }))
      .catch((e) => setError(e.message));
  }, []);

  const vendors = data.vendors || [];

  return (
    <>
      <h2 className="section-title">Comerciales</h2>
      <p className="section-sub">
        Accesos, clientes registrados en enlaces y unidades que esos clientes abrieron en el catálogo.
      </p>
      {error ? <div className="err">{error}</div> : null}
      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Unidades más vistas por los clientes</h3>
        {data.topUnits?.length ? (
          <p className="section-sub">
            {data.topUnits.map((row) => `${row.iso} (${row.views})`).join(" · ")}
          </p>
        ) : (
          <p className="section-sub">Todavía no hay vistas de unidades en los enlaces.</p>
        )}
      </div>
      <div className="panel">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Comercial</th>
                <th>Accesos</th>
                <th>Último acceso</th>
                <th>Clientes</th>
                <th>Vieron el catálogo</th>
                <th>Unidades más vistas</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((row) => (
                <tr key={row.id}>
                  <td><b>{row.name}</b><br /><span className="section-sub">{row.email}</span></td>
                  <td>{row.logins}</td>
                  <td>{when(row.lastLogin)}</td>
                  <td>{row.clients}{row.activeClients !== row.clients ? ` · ${row.activeClients} vigentes` : ""}</td>
                  <td>{row.clientsViewed}</td>
                  <td>{row.topUnits?.length ? row.topUnits.map((unit) => `${unit.iso} (${unit.views})`).join(" · ") : "—"}</td>
                </tr>
              ))}
              {!vendors.length ? (
                <tr><td colSpan={6}>No hay comerciales activos.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
