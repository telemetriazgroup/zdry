import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function SystemBackup() {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const list = await api("/superadmin/backups");
    setRows(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function run(name, fn) {
    setBusy(name);
    setError("");
    setMsg("");
    try {
      const out = await fn();
      await load();
      setMsg(out?.note || "Listo.");
      return out;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <h2 className="section-title">Respaldo y recuperación</h2>
      <p className="section-sub">
        Los respaldos se guardan de forma interna (base + fotos y archivos). Restaurar reinyecta esa información.
        Vaciar el sistema exige un export automático previo y deja solo al superadmin.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {busy ? <div className="warn-inline">{busy}… puede tardar si hay muchas fotos.</div> : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Crear respaldo</h3>
        <div className="form-grid">
          <div>
            <label>Etiqueta (opcional)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Respaldo previo a mantenimiento" />
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button
            className="btn-primary"
            type="button"
            disabled={!!busy}
            onClick={() => run("Creando respaldo", () => api("/superadmin/backups", { method: "POST", body: { label } }))}
          >
            Exportar ahora
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Respaldos internos</h3>
        {!rows.length ? (
          <p className="section-sub">Aún no hay exportaciones.</p>
        ) : (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Etiqueta</th>
                  <th>Tipo</th>
                  <th>Tamaño</th>
                  <th>Archivos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td>{new Date(b.createdAt).toLocaleString("es-PE")}</td>
                    <td>{b.label}</td>
                    <td>{b.kind}</td>
                    <td>{Math.round((b.sizeBytes || 0) / 1024)} KB</td>
                    <td>{b.mediaFiles ?? "—"}</td>
                    <td>
                      <button
                        className="btn-ghost"
                        type="button"
                        disabled={!!busy}
                        onClick={() => {
                          if (!window.confirm("¿Restaurar este respaldo? Se reinyectan datos, fotos y archivos guardados.")) return;
                          run("Restaurando", () => api(`/superadmin/backups/${b.id}/restore`, { method: "POST" }));
                        }}
                      >
                        Recuperar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ borderColor: "#f1c0c0" }}>
        <h3>Vaciar el sistema</h3>
        <p className="section-sub">
          Primero se exporta un respaldo interno. Luego se borran cotizaciones, unidades, fotos, clientes y el resto
          de cuentas. Queda activo solo el superadmin. Escribe <b>VACIAR</b> para confirmar.
        </p>
        <div className="form-grid">
          <div>
            <label>Confirmación</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="VACIAR" />
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button
            className="btn-ghost"
            type="button"
            disabled={!!busy || confirm.trim().toUpperCase() !== "VACIAR"}
            onClick={() => {
              if (!window.confirm("Se exportará un respaldo y después se borrará todo excepto el superadmin. ¿Continuar?")) return;
              run("Vaciando", async () => {
                const out = await api("/superadmin/wipe", { method: "POST", body: { confirm } });
                setConfirm("");
                return out;
              });
            }}
          >
            Vaciar datos
          </button>
        </div>
      </div>
    </>
  );
}
