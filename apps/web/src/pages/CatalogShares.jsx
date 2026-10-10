import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUrl, formatWhen, APP_ROOT } from "../api.js";
import { whatsappDigits } from "../catalog-copy.js";
import { useAuth } from "../auth.jsx";
import { downloadCommercialMedia } from "./CommercialSend.jsx";

const HOURS = Array.from({ length: 10 }, (_, i) => (i + 1) * 24);
const LINK_PAGE = 4;
const KIND = {
  open: "Abrió el catálogo",
  view_unit: "Vio un DRY",
  view_image: "Vio una imagen",
  filter: "Usó un filtro",
  whatsapp: "WhatsApp",
  cart: "Carrito",
  search: "Búsqueda",
};
const STATUS = { activo: "Activo", suspendido: "Suspendido", vencido: "Vencido", archivado: "Archivado" };

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

function ShareActivity({ detail, picked, onPick }) {
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
            <button className={`share-bar-row share-pick ${picked === u.iso ? "on" : ""}`} type="button" key={`v-${u.iso}`} onClick={() => onPick?.(u.iso)}>
              <b>{u.iso}</b>
              <div className="share-bar"><span style={{ width: `${Math.max(8, ((u.views || u.count || 0) / viewsMax) * 100)}%` }} /></div>
              <span>{u.views || u.count || 0}</span>
            </button>
          ))}
        </div>
      ) : <p className="muted">Todavía no abre fichas.</p>}
      <b>Precio de lista de lo que revisa</b>
      {units.length ? (
        <div className="share-bars">
          {units.map((u) => (
            <button className={`share-bar-row share-pick ${picked === u.iso ? "on" : ""}`} type="button" key={`p-${u.iso}`} onClick={() => onPick?.(u.iso)}>
              <b>{u.iso}</b>
              <div className="share-bar price"><span style={{ width: `${u.priceList ? Math.max(8, (Number(u.priceList) / priceMax) * 100) : 0}%` }} /></div>
              <span>{usd(u.priceList)}</span>
            </button>
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
        <button className={`share-unit share-pick ${picked === u.iso ? "on" : ""}`} type="button" key={`m-${u.iso}`} onClick={() => onPick?.(u.iso)}>
          <b>{u.iso}</b> {u.type ? `· ${u.type}` : ""} {u.cat ? `· ${u.cat}` : ""} · {usd(u.priceList)}
          <p>{u.views || 0} aperturas · vuelve {u.returns || 0} · {u.images || 0} fotos ({u.distinctImages || 0} distintas)</p>
          {(u.places || []).map((place, i) => (
            <p key={`${u.iso}-${i}`}>{place.ip || "sin IP"} · {place.device || "dispositivo"}{place.client ? ` · ${place.client}` : ""}</p>
          ))}
        </button>
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

function UnitBrief({ unit, error }) {
  const [slot, setSlot] = useState(unit?.photos?.[0] ?? 0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  useEffect(() => {
    setSlot(unit?.photos?.[0] ?? (unit?.hasVideo ? "video" : 0));
  }, [unit?.iso]);
  if (error) return <p className="err">{error}</p>;
  if (!unit) return <p className="section-sub">Elige un equipo de la actividad para ver las fotos que vio el cliente, el dato ya sincronizado y el margen de negociación.</p>;
  const version = unit.mediaVersion;
  const photo = (n) => `${apiUrl(`/catalog/${unit.iso}/photos/${n}`)}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
  return (
    <>
      <h3 style={{ marginTop: 0 }}>{unit.typeLabel} · {unit.iso}</h3>
      <p className="section-sub">{unit.catLabel} · {unit.depotName} · {unit.status}</p>
      <div className="share-brief-main">
        {slot === "video" && unit.hasVideo ? (
          <video src={`${apiUrl(`/catalog/${unit.iso}/video`)}${version ? `?v=${encodeURIComponent(version)}` : ""}`} controls />
        ) : unit.photos?.includes(slot) ? (
          <img src={photo(slot)} alt={`${unit.iso} foto ${slot + 1}`} />
        ) : <span className="muted">Sin foto aprobada</span>}
      </div>
      <div className="share-brief-photos">
        {(unit.photos || []).map((n) => (
          <button key={n} type="button" className={slot === n ? "on" : ""} onClick={() => setSlot(n)}>
            <img src={photo(n)} alt={`Foto ${n + 1}`} />
          </button>
        ))}
        {unit.hasVideo ? <button type="button" className={slot === "video" ? "on" : ""} onClick={() => setSlot("video")}>360°</button> : null}
      </div>
      <table className="spec-table">
        <tbody>
          <tr><td>Fabricante</td><td>{unit.manufacturer}</td></tr>
          <tr><td>Año</td><td>{unit.year || "—"}</td></tr>
          <tr><td>Tara / MGW</td><td>{unit.tareKg || "—"} / {unit.mgwKg || "—"} kg</td></tr>
          <tr><td>Color</td><td>{unit.color || "—"}</td></tr>
          <tr><td>Precio de lista</td><td>{usd(unit.priceList)}</td></tr>
          <tr><td>Mínimo</td><td>{usd(unit.priceMin)}</td></tr>
          <tr><td>Margen para negociar</td><td>{usd(unit.margin)}</td></tr>
        </tbody>
      </table>
      <p className="field-hint">Dato ya sincronizado de Odoo, sin volver a consultarlo. {unit.odooDescription || "Sin descripción guardada."}</p>
      <button
        className="btn-ghost"
        type="button"
        disabled={downloading}
        onClick={async () => {
          setDownloadError("");
          setDownloading(true);
          try {
            await downloadCommercialMedia(unit.iso);
          } catch (err) {
            setDownloadError(err.message);
          } finally {
            setDownloading(false);
          }
        }}
      >
        {downloading ? "Preparando descarga…" : "Descargar fotos y video"}
      </button>
      {downloadError ? <p className="err">{downloadError}</p> : null}
      <p className="field-hint">El archivo es para subirlo a mano en WhatsApp. El chat no puede llevar las fotos solo.</p>
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
  const waEdited = useRef(false);
  const [archivedView, setArchivedView] = useState(false);
  const [renewHours, setRenewHours] = useState(72);
  const [linkPage, setLinkPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [pickedIso, setPickedIso] = useState("");
  const [pickedUnit, setPickedUnit] = useState(null);
  const [pickedError, setPickedError] = useState("");
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

  async function load(archived = archivedView) {
    const list = await api(`/catalog-shares${archived ? "?archived=1" : ""}`);
    setRows(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    setLinkPage(1);
    load(archivedView).catch((e) => setError(e.message));
  }, [archivedView]);

  useEffect(() => {
    if (!pickedIso) {
      setPickedUnit(null);
      setPickedError("");
      return;
    }
    let cancelled = false;
    api(`/catalog/commercial/${pickedIso}`)
      .then((unit) => { if (!cancelled) { setPickedUnit(unit); setPickedError(""); } })
      .catch((e) => { if (!cancelled) { setPickedUnit(null); setPickedError(e.message); } });
    return () => { cancelled = true; };
  }, [pickedIso]);

  useEffect(() => {
    const saved = String(user?.whatsapp || "").trim();
    if (!saved || waEdited.current) return;
    setForm((cur) => (cur.vendorWhatsapp === saved ? cur : { ...cur, vendorWhatsapp: saved }));
  }, [user?.whatsapp]);

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

  async function renew(id) {
    setError("");
    try {
      const row = await api(`/catalog-shares/${id}/renew`, { method: "POST", body: { hours: renewHours } });
      setMsg(row.status === "activo"
        ? `Enlace de ${row.clientCompany || row.clientName} vigente hasta ${formatWhen(row.expiresAt)}.`
        : "Enlace actualizado.");
      await load(false);
      setArchivedView(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function archive(id) {
    if (!window.confirm("¿Archivar este enlace? Deja de funcionar y sale de la lista de trabajo.")) return;
    setError("");
    try {
      await api(`/catalog-shares/${id}/archive`, { method: "POST" });
      setMsg("Enlace archivado.");
      if (openId === id) setDetail(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function open(id) {
    setOpenId(id);
    setPickedIso("");
    try {
      setDetail(await api(`/catalog-shares/mine/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(row) {
    setEditing({
      id: row.id,
      contactName: row.contactName || row.clientName || "",
      clientPhone: row.clientPhone || "",
      clientEmail: row.clientEmail || "",
      clientNote: row.clientNote || "",
      vendorWhatsapp: row.vendorWhatsapp || "",
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError("");
    try {
      const row = await api(`/catalog-shares/${editing.id}/edit`, { method: "POST", body: editing });
      setMsg(`Enlace de ${row.clientCompany || row.clientName} actualizado.`);
      setEditing(null);
      if (openId === row.id) setDetail(await api(`/catalog-shares/mine/${row.id}`));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const linkPages = Math.max(1, Math.ceil(rows.length / LINK_PAGE));
  const safePage = Math.min(linkPage, linkPages);
  const pageRows = rows.slice((safePage - 1) * LINK_PAGE, safePage * LINK_PAGE);

  return (
    <>
      <h2 className="section-title">Enlaces de catálogo</h2>
      <p className="section-sub">
        Validas el RUC en SUNAT, indicas a la persona que verá el catálogo y el WhatsApp del comercial. La vigencia va de 24 a 240 horas. Un enlace vigente se puede extender; uno vencido se reactiva con las mismas horas. Archivar lo saca de la lista y lo deja inutilizable. Puedes corregir el contacto de un enlace ya creado. Cada cliente tiene un solo enlace activo, y ese enlace solo permanece abierto en un lugar: si entra en otro, la sesión anterior se cierra.
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
          <div>
            <label>WhatsApp del comercial</label>
            <input
              value={form.vendorWhatsapp}
              onChange={(e) => { waEdited.current = true; setForm({ ...form, vendorWhatsapp: e.target.value }); }}
              required
              placeholder="51 9XX XXX XXX"
            />
            <p className="field-hint">{user?.whatsapp ? "Sale del WhatsApp de tu perfil. Puedes cambiarlo solo para este enlace." : "Regístralo en Mi perfil para que se complete solo. Aquí puedes escribirlo o corregirlo."}</p>
          </div>
          <div><label>Nota</label><input value={form.clientNote} onChange={(e) => setForm({ ...form, clientNote: e.target.value })} placeholder="Opcional" /></div>
          <button className="btn-primary" type="submit" disabled={Boolean(sunat?.activeShare)}>Generar enlace</button>
        </form>
      </div>

      <div className="share-board">
        <div className="share-stack">
        <div className="panel">
          <div className="odoo-toolbar">
            <h3 style={{ margin: 0 }}>Enlaces</h3>
            <Link className="btn-ghost" to={{ pathname: "/", search: "?vista=comercial" }}>Ver catálogo comercial</Link>
            <button className="btn-ghost" type="button" onClick={() => setArchivedView((v) => !v)}>
              {archivedView ? "Ver vigentes" : "Ver archivados"}
            </button>
            {archivedView ? null : (
              <label className="stock-sort" style={{ textTransform: "none", letterSpacing: 0 }}>
                Horas al extender
                <select value={renewHours} onChange={(e) => setRenewHours(Number(e.target.value))} aria-label="Horas para extender o reactivar">
                  {HOURS.map((h) => <option key={h} value={h}>{h} h</option>)}
                </select>
              </label>
            )}
          </div>
          {editing ? (
            <form className="form-grid" onSubmit={saveEdit}>
              <div><label>Persona que verá el catálogo</label><input value={editing.contactName} onChange={(e) => setEditing({ ...editing, contactName: e.target.value })} required /></div>
              <div><label>Teléfono del contacto</label><input value={editing.clientPhone} onChange={(e) => setEditing({ ...editing, clientPhone: e.target.value })} required /></div>
              <div><label>Correo del contacto</label><input type="email" value={editing.clientEmail} onChange={(e) => setEditing({ ...editing, clientEmail: e.target.value })} required /></div>
              <div><label>WhatsApp del comercial</label><input value={editing.vendorWhatsapp} onChange={(e) => setEditing({ ...editing, vendorWhatsapp: e.target.value })} required /></div>
              <div><label>Nota</label><input value={editing.clientNote} onChange={(e) => setEditing({ ...editing, clientNote: e.target.value })} /></div>
              <div className="action-row">
                <button className="btn-primary" type="submit">Guardar enlace</button>
                <button className="btn-ghost" type="button" onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            </form>
          ) : null}
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Cliente</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className={openId === r.id ? "share-row-on" : ""}>
                    <td>
                      <button className="share-client" type="button" onClick={() => open(r.id)}>
                        <b>{r.clientCompany || r.clientName}</b><br /><span className="muted">{r.ruc ? `RUC ${r.ruc} · ` : ""}{r.contactName || r.clientName}{r.accessCode ? ` · clave ${r.accessCode}` : ""}</span>
                      </button>
                    </td>
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
                        {r.status === "activo" || r.status === "vencido" ? (
                          <button className="btn-ghost" type="button" onClick={() => renew(r.id)}>
                            {r.status === "vencido" ? "Reactivar" : "Extender"}
                          </button>
                        ) : null}
                        {r.status === "archivado" ? null : (
                          <button className="btn-ghost" type="button" onClick={() => startEdit(r)}>Editar</button>
                        )}
                        {r.status === "archivado" ? null : (
                          <button className="btn-ghost" type="button" onClick={() => archive(r.id)}>Archivar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={4}>{archivedView ? "No hay enlaces archivados." : "Aún no hay enlaces. Genera el primero para un cliente."}</td></tr> : null}
              </tbody>
            </table>
          </div>
          {rows.length > LINK_PAGE ? (
            <div className="share-pager">
              <button className="btn-ghost" type="button" disabled={safePage <= 1} onClick={() => setLinkPage(safePage - 1)}>Anterior</button>
              <span>Página {safePage} de {linkPages}</span>
              <button className="btn-ghost" type="button" disabled={safePage >= linkPages} onClick={() => setLinkPage(safePage + 1)}>Siguiente</button>
            </div>
          ) : null}
        </div>
        <div className="panel">
          <UnitBrief unit={pickedUnit} error={pickedError} />
        </div>
        </div>
        <div className="panel">
          <h3>{detail ? `Actividad · ${detail.clientName}` : "Actividad del cliente"}</h3>
          <div className="share-scroll">
            <ShareActivity detail={detail} picked={pickedIso} onPick={setPickedIso} />
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
