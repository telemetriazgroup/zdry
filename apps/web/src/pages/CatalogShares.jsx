import { useEffect, useState } from "react";
import { api, formatWhen, APP_ROOT } from "../api.js";
import { whatsappDigits } from "../catalog-copy.js";
import { useAuth } from "../auth.jsx";

const HOURS = Array.from({ length: 10 }, (_, i) => (i + 1) * 24);
const KIND = {
  open: "Abrió el catálogo",
  view_unit: "Vio un DRY",
  view_image: "Vio una imagen",
  filter: "Usó un filtro",
  whatsapp: "WhatsApp",
  cart: "Carrito",
  search: "Búsqueda",
};
const STATUS = { activo: "Activo", suspendido: "Suspendido", vencido: "Vencido" };

function Icon({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function usd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Sin precio";
  return `USD ${Math.round(n).toLocaleString("en-US")}`;
}

function ShareActivity({ detail }) {
  const metrics = detail?.metrics;
  if (!detail || !metrics) return <p className="section-sub">Elige un enlace para ver qué revisa el cliente.</p>;
  const units = metrics.units || [];
  const viewsMax = Math.max(1, ...units.map((u) => u.views || u.count || 0));
  const priceMax = Math.max(1, ...units.map((u) => Number(u.priceList) || 0));
  const imageTotal = units.reduce((sum, u) => sum + (u.images || 0), 0);
  const returnTotal = units.reduce((sum, u) => sum + (u.returns || 0), 0);
  return (
    <>
      <p className="section-sub">
        {detail.clientCompany} · {detail.contactName} · {detail.clientEmail}
        <br />
        {shareUrl(detail.token)} · clave {detail.accessCode || "—"} · {STATUS[detail.status] || ""} · vence {formatWhen(detail.expiresAt)}
      </p>
      <div className="share-kpis">
        <div><span>Aperturas</span><b>{(metrics.opens || []).length}</b></div>
        <div><span>Equipos</span><b>{units.length}</b></div>
        <div><span>Fotos</span><b>{imageTotal}</b></div>
        <div><span>Regresos</span><b>{returnTotal}</b></div>
      </div>
      <b>Veces que abrió cada equipo</b>
      {units.length ? (
        <div className="share-bars">
          {units.map((u) => (
            <div className="share-bar-row" key={`v-${u.iso}`}>
              <b>{u.iso}</b>
              <div className="share-bar"><span style={{ width: `${Math.max(8, ((u.views || u.count || 0) / viewsMax) * 100)}%` }} /></div>
              <span>{u.views || u.count || 0}</span>
            </div>
          ))}
        </div>
      ) : <p className="muted">Todavía no abre fichas.</p>}
      <b>Precio de lista de lo que revisa</b>
      {units.length ? (
        <div className="share-bars">
          {units.map((u) => (
            <div className="share-bar-row" key={`p-${u.iso}`}>
              <b>{u.iso}</b>
              <div className="share-bar price"><span style={{ width: `${u.priceList ? Math.max(8, (Number(u.priceList) / priceMax) * 100) : 0}%` }} /></div>
              <span>{usd(u.priceList)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="share-metrics">
        <div>
          <b>Filtros</b>
          {(metrics.filters || []).length ? <ul>{metrics.filters.map((f) => <li key={f.label}>{f.label} · {f.count}</li>)}</ul> : <p className="muted">Sin filtros</p>}
        </div>
        <div>
          <b>Búsquedas</b>
          {(metrics.searches || []).length ? <ul>{metrics.searches.map((s) => <li key={s.q}>{s.q} · {s.count}</li>)}</ul> : <p className="muted">Sin búsquedas</p>}
        </div>
      </div>
      {units.map((u) => (
        <div className="share-unit" key={`m-${u.iso}`}>
          <b>{u.iso}</b> {u.type ? `· ${u.type}` : ""} {u.cat ? `· ${u.cat}` : ""} · {usd(u.priceList)}
          <p>{u.views || 0} aperturas · vuelve {u.returns || 0} · {u.images || 0} fotos ({u.distinctImages || 0} distintas)</p>
          {(u.places || []).map((place, i) => (
            <p key={`${u.iso}-${i}`}>{place.ip || "sin IP"} · {place.device || "dispositivo"}{place.client ? ` · ${place.client}` : ""}</p>
          ))}
        </div>
      ))}
      <b>Desde dónde entró</b>
      <ul className="dash-list">
        {(metrics.opens || []).map((o, i) => (
          <li key={`open-${i}`}>{formatWhen(o.at)} · {o.ip || "sin IP"} · {o.device || "dispositivo"}{o.client ? ` · ${o.client}` : ""}</li>
        ))}
        {!(metrics.opens || []).length ? <li className="muted">Aún no abre el enlace.</li> : null}
      </ul>
    </>
  );
}

function shareInvite(row) {
  const url = shareUrl(row.token);
  return `Hola ${row.contactName || row.clientName}, tu catálogo ZDRY está listo:\n${url}\nClave: ${row.accessCode}\nVigencia: ${row.hours} horas.`;
}

function shareWhatsApp(row) {
  const phone = whatsappDigits(row.clientPhone);
  return `https://wa.me/${phone}?text=${encodeURIComponent(shareInvite(row))}`;
}

function shareUrl(token) {
  const base = `${window.location.origin}${APP_ROOT === "/" ? "" : APP_ROOT.replace(/\/$/, "")}`;
  return `${base}/c/${token}`;
}

export default function CatalogShares() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [looking, setLooking] = useState(false);
  const [sunat, setSunat] = useState(null);
  const [form, setForm] = useState({
    ruc: "",
    clientCompany: "",
    street: "",
    district: "",
    province: "",
    department: "",
    sunatState: "",
    sunatCondition: "",
    customerId: "",
    contactName: "",
    clientPhone: "",
    clientEmail: "",
    clientNote: "",
    vendorWhatsapp: user?.whatsapp || "",
    hours: 72,
    contacts: [],
  });

  async function load() {
    const list = await api("/catalog-shares");
    setRows(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function applyContact(contact) {
    if (!contact) return;
    setForm((cur) => ({
      ...cur,
      contactName: contact.name || cur.contactName,
      clientPhone: contact.phone || cur.clientPhone,
      clientEmail: contact.email || cur.clientEmail,
    }));
  }

  async function lookupRuc() {
    setError("");
    setMsg("");
    setLooking(true);
    try {
      const found = await api("/catalog-shares/ruc", { method: "POST", body: { ruc: form.ruc } });
      setSunat(found);
      setForm((cur) => ({
        ...cur,
        ruc: found.ruc,
        clientCompany: found.companyName || "",
        street: found.street || "",
        district: found.district || "",
        province: found.province || "",
        department: found.department || "",
        sunatState: found.sunatState || "",
        sunatCondition: found.sunatCondition || "",
        customerId: found.customerId || "",
        contactName: found.contactName || "",
        clientPhone: found.contactPhone || "",
        clientEmail: found.contactEmail || "",
        contacts: found.contacts || [],
      }));
      setMsg(found.activeShare
        ? `${found.companyName} ya tiene un enlace activo. Suspéndelo para crear otro.`
        : `SUNAT: ${found.companyName}. Completa el contacto y genera el enlace.`);
    } catch (err) {
      setSunat(null);
      setError(err.message);
    } finally {
      setLooking(false);
    }
  }

  async function create(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const row = await api("/catalog-shares", { method: "POST", body: form });
      await navigator.clipboard?.writeText(shareInvite(row)).catch(() => {});
      setMsg(`Enlace para ${row.clientCompany || row.clientName}. Clave ${row.accessCode}. Vigente ${row.hours} h. El mensaje ya está copiado para enviarlo.`);
      setSunat(null);
      setForm({
        ...form,
        ruc: "",
        clientCompany: "",
        street: "",
        district: "",
        province: "",
        department: "",
        sunatState: "",
        sunatCondition: "",
        customerId: "",
        contactName: "",
        clientPhone: "",
        clientEmail: "",
        clientNote: "",
        contacts: [],
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function suspend(id) {
    if (!window.confirm("¿Suspender este enlace? El cliente deja de entrar y puedes crear otro.")) return;
    setError("");
    try {
      await api(`/catalog-shares/${id}/suspend`, { method: "POST" });
      setMsg("Enlace suspendido. Ya puedes generar otro para ese cliente.");
      if (openId === id) setDetail(await api(`/catalog-shares/mine/${id}`));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function open(id) {
    setOpenId(id);
    try {
      setDetail(await api(`/catalog-shares/mine/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Enlaces de catálogo</h2>
      <p className="section-sub">
        Validas el RUC en SUNAT, indicas a la persona que verá el catálogo y el WhatsApp del comercial. La vigencia va de 24 a 240 horas. Cada cliente tiene un solo enlace activo, y ese enlace solo permanece abierto en un lugar: si entra en otro, la sesión anterior se cierra.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Nuevo enlace temporizado</h3>
        <form className="form-grid" onSubmit={create}>
          <div>
            <label>RUC</label>
            <input value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value })} required placeholder="11 dígitos" inputMode="numeric" />
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button className="btn-ghost" type="button" disabled={looking} onClick={lookupRuc}>{looking ? "Consultando SUNAT…" : "Validar en SUNAT"}</button>
          </div>
          {sunat ? (
            <div className="sunat-card">
              <b>{form.clientCompany}</b>
              <p>{[form.street, form.district, form.province, form.department].filter(Boolean).join(" · ") || "Sin domicilio en la respuesta."}</p>
              <p>{form.sunatState || "—"} · {form.sunatCondition || "—"}</p>
            </div>
          ) : null}
          {form.contacts.length > 1 ? (
            <div>
              <label>Contacto en Odoo</label>
              <select onChange={(e) => applyContact(form.contacts[Number(e.target.value)])}>
                {form.contacts.map((c, i) => <option key={c.id || i} value={i}>{c.name || c.email || c.phone}</option>)}
              </select>
            </div>
          ) : null}
          <div><label>Persona que verá el catálogo</label><input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} required placeholder="Nombre del contacto" /></div>
          <div><label>Teléfono del contacto</label><input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} required /></div>
          <div><label>Correo del contacto</label><input type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} required /></div>
          <div>
            <label>Vigencia</label>
            <select value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{h} horas</option>)}
            </select>
          </div>
          <div><label>WhatsApp del comercial</label><input value={form.vendorWhatsapp} onChange={(e) => setForm({ ...form, vendorWhatsapp: e.target.value })} required placeholder="51 9XX XXX XXX" /></div>
          <div><label>Nota</label><input value={form.clientNote} onChange={(e) => setForm({ ...form, clientNote: e.target.value })} placeholder="Opcional" /></div>
          <button className="btn-primary" type="submit" disabled={Boolean(sunat?.activeShare)}>Generar enlace</button>
        </form>
      </div>

      <div className="share-board">
        <div className="panel">
          <h3>Enlaces</h3>
          <div className="tablewrap share-scroll">
            <table className="data">
              <thead><tr><th>Cliente</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.clientCompany || r.clientName}</b><br /><span className="muted">{r.ruc ? `RUC ${r.ruc} · ` : ""}{r.contactName || r.clientName}{r.accessCode ? ` · clave ${r.accessCode}` : ""}</span></td>
                    <td>{formatWhen(r.expiresAt)}</td>
                    <td>{STATUS[r.status] || (r.live ? "Activo" : "Vencido")}</td>
                    <td>
                      <div className="share-actions">
                        <button className={`share-icon ${openId === r.id ? "on" : ""}`} type="button" title="Ver actividad" aria-label="Ver actividad" onClick={() => open(r.id)}>
                          <Icon><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /></Icon>
                        </button>
                        {r.status === "activo" ? (
                          <button className="share-icon" type="button" title="Copiar" aria-label="Copiar enlace y clave" onClick={() => navigator.clipboard?.writeText(shareInvite(r)).then(() => setMsg("Mensaje copiado.")).catch(() => setError("No se pudo copiar."))}>
                            <Icon><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M4 16V6a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" strokeWidth="1.8" /></Icon>
                          </button>
                        ) : null}
                        {r.status === "activo" && r.clientPhone ? (
                          <a className="share-icon" href={shareWhatsApp(r)} target="_blank" rel="noreferrer" title="Enviar clave" aria-label="Enviar clave por WhatsApp">
                            <Icon><path d="M5 19l1.2-3.4A8 8 0 1 1 8.4 18L5 19z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9 10c.2 2 1.6 3.4 3.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" /></Icon>
                          </a>
                        ) : null}
                        {r.status === "activo" ? (
                          <button className="share-icon danger" type="button" title="Suspender" aria-label="Suspender enlace" onClick={() => suspend(r.id)}>
                            <Icon><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 12h8" stroke="currentColor" strokeWidth="1.8" /></Icon>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={4}>Aún no hay enlaces. Genera el primero para un cliente.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>{detail ? `Actividad · ${detail.clientName}` : "Actividad del cliente"}</h3>
          <div className="share-scroll">
            <ShareActivity detail={detail} />
            {detail?.events?.length ? (
              <ul className="dash-list">
                {detail.events.slice(0, 40).map((e) => (
                  <li key={e.id}>
                    <b>{KIND[e.kind] || e.kind}{e.iso ? ` · ${e.iso}` : ""}{e.detail?.q ? ` · ${e.detail.q}` : ""}{e.detail?.slot != null && e.kind === "view_image" ? ` · foto ${Number(e.detail.slot) + 1}` : ""}</b>
                    <span>{formatWhen(e.at)}{e.device ? ` · ${e.device}` : ""}{e.client ? ` · ${e.client}` : ""}{e.ip ? ` · ${e.ip}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
