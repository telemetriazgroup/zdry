import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function OdooIntegrations() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ enabled: false, url: "", db: "", user: "", apiKey: "" });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api("/superadmin/odoo");
    setData(d);
    setForm({
      enabled: !!d.config?.enabled,
      url: d.config?.url || "",
      db: d.config?.db || "",
      user: d.config?.user || "",
      apiKey: "",
    });
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const body = { enabled: form.enabled, url: form.url, db: form.db, user: form.user };
      if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
      const d = await api("/superadmin/odoo", { method: "PUT", body });
      setData(d);
      setForm((f) => ({ ...f, apiKey: "" }));
      setMsg("Conexión Odoo guardada.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Integración Odoo</h2>
      <p className="section-sub">
        Contabilidad de ZDRY sale hacia Odoo cuando un comercial valida el pago. Aquí se configura el conector.
        La clave no se vuelve a mostrar; déjala en blanco si no la cambias.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <form className="panel" onSubmit={save} style={{ marginBottom: 18 }}>
        <h3>Conexión</h3>
        <p className="section-sub">Origen actual: {data?.source === "guardado" ? "valores guardados" : "variables de entorno"}.</p>
        <label className="check-inline" style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Conector activo
        </label>
        <div className="form-grid">
          <div>
            <label>URL</label>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://odoo.ejemplo.com" />
          </div>
          <div>
            <label>Base de datos</label>
            <input value={form.db} onChange={(e) => setForm({ ...form, db: e.target.value })} />
          </div>
          <div>
            <label>Usuario</label>
            <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
          </div>
          <div>
            <label>Clave API {data?.config?.apiKeySet ? "(ya hay una guardada)" : ""}</label>
            <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={data?.config?.apiKeySet ? "••••••••" : ""} autoComplete="new-password" />
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 14 }}>
          <button className="btn-primary" type="submit" disabled={busy}>Guardar</button>
        </div>
      </form>

      <div className="panel">
        <h3>Cola de sincronización</h3>
        <p className="section-sub">Trabajos pendientes o enviados tras un cierre comercial.</p>
        {!data?.queue?.length ? (
          <p className="section-sub">No hay trabajos en cola.</p>
        ) : (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Evento</th>
                  <th>Cotización</th>
                  <th>Estado</th>
                  <th>Intentos</th>
                </tr>
              </thead>
              <tbody>
                {data.queue.map((j) => (
                  <tr key={j.id}>
                    <td>{new Date(j.createdAt).toLocaleString("es-PE")}</td>
                    <td>{j.event}</td>
                    <td className="card-iso">{j.quoteId}</td>
                    <td>{j.status}</td>
                    <td>{j.attempts}{j.lastError ? ` · ${j.lastError}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
