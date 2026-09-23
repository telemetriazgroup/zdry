import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function OdooIntegrations() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState(null);

  async function load() {
    setData(await api("/superadmin/odoo"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function saveMode(body) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const d = await api("/superadmin/odoo", { method: "PUT", body });
      setData(d);
      setMsg(body.activate ? `Modo ${body.mode === "production" ? "producción" : "staging"} activo.` : "Conexión guardada. El modo activo no cambió.");
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
        Hay dos conexiones guardadas. El modo activo es el que usa todo el equipo; en la barra se lee Staging o Producción.
        La clave no se vuelve a mostrar. Los demás usuarios no ven la URL ni la base.
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
      {data?.cutover?.pending ? (
        <div className="err">
          El origen cambió ({data.cutover.fromDb || "anterior"} → {data.cutover.toDb || "nuevo"}).
          Los id de la Odoo de pruebas se limpiaron y la cola de ese entorno no se reintenta.
          Baja de nuevo la bandeja para emparejar por ISO.
        </div>
      ) : null}
      <OdooBypassList />

      <div className="odoo-mode-grid">
        <OdooModeCard
          mode="staging"
          title="Staging"
          hint="Odoo de pruebas. Guardar no cambia el modo activo."
          saved={data?.modes?.staging}
          active={data?.mode === "staging"}
          busy={busy}
          onSubmit={saveMode}
        />
        <OdooModeCard
          mode="production"
          title="Producción"
          hint="Odoo real. Activarlo corta el origen: las claves personales quedan sin vínculo."
          saved={data?.modes?.production}
          active={data?.mode === "production"}
          busy={busy}
          onSubmit={saveMode}
        />
      </div>

      <div className="panel">
        <h3>Cotización ZDRY → Odoo (Q0 + Q2)</h3>
        <p className="section-sub">
          IDs de impuesto, productos DRY, almacén, PDF Perú v2, servicio de alquiler y plan mensual. Q2 crea el presupuesto <b>draft</b> de venta. Q6 crea el de alquiler (servicio + ISO $0). La cola muestra `quote_issue` y `rent_issue`.
        </p>
        <QuoteIssuePanel />
      </div>

      <div className="panel">
        <h3>Cola de sincronización</h3>
        <p className="section-sub">`quote_issue` = venta draft. `rent_issue` = alquiler draft (servicio + ISO $0). `sale_close` = Q5 confirma venta. `rent_close` = Q6 confirma suscripción (sin factura de producto).</p>
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
                      {["quote_issue", "sale_close", "rent_issue", "rent_close"].includes(j.event) && j.status === "error" ? (
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

function OdooModeCard({ mode, title, hint, saved, active, busy, onSubmit }) {
  const [form, setForm] = useState({
    enabled: !!saved?.enabled,
    url: saved?.url || "",
    db: saved?.db || "",
    user: saved?.user || "",
    apiKey: "",
  });

  useEffect(() => {
    setForm({
      enabled: !!saved?.enabled,
      url: saved?.url || "",
      db: saved?.db || "",
      user: saved?.user || "",
      apiKey: "",
    });
  }, [saved?.url, saved?.db, saved?.user, saved?.enabled]);

  function send(activate) {
    const body = { mode, activate, enabled: form.enabled, url: form.url, db: form.db, user: form.user };
    if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
    return onSubmit(body);
  }

  return (
    <form className={`panel odoo-mode-card${active ? " is-active" : ""}`} onSubmit={(e) => { e.preventDefault(); send(false); }}>
      <h3>{title}{active ? " · activo" : ""}</h3>
      <p className="section-sub">{hint}{saved?.apiKeySet ? " Ya hay una clave guardada." : " Todavía no hay clave guardada."}</p>
      <label className="check-inline" style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        Conector activo en este modo
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
          <label>Usuario principal</label>
          <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
        </div>
        <div>
          <label>Clave API</label>
          <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={saved?.apiKeySet ? "••••••••" : ""} autoComplete="new-password" />
        </div>
      </div>
      <div className="action-row" style={{ marginTop: 14 }}>
        <button className="btn-ghost" type="submit" disabled={busy}>Guardar</button>
        <button className="btn-primary" type="button" disabled={busy || active} onClick={() => send(true)}>Usar este modo</button>
      </div>
    </form>
  );
}

function OdooBypassList() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setRows(await api("/superadmin/odoo-links"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function toggle(id, bypass) {
    setError("");
    try {
      setRows(await api(`/superadmin/odoo-links/${id}`, { method: "PUT", body: { bypass } }));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3>Exención: operar como la cuenta principal</h3>
      <p className="section-sub">
        Comercial, despacho y administrador necesitan su clave. Si marcas la exención, entran igual y Odoo sigue viendo la cuenta principal. Queda en la auditoría.
      </p>
      {error ? <div className="err">{error}</div> : null}
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Cuenta principal</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b><div className="recv-who">{r.email}</div></td>
                <td>{r.role}</td>
                <td>{r.status === "active" ? "Activa" : r.status === "exempt" ? "Exenta" : r.status === "failed" ? "Fallida" : "Sin vínculo"}</td>
                <td>
                  <label className="check-inline">
                    <input type="checkbox" checked={!!r.bypass} onChange={(e) => toggle(r.id, e.target.checked)} />
                    {" "}Eximir
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
      {data?.rentReady ? <div className="ok-msg">Listo para Q6: producto de alquiler y plan mensual.</div> : null}
      {data && !data.ready ? (
        <p className="section-sub">Falta resolver: {(data.missing || []).join(", ") || "—"}. Pulsa «Leer IDs desde Odoo».</p>
      ) : null}
      {data && data.ready && !data.rentReady ? (
        <p className="section-sub">Q6 falta: {(data.rentMissing || []).join(", ") || "—"}.</p>
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
