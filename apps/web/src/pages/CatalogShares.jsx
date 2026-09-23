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

function ShareMetrics({ metrics }) {
  if (!metrics) return null;
  const blocks = [
    ["Conexiones", (metrics.opens || []).map((o) => `${o.device || "dispositivo"} · ${o.ip || "sin IP"}`)],
    ["Filtros", (metrics.filters || []).map((f) => `${f.label} · ${f.count}`)],
    ["Búsquedas", (metrics.searches || []).map((s) => `${s.q} · ${s.count} ${s.count === 1 ? "vez" : "veces"}`)],
    ["Equipos vistos", (metrics.units || []).map((u) => `${u.iso} · ${u.count}`)],
    ["Imágenes", (metrics.images || []).map((img) => `${img.iso} foto ${Number(img.slot) + 1 || img.slot} · ${img.count}`)],
  ];
  return (
    <div className="share-metrics">
      {blocks.map(([title, lines]) => (
        <div key={title}>
          <b>{title}</b>
          {lines.length ? <ul>{lines.map((line, i) => <li key={`${title}-${i}`}>{line}</li>)}</ul> : <p className="muted">Sin datos</p>}
        </div>
      ))}
    </div>
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
        Validas el RUC en SUNAT, indicas a la persona que verá el catálogo y el WhatsApp del comercial. La vigencia va de 24 a 240 horas. Cada cliente tiene un solo enlace activo.
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

      <div className="dash-grid home-dash-grid">
        <div className="panel">
          <h3>Enlaces</h3>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Cliente</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.clientCompany || r.clientName}</b><br /><span className="muted">{r.ruc ? `RUC ${r.ruc} · ` : ""}{r.contactName || r.clientName}{r.accessCode ? ` · clave ${r.accessCode}` : ""}</span></td>
                    <td>{formatWhen(r.expiresAt)}</td>
                    <td>{STATUS[r.status] || (r.live ? "Activo" : "Vencido")}</td>
                    <td>
                      <button className="link-btn" type="button" onClick={() => open(r.id)}>Ver actividad</button>
                      {" "}
                      {r.status === "activo" ? <button className="link-btn" type="button" onClick={() => navigator.clipboard?.writeText(shareInvite(r))}>Copiar</button> : null}
                      {" "}
                      {r.status === "activo" && r.clientPhone ? <a className="link-btn" href={shareWhatsApp(r)} target="_blank" rel="noreferrer">Enviar clave</a> : null}
                      {" "}
                      {r.status === "activo" ? <button className="link-btn" type="button" onClick={() => suspend(r.id)}>Suspender</button> : null}
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
          {!detail ? <p className="section-sub">Elige un enlace para ver cuándo entró, desde qué IP y qué miró.</p> : (
            <>
              <p className="section-sub">
                {detail.clientCompany} · {detail.contactName} · {detail.clientEmail}
                <br />
                {shareUrl(detail.token)} · clave {detail.accessCode || "—"} · {STATUS[detail.status] || ""} · vence {formatWhen(detail.expiresAt)}
                <br />
                WhatsApp comercial {detail.vendorWhatsapp}
              </p>
              <ShareMetrics metrics={detail.metrics} />
              <ul className="dash-list">
                {(detail.events || []).map((e) => (
                  <li key={e.id}>
                    <b>{KIND[e.kind] || e.kind}{e.iso ? ` · ${e.iso}` : ""}{e.detail?.q ? ` · ${e.detail.q}` : ""}{e.detail?.slot != null && e.kind === "view_image" ? ` · foto ${Number(e.detail.slot) + 1}` : ""}</b>
                    <span>{formatWhen(e.at)}{e.device ? ` · ${e.device}` : ""}{e.ip ? ` · ${e.ip}` : ""}</span>
                  </li>
                ))}
                {!detail.events?.length ? <li className="muted">El cliente aún no abrió el enlace.</li> : null}
              </ul>
            </>
          )}
          {openId && detail ? (
            <p className="section-sub" style={{ marginTop: 10 }}>
              <button className="btn-ghost" type="button" onClick={() => { setOpenId(""); setDetail(null); }}>Cerrar</button>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
