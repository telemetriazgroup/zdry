import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function AuditPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/audit").then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h2 className="section-title">Auditoría</h2>
      <p className="section-sub">Quién hizo login, altas de maestros y personas. Append-only.</p>
      {error ? <div className="err">{error}</div> : null}
      <div className="panel">
        <div className="tablewrap">
        <table className="data">
          <thead><tr><th>Cuándo</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Id</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString("es-PE")}</td>
                <td>{r.user?.email || "—"}</td>
                <td>{r.action}</td>
                <td>{r.entity}</td>
                <td>{r.entityId || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
