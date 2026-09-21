import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function OdooIntegrations() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ enabled: false, url: "", db: "", user: "", apiKey: "" });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState(null);

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
        El conector usa las mismas credenciales para dos flechas: cierre de venta ZDRY → Odoo, y lectura de lotes DRY a la mano Odoo → ZDRY.
        La clave no se vuelve a mostrar; déjala en blanco si no la cambias.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="action-row" style={{ marginBottom: 16 }}>
        <button
          className="btn-ghost"
          type="button"
          disabled={busy}
          onClick={async () => {
            setError("");
            try {
              const p = await api("/odoo-import/probe");
              setProbe(p);
              if (!p.ok) setError(p.message);
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Probar conexión
        </button>
        <Link className="btn-primary" to="/app/almacen/odoo">Bandeja DRY a la mano</Link>
        <Link className="btn-ghost" to="/app/estadistica-dry">Estadística venta / alquiler</Link>
      </div>
      {probe?.ok ? <div className="ok-msg">Conectado{probe.user?.name ? ` · ${probe.user.name}` : ""}.</div> : null}
      {probe && !probe.ok ? <div className="err">{probe.message}</div> : null}

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
        <h3>Cotización ZDRY → Odoo (Q0 + Q2)</h3>
        <p className="section-sub">
          IDs de impuesto, productos DRY, almacén, PDF Perú v2. Q2 crea el presupuesto <b>draft</b> (no confirma). La cola de abajo muestra `quote_issue`.
        </p>
        <QuoteIssuePanel />
      </div>

      <div className="panel">
        <h3>Cola de sincronización</h3>
        <p className="section-sub">`quote_issue` = presupuesto draft. `sale_close` sigue siendo Q5 (confirmar), no Q2.</p>
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
                  <th></th>
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
                    <td>
                      {j.event === "quote_issue" && j.status === "error" ? (
                        <button className="link-btn" type="button" onClick={async () => {
                          setError("");
                          try {
                            await api(`/admin/odoo-queue/${j.id}/retry`, { method: "POST" });
                            await load();
                          } catch (e) {
                            setError(e.message);
                          }
                        }}>Reintentar</button>
                      ) : null}
                    </td>
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

function QuoteIssuePanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api("/odoo-import/quote-issue");
    setData(d);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function resolve() {
    setBusy(true);
    setError("");
    try {
      const d = await api("/odoo-import/quote-issue/resolve", { method: "POST" });
      setData(d);
      if (d.errors?.length) setError(d.errors.join(" · "));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const checks = data?.checks || [];
  return (
    <>
      {error ? <div className="err">{error}</div> : null}
      {data?.ready ? <div className="ok-msg">Listo para Q2: impuesto, almacén, productos y reporte existen en Odoo.</div> : null}
      {data && !data.ready ? (
        <p className="section-sub">Falta resolver: {(data.missing || []).join(", ") || "—"}. Pulsa «Leer IDs desde Odoo».</p>
      ) : null}
      <div className="action-row" style={{ margin: "10px 0 12px" }}>
        <button className="btn-primary" type="button" disabled={busy} onClick={resolve}>
          {busy ? "Leyendo…" : "Leer IDs desde Odoo"}
        </button>
      </div>
      {checks.length ? (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Pieza</th>
                <th>Id</th>
                <th>Odoo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.key}>
                  <td>{c.key}</td>
                  <td className="card-iso">{c.id || "—"}</td>
                  <td>{c.label}</td>
                  <td>{c.ok ? "ok" : c.error || "falta"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
