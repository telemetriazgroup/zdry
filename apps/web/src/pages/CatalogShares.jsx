import { useEffect, useRef, useState } from "react";
import { api, apiUpload, apiUrl, formatWhen, APP_ROOT, publicUrl } from "../api.js";
import { whatsappDigits } from "../catalog-copy.js";
import { hasRole, isSuperadmin, useAuth } from "../auth.jsx";
import { downloadCommercialMedia } from "./CommercialSend.jsx";
import { whatsappQueued } from "../salida-notice.js";
import { useNotice } from "../notice.jsx";

const HOURS = Array.from({ length: 10 }, (_, i) => (i + 1) * 24);
const LINK_PAGE = 3;
const CONTACT_PREVIEW = 2;

function pickContacts(contacts, query, pickedId) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    const picked = pickedId ? contacts.find((row) => row.id === pickedId) : null;
    const rest = picked ? contacts.filter((row) => row.id !== picked.id) : contacts;
    const shown = (picked ? [picked, ...rest] : contacts).slice(0, CONTACT_PREVIEW);
    return { shown, matched: contacts.length };
  }
  const matched = contacts.filter((row) => [row.name, row.role, row.phone, row.email].join(" ").toLowerCase().includes(q));
  return { shown: matched.slice(0, CONTACT_PREVIEW), matched: matched.length };
}
const KIND = {
  open: "Abrió el catálogo",
  view_unit: "Vio un DRY",
  view_image: "Vio una imagen",
  filter: "Usó un filtro",
  whatsapp: "WhatsApp",
  return: "Volvió a pedir el catálogo",
  interest: "Pidió información de un equipo",
  email_taken: "El correo ya está registrado",
  cart: "Carrito",
  search: "Búsqueda",
};
const STATUS = { activo: "Activo", suspendido: "Suspendido", vencido: "Vencido", archivado: "Archivado" };
const FOLLOW_KIND = {
  telefono: "Teléfono",
  correo: "Correo",
  whatsapp: "WhatsApp",
  nota: "Nota",
  precio: "Precio",
  descuento: "Precio con descuento",
  cotizacion: "Cotización",
};

function usd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Sin precio";
  return `USD ${Math.round(n).toLocaleString("en-US")}`;
}

function ShareActivity({ detail, picked, onPick, asked }) {
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
              <b>{u.iso}{asked?.has(u.iso) ? " · pidió precio" : ""}</b>
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

const ASK_STATUS = {
  abierto: "El cliente pidió precio. Puedes enviarle el de lista o uno dentro del rango.",
  esperando_contacto: "El cliente pidió que lo contactes.",
  cotizacion_pedida: "El cliente pidió la cotización.",
  cerrado: "Este hilo ya está cerrado.",
};

function PriceAsk({ thread, onSent }) {
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!thread) return <p className="field-hint">Este equipo no tiene una solicitud de precio.</p>;
  async function send(body) {
    setBusy(true);
    setError("");
    try {
      const next = await api(`/commercial/hilos/${thread.id}/precio`, { method: "POST", body });
      setPrice("");
      onSent?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="share-price-ask">
      <b>Solicitud de precio · {thread.iso}</b>
      <p className="section-sub">{ASK_STATUS[thread.status] || thread.status}{thread.priceNet != null ? ` Precio enviado: ${usd(thread.priceNet)}.` : ""}</p>
      <p className="field-hint">Lista {usd(thread.priceList)} · mínimo {usd(thread.priceMin)}{thread.margin != null ? ` · margen ${usd(thread.margin)}` : ""}</p>
      {thread.status === "abierto" ? (
        <div className="action-row">
          <button className="btn-primary" type="button" disabled={busy} onClick={() => send({ useList: true })}>Enviar precio de lista</button>
          <form className="share-price-form" onSubmit={(event) => { event.preventDefault(); send({ price: Number(price) }); }}>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Otro precio neto" aria-label="Otro precio neto" />
            <button className="btn-ghost" type="submit" disabled={busy || price === ""}>Enviar este precio</button>
          </form>
        </div>
      ) : null}
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}

function showPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("51") && digits.length === 11) return `+51 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return digits ? `+${digits}` : "";
}

function shareInvite(row) {
  if (row.invite) return row.invite;
  const name = row.contactName || row.clientName || "cliente";
  const vendor = String(row.vendorName || "").trim();
  const vendorPhone = showPhone(row.vendorWhatsapp);
  const hours = Number(row.hours) === 1 ? "1 hora" : `${row.hours} horas`;
  return [
    "*ZGROUP*",
    "ZGROUP te saluda.",
    "",
    `Hola ${name}, tu catálogo de equipos ya está listo. ${vendor ? `${vendor} queda a cargo de tu atención.` : "Un comercial de ZGROUP queda a cargo de tu atención."}`,
    "",
    "*Tu catálogo*",
    shareUrl(row.token),
    `Clave de acceso: *${row.accessCode}*`,
    `Vigencia: ${hours}`,
    "",
    "*Tu comercial*",
    vendor || "Comercial ZGROUP",
    vendorPhone ? `WhatsApp: ${vendorPhone}` : "Si quieres llamarlo, pide el número en portería.",
    "Si quieres ver los equipos o resolver una duda, escríbele directo a ese número.",
  ].join("\n");
}

function splitPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("51") && digits.length > 8) return { prefix: "51", local: digits.slice(2) };
  return { prefix: "51", local: digits };
}

function PhoneFields({ prefix, local, onPrefix, onLocal, label }) {
  return (
    <div className="phone-pair">
      <div>
        <label>Prefijo</label>
        <input
          value={prefix}
          onChange={(e) => onPrefix(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          aria-label="Prefijo del celular"
          required
        />
      </div>
      <div>
        <label>{label}</label>
        <input value={local} onChange={(e) => onLocal(e.target.value)} inputMode="tel" aria-label={label} required placeholder="999 111 222" />
      </div>
      <p className="field-hint">51 es Perú. Cámbialo si el celular es de otro país.</p>
    </div>
  );
}

function shareWhatsApp(row) {
  const phone = whatsappDigits(row.clientPhone);
  return `https://wa.me/${phone}?text=${encodeURIComponent(shareInvite(row))}`;
}

function shareUrl(token) {
  const base = `${window.location.origin}${APP_ROOT === "/" ? "" : APP_ROOT.replace(/\/$/, "")}`;
  return `${base}/c/${token}`;
}

function xmlEsc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function workbookSheet(name, headers, lines) {
  const cells = (vals) => vals.map((v) => `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`).join("");
  const body = lines.map((line) => `<Row>${cells(line)}</Row>`).join("");
  return `<Worksheet ss:Name="${xmlEsc(name)}"><Table><Row>${cells(headers)}</Row>${body}</Table></Worksheet>`;
}

function downloadWorkbook(filename, sheets) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheets.join("\n")}
</Workbook>`;
  const url = URL.createObjectURL(new Blob([xml], { type: "application/vnd.ms-excel" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function shareBlob(row) {
  return [row.clientCompany, row.clientName, row.contactName, row.ruc, row.dni, row.clientEmail, row.clientPhone, row.vendorName].join(" ").toLowerCase();
}

function filterShares(list, origin, query) {
  const q = String(query || "").trim().toLowerCase();
  return list.filter((row) => {
    if (origin !== "todos" && (row.source || "comercial") !== origin) return false;
    if (!q) return true;
    return shareBlob(row).includes(q);
  });
}

function pageWindow(current, total) {
  const width = 5;
  const start = Math.max(1, Math.min(current - 2, total - width + 1));
  const end = Math.min(total, start + width - 1);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);
}

export default function CatalogShares() {
  const { user } = useAuth();
  const { notify, toastNode } = useNotice();
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState("");
  const [follow, setFollow] = useState(null);
  const [log, setLog] = useState({ channel: "telefono", body: "", priceNet: "" });
  const [saleName, setSaleName] = useState("");
  const [vendorQuery, setVendorQuery] = useState("");
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [created, setCreated] = useState(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const avisoTold = useRef("");
  const [lookup, setLookup] = useState(null);
  const [contactChoice, setContactChoice] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [rucDraft, setRucDraft] = useState(null);
  const waEdited = useRef(false);
  const [archivedView, setArchivedView] = useState(false);
  const [extendAsk, setExtendAsk] = useState(null);
  const [extendHours, setExtendHours] = useState(24);
  const [renewing, setRenewing] = useState(false);
  const [linkPage, setLinkPage] = useState(1);
  const [origin, setOrigin] = useState("todos");
  const [query, setQuery] = useState("");
  const [vendors, setVendors] = useState([]);
  const [exporting, setExporting] = useState(false);
  const canExternal = hasRole(user, "admin", "vendedor", "ejecutivo");
  const canAssign = hasRole(user, "admin", "ejecutivo");
  const canArchive = isSuperadmin(user);
  const [editing, setEditing] = useState(null);
  const [pickedIso, setPickedIso] = useState("");
  const [pickedUnit, setPickedUnit] = useState(null);
  const [pickedError, setPickedError] = useState("");
  const [shareThreads, setShareThreads] = useState([]);
  const [offerThread, setOfferThread] = useState(null);
  const briefRef = useRef(null);
  const emptyIdentity = {
    ruc: "",
    dni: "",
    firstName: "",
    lastName: "",
    clientCompany: "",
    street: "",
    district: "",
    province: "",
    department: "",
    sunatState: "",
    sunatCondition: "",
    customerId: "",
    odooPartnerId: "",
    odooContactId: "",
    contactName: "",
    phonePrefix: "51",
    phoneLocal: "",
    clientEmail: "",
    clientNote: "",
    contacts: [],
  };
  const [form, setForm] = useState({
    docKind: "ruc",
    ...emptyIdentity,
    vendorId: "",
    vendorWhatsapp: canAssign ? "" : (user?.whatsapp || ""),
    hours: 72,
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
    if (!detail?.id) {
      setShareThreads([]);
      return undefined;
    }
    let cancelled = false;
    api("/commercial/hilos")
      .then((list) => {
        if (!cancelled) setShareThreads((Array.isArray(list) ? list : []).filter((row) => row.shareId === detail.id));
      })
      .catch(() => { if (!cancelled) setShareThreads([]); });
    return () => { cancelled = true; };
  }, [detail?.id]);

  useEffect(() => {
    const match = shareThreads.find((row) => row.iso === pickedIso && row.status !== "cerrado") || shareThreads.find((row) => row.iso === pickedIso);
    if (!pickedIso || !match) {
      setOfferThread(null);
      return undefined;
    }
    let cancelled = false;
    api(`/commercial/hilos/${match.id}`)
      .then((row) => { if (!cancelled) setOfferThread(row); })
      .catch(() => { if (!cancelled) setOfferThread(null); });
    return () => { cancelled = true; };
  }, [pickedIso, shareThreads]);

  useEffect(() => {
    if (!pickedIso || !briefRef.current) return;
    briefRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pickedIso, pickedUnit]);

  useEffect(() => {
    if (canAssign) return;
    const saved = String(user?.whatsapp || "").trim();
    if (!saved || waEdited.current) return;
    setForm((cur) => (cur.vendorWhatsapp === saved ? cur : { ...cur, vendorWhatsapp: saved }));
  }, [user?.whatsapp, canAssign]);

  useEffect(() => {
    if (!canAssign) return;
    api("/catalog-shares/vendors").then((list) => setVendors(Array.isArray(list) ? list : [])).catch(() => setVendors([]));
  }, [canAssign]);

  useEffect(() => {
    const id = created?.id;
    if (!id) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const aviso = await api(`/catalog-shares/${id}/aviso`);
        if (stop || !aviso?.done || avisoTold.current === id) return;
        avisoTold.current = id;
        stop = true;
        if (aviso.text) notify(aviso.text, aviso.ok ? "ok" : "err");
        setCreated((cur) => (cur && cur.id === id ? { ...cur, aviso } : cur));
      } catch {
        /* el siguiente intento vuelve a preguntar */
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    const giveUp = setTimeout(() => { stop = true; clearInterval(timer); }, 70000);
    return () => { stop = true; clearInterval(timer); clearTimeout(giveUp); };
  }, [created?.id]);

  function clearContactFields(extra = {}) {
    setForm((cur) => ({
      ...cur,
      odooContactId: "",
      contactName: "",
      firstName: "",
      lastName: "",
      phonePrefix: "51",
      phoneLocal: "",
      clientEmail: "",
      ...extra,
    }));
  }

  function applyContact(contact) {
    if (!contact) return;
    const phone = splitPhone(contact.phone || "");
    const parts = String(contact.name || "").trim().split(/\s+/);
    setContactChoice("assimilated");
    setForm((cur) => ({
      ...cur,
      odooContactId: contact.id || "",
      contactName: contact.name || "",
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" "),
      phonePrefix: contact.phone ? phone.prefix : "51",
      phoneLocal: contact.phone ? phone.local : "",
      clientEmail: contact.email || "",
    }));
  }

  function useOtherContact() {
    setContactChoice("other");
    clearContactFields();
  }

  function applyLookup(found) {
    const contacts = found.contacts || [];
    setLookup(found);
    setContactQuery("");
    setContactChoice(contacts.length ? "" : "other");
    setForm((cur) => ({
      ...cur,
      ruc: found.ruc || cur.ruc,
      dni: found.dni || cur.dni,
      clientCompany: found.companyName || "",
      street: found.street || "",
      district: found.district || "",
      province: found.province || "",
      department: found.department || "",
      sunatState: found.sunatState || "",
      sunatCondition: found.sunatCondition || "",
      customerId: found.customerId || "",
      odooPartnerId: found.odooPartnerId || "",
      odooContactId: "",
      contactName: "",
      firstName: "",
      lastName: "",
      phonePrefix: "51",
      phoneLocal: "",
      clientEmail: "",
      contacts,
    }));
  }

  async function lookupClient() {
    setError("");
    setMsg("");
    setLooking(true);
    try {
      const found = form.docKind === "dni"
        ? await api("/catalog-shares/dni", { method: "POST", body: { dni: form.dni } })
        : await api("/catalog-shares/ruc", { method: "POST", body: { ruc: form.ruc } });
      applyLookup(found);
      const who = found.companyName || found.contactName || "El cliente";
      if (found.activeShare) {
        setMsg(`${who} ya tiene un enlace activo. Suspéndelo para crear otro.`);
      } else if (form.docKind === "dni" && found.inOdoo) {
        setMsg(`${who} ya está en contactos. Confirma si asimilas ese contacto o escribes otro. El RUC queda pendiente.`);
      } else if (form.docKind === "dni") {
        setMsg("Ese DNI no está en contactos. Completa nombres, apellidos, correo y celular. El enlace queda en ZDRY, sin contacto en Odoo, y el RUC queda pendiente.");
      } else if (found.inOdoo) {
        setMsg(found.contacts?.length
          ? `${who} está en contactos de Odoo. Elige qué contacto asimilar para el enlace, o escribe otro.`
          : `${who} está en Odoo y no tiene un contacto. Indica la persona: se crea al generar el enlace.`);
      } else {
        setMsg(`${who} no está en contactos. SUNAT devolvió la razón social. Al generar el enlace se crea la empresa y el contacto en Odoo.`);
      }
    } catch (err) {
      setLookup(null);
      setContactQuery("");
      setError(err.message);
    } finally {
      setLooking(false);
    }
  }

  async function create(e) {
    e.preventDefault();
    if (saving) return;
    setError("");
    setMsg("");
    setSaving(true);
    try {
      const row = await api("/catalog-shares", { method: "POST", body: form });
      let copied = false;
      try {
        await navigator.clipboard?.writeText(shareInvite(row));
        copied = true;
      } catch {
        copied = false;
      }
      setCreated({ ...row, copied });
      setLookup(null);
      setContactChoice("");
      setContactQuery("");
      setForm({
        ...form,
        ...emptyIdentity,
        phonePrefix: "51",
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
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

  async function renew(id, hours) {
    setError("");
    setRenewing(true);
    try {
      const row = await api(`/catalog-shares/${id}/renew`, { method: "POST", body: { hours } });
      setMsg(row.status === "activo"
        ? `Enlace de ${row.clientCompany || row.clientName} vigente ${hours} horas, hasta ${formatWhen(row.expiresAt)}.`
        : "Enlace actualizado.");
      setExtendAsk(null);
      await load(false);
      setArchivedView(false);
      if (openId === id) setDetail(await api(`/catalog-shares/mine/${id}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setRenewing(false);
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
      setFollow(await api(`/catalog-shares/${id}/seguimiento`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function reloadFollow(id) {
    setFollow(await api(`/catalog-shares/${id}/seguimiento`));
  }

  async function saveLog(event) {
    event.preventDefault();
    if (!detail) return;
    setError("");
    try {
      const note = await api(`/catalog-shares/${detail.id}/seguimiento`, {
        method: "POST",
        body: { channel: log.channel, body: log.body, priceNet: log.priceNet === "" ? undefined : Number(log.priceNet) },
      });
      const file = event.target.elements.foto?.files?.[0];
      if (file) {
        const data = new FormData();
        data.append("file", file);
        await apiUpload(`/catalog-shares/${detail.id}/seguimiento/${note.id}/foto`, data);
        event.target.elements.foto.value = "";
      }
      setLog({ channel: log.channel, body: "", priceNet: "" });
      setMsg("El seguimiento quedó en la bitácora.");
      await reloadFollow(detail.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function linkSale(event) {
    event.preventDefault();
    if (!detail) return;
    setError("");
    try {
      const row = await api(`/catalog-shares/${detail.id}/cotizacion`, { method: "POST", body: { saleName } });
      setSaleName("");
      setMsg(`Cotización ${row.quote?.odooSaleName || saleName} asimilada en ZDRY como ${row.quote?.number || ""}.`);
      await reloadFollow(detail.id);
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(row) {
    const phone = splitPhone(row.clientPhone || "");
    setEditing({
      id: row.id,
      contactName: row.contactName || row.clientName || "",
      phonePrefix: phone.prefix,
      phoneLocal: phone.local,
      clientEmail: row.clientEmail || "",
      clientNote: row.clientNote || "",
      vendorWhatsapp: row.vendorWhatsapp || "",
    });
  }

  async function savePendingRuc(e) {
    e.preventDefault();
    setError("");
    try {
      const row = await api(`/catalog-shares/${rucDraft.id}/add-ruc`, { method: "POST", body: { ruc: rucDraft.ruc } });
      setMsg(`RUC ${row.ruc} validado para ${row.clientCompany || row.clientName}.`);
      setRucDraft(null);
      if (openId === row.id) setDetail(await api(`/catalog-shares/mine/${row.id}`));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError("");
    try {
      const local = String(editing.phoneLocal || "").replace(/\D/g, "");
      const prefix = String(editing.phonePrefix || "51").replace(/\D/g, "") || "51";
      const clientPhone = local.startsWith(prefix) && local.length > prefix.length + 5 ? local : `${prefix}${local}`;
      const row = await api(`/catalog-shares/${editing.id}/edit`, { method: "POST", body: { ...editing, clientPhone } });
      setMsg(`Enlace de ${row.clientCompany || row.clientName} actualizado.`);
      setEditing(null);
      if (openId === row.id) setDetail(await api(`/catalog-shares/mine/${row.id}`));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const originRows = filterShares(rows, origin, query);
  const linkPages = Math.max(1, Math.ceil(originRows.length / LINK_PAGE));
  const safePage = Math.min(linkPage, linkPages);
  const pageRows = originRows.slice((safePage - 1) * LINK_PAGE, safePage * LINK_PAGE);
  const pages = pageWindow(safePage, linkPages);
  const gateUrl = `${window.location.origin}${APP_ROOT === "/" ? "" : APP_ROOT.replace(/\/$/, "")}/acceso`;

  function chooseVendor(id) {
    const vendor = vendors.find((item) => item.id === id);
    waEdited.current = false;
    setVendorQuery("");
    setForm((cur) => ({ ...cur, vendorId: id, vendorWhatsapp: vendor?.whatsapp || "" }));
  }

  const vendorMatches = vendors.filter((vendor) => vendor.name.toLowerCase().includes(vendorQuery.trim().toLowerCase())).slice(0, 8);
  const chosenVendor = vendors.find((vendor) => vendor.id === form.vendorId);

  async function downloadExcel() {
    setError("");
    setExporting(true);
    try {
      const list = await api(`/catalog-shares/report${archivedView ? "?archived=1" : ""}`);
      const picked = filterShares(Array.isArray(list) ? list : [], origin, query);
      const day = new Date().toISOString().slice(0, 10);
      const links = picked.map((row) => [
        row.clientCompany || row.clientName || "",
        row.ruc || row.dni || "",
        row.contactName || row.clientName || "",
        row.clientEmail || "",
        showPhone(row.clientPhone),
        row.vendorName || "",
        showPhone(row.vendorWhatsapp),
        row.source === "cliente" ? "Cliente" : "Comercial",
        STATUS[row.status] || "",
        formatWhen(row.createdAt),
        formatWhen(row.expiresAt),
        shareUrl(row.token),
        row.accessCode || "",
      ]);
      const activity = picked.flatMap((row) => (row.events || []).map((event) => [
        row.clientCompany || row.clientName || "",
        row.vendorName || "",
        KIND[event.kind] || event.kind || "",
        event.iso || "",
        formatWhen(event.at),
        event.device || "",
        event.ip || "",
      ]));
      downloadWorkbook(`zdry-enlaces-${day}.xls`, [
        workbookSheet("Enlaces", ["Cliente", "Documento", "Contacto", "Correo", "Celular", "Comercial", "WhatsApp comercial", "Origen", "Estado", "Creado", "Vence", "Enlace", "Clave"], links),
        workbookSheet("Actividad", ["Cliente", "Comercial", "Actividad", "Equipo", "Cuándo", "Dispositivo", "IP"], activity),
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const contactView = pickContacts(
    form.contacts,
    contactQuery,
    contactChoice === "assimilated" ? form.odooContactId : "",
  );

  return (
    <>
      <h2 className="section-title">Enlaces de catálogo</h2>
      <p className="section-sub">
        Primero se busca el cliente en los contactos de Odoo. Si ya está, el enlace usa su empresa y su contacto. Con RUC, si no está, se crea al generar el enlace. Si solo mostró DNI, activa esa opción: se piden nombres, apellidos, correo y celular, los datos quedan en ZDRY y no se crea el contacto en Odoo. El RUC se agrega después. La vigencia va de 24 a 240 horas.
      </p>
      {canExternal ? (
        <div className="panel gate-link">
          <h3>Registro externo</h3>
          <p>El cliente abre este enlace y se registra. Con RUC el catálogo dura 3 horas y el contacto se crea en Odoo. Solo con DNI dura 1 hora: los datos quedan en ZDRY, sin contacto en Odoo, hasta que agregues el RUC.</p>
          <div className="gate-link-row">
            <code>{gateUrl}</code>
            <button className="btn-ghost" type="button" onClick={() => navigator.clipboard?.writeText(gateUrl).then(() => setMsg("Enlace de registro externo copiado.")).catch(() => setError("No se pudo copiar."))}>Copiar enlace</button>
            <a className="btn-ghost" href={gateUrl} target="_blank" rel="noreferrer">Abrir</a>
          </div>
        </div>
      ) : null}
      {toastNode}
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {created ? (
        <div className="overlay open" role="dialog" aria-modal="true" aria-labelledby="share-created-title">
          <div className="modal quote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 id="share-created-title">Enlace generado</h3>
              <button className="modal-close" type="button" onClick={() => setCreated(null)} aria-label="Cerrar">×</button>
            </div>
            <div className="modal-body single">
              <p>El enlace de <b>{created.clientCompany || created.clientName}</b> quedó listo para <b>{created.contactName || created.clientName}</b>.</p>
              <p>Clave de acceso</p>
              <p className="share-created-key">{created.accessCode || "—"}</p>
              <p>Vigente {created.hours} horas.</p>
              <p><a href={shareUrl(created.token)} target="_blank" rel="noreferrer">{shareUrl(created.token)}</a></p>
              {created.rucPending ? <p>Quedó en ZDRY, sin contacto en Odoo. Agrega el RUC cuando vayas a cotizar la venta o el alquiler.</p> : null}
              <p className="field-hint">{created.copied ? "El mensaje para el cliente ya está copiado." : "Puedes copiar el mensaje si lo necesitas."} Los WhatsApp y los correos se envían solos. El aviso queda abajo cuando salen.</p>
              <div className="share-created-actions">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(shareInvite(created)).then(() => setCreated({ ...created, copied: true })).catch(() => setError("No se pudo copiar."))}
                >
                  Copiar mensaje
                </button>
                {created.aviso && !created.aviso.ok ? <a className="btn-ghost" href={shareWhatsApp(created)} target="_blank" rel="noreferrer">Enviar por WhatsApp</a> : null}
                <button className="btn-ghost" type="button" onClick={() => setCreated(null)}>Entendido</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Nuevo enlace temporizado</h3>
        <form className="share-new" onSubmit={create}>
          <div className="share-new-row">
            <div className="doc-kind">
              <label>Documento del cliente</label>
              <div className="doc-kind-switch" role="group" aria-label="Documento del cliente">
                <button type="button" className={form.docKind === "ruc" ? "on" : ""} onClick={() => { setLookup(null); setContactChoice(""); setContactQuery(""); setForm({ ...form, ...emptyIdentity, docKind: "ruc" }); }}>RUC</button>
                <button type="button" className={form.docKind === "dni" ? "on" : ""} onClick={() => { setLookup(null); setContactChoice(""); setContactQuery(""); setForm({ ...form, ...emptyIdentity, docKind: "dni" }); }}>Solo DNI</button>
              </div>
            </div>
            <div>
              <label>{form.docKind === "dni" ? "DNI" : "RUC"}</label>
              <div className="share-inline">
                {form.docKind === "dni" ? (
                  <input value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value.replace(/\D/g, "").slice(0, 8) })} required placeholder="8 dígitos" inputMode="numeric" />
                ) : (
                  <input value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })} required placeholder="11 dígitos" inputMode="numeric" />
                )}
                <button className="btn-ghost" type="button" disabled={looking} onClick={lookupClient}>
                  {looking ? "Buscando…" : "Buscar"}
                </button>
              </div>
            </div>
            <div>
              <label>Vigencia</label>
              <select value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{h} horas</option>)}
              </select>
            </div>
          </div>
          {lookup ? (
            <div className="sunat-card">
              <b>{form.clientCompany || form.contactName || (form.docKind === "dni" ? "DNI sin contacto en Odoo" : "Sin razón social")}</b>
              <p>{lookup.inOdoo ? "Encontrado en contactos de Odoo." : form.docKind === "dni" ? "No está en contactos. Se creará al generar el enlace." : "No está en contactos. Los datos salen de SUNAT y se creará en Odoo al generar el enlace."}</p>
              {form.docKind === "ruc" ? <p>{[form.street, form.district, form.province, form.department].filter(Boolean).join(" · ") || "Sin domicilio en la respuesta."}</p> : null}
              {form.docKind === "ruc" && (form.sunatState || form.sunatCondition) ? <p>{form.sunatState || "—"} · {form.sunatCondition || "—"}</p> : null}
            </div>
          ) : null}
          {form.contacts.length ? (
            <div className="contact-pick">
              <b>Contactos en Odoo</b>
              <p>Esta es la información que se asimilaría. El contacto del enlace puede ser otro.</p>
              {form.contacts.length > CONTACT_PREVIEW ? (
                <div className="contact-find">
                  <input
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                    placeholder="Buscar por nombre, celular o correo"
                    aria-label="Buscar contacto"
                  />
                  <p className="field-hint">
                    {contactQuery.trim()
                      ? (contactView.matched
                        ? `${contactView.matched} ${contactView.matched === 1 ? "coincidencia" : "coincidencias"}${contactView.matched > contactView.shown.length ? `. Se muestran ${contactView.shown.length}.` : "."}`
                        : "Ningún contacto coincide.")
                      : `Se muestran ${contactView.shown.length} de ${form.contacts.length}.`}
                  </p>
                </div>
              ) : null}
              {contactView.shown.map((c) => (
                <div key={c.id || c.email || c.name} className={form.odooContactId === c.id && contactChoice === "assimilated" ? "contact-option on" : "contact-option"}>
                  <div>
                    <b>{c.name || "Sin nombre"}</b>
                    {c.role ? <span>{c.role}</span> : null}
                    <span>{c.phone || "Sin celular"}</span>
                    <span>{c.email || "Sin correo"}</span>
                  </div>
                  <button className="btn-ghost" type="button" onClick={() => applyContact(c)}>
                    {form.odooContactId === c.id && contactChoice === "assimilated" ? "Asimilado" : "Asimilar este contacto"}
                  </button>
                </div>
              ))}
              <button className="btn-ghost" type="button" onClick={useOtherContact}>Usar otro contacto</button>
            </div>
          ) : null}
          {contactChoice === "other" ? <p className="field-hint">No se asimila un contacto de Odoo. El que escribas se crea al generar el enlace.</p> : null}
          {contactChoice === "assimilated" ? <p className="field-hint">Se usará el contacto elegido. Puedes corregir el celular o el correo antes de generar.</p> : null}
          <div className="share-new-row">
            {form.docKind === "dni" ? (
              <div className="share-split">
                <div><label>Nombres</label><input value={form.firstName} onChange={(e) => { setContactChoice("other"); setForm({ ...form, firstName: e.target.value, odooContactId: "" }); }} required /></div>
                <div><label>Apellidos</label><input value={form.lastName} onChange={(e) => { setContactChoice("other"); setForm({ ...form, lastName: e.target.value, odooContactId: "" }); }} required /></div>
              </div>
            ) : (
              <div><label>Persona que verá el catálogo</label><input value={form.contactName} onChange={(e) => { setContactChoice("other"); setForm({ ...form, contactName: e.target.value, odooContactId: "" }); }} required placeholder="Nombre del contacto" /></div>
            )}
            <PhoneFields
              prefix={form.phonePrefix}
              local={form.phoneLocal}
              onPrefix={(phonePrefix) => setForm({ ...form, phonePrefix })}
              onLocal={(phoneLocal) => setForm({ ...form, phoneLocal })}
              label="Celular del contacto"
            />
            <div><label>Correo del contacto</label><input type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} required /></div>
          </div>
          <div className="share-new-row">
            {canAssign ? (
              <div>
                <label>Comercial a cargo</label>
                <input value={vendorQuery} onChange={(e) => { setVendorQuery(e.target.value); setForm((cur) => ({ ...cur, vendorId: "" })); }} placeholder={chosenVendor ? chosenVendor.name : "Escribe el nombre"} aria-label="Buscar comercial" required={!form.vendorId} />
                {chosenVendor && !vendorQuery ? <p className="field-hint">Elegido: {chosenVendor.name}. El cliente queda en sus enlaces y se le avisa para el seguimiento.</p> : null}
                {vendorQuery.trim() ? (
                  <div className="action-row">
                    {vendorMatches.map((vendor) => (
                      <button className="btn-ghost" type="button" key={vendor.id} onClick={() => chooseVendor(vendor.id)}>{vendor.name}</button>
                    ))}
                    {!vendorMatches.length ? <p className="field-hint">Ningún comercial coincide.</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div>
              <label>WhatsApp del comercial</label>
              <input
                value={form.vendorWhatsapp}
                onChange={(e) => { waEdited.current = true; setForm({ ...form, vendorWhatsapp: e.target.value }); }}
                required
                placeholder="51 9XX XXX XXX"
              />
            </div>
            <div><label>Nota</label><input value={form.clientNote} onChange={(e) => setForm({ ...form, clientNote: e.target.value })} placeholder="Opcional" /></div>
            {canAssign ? null : (
              <button className="btn-primary" type="submit" disabled={saving || Boolean(lookup?.activeShare) || (form.docKind === "ruc" && !lookup) || (form.contacts.length > 0 && !contactChoice)}>{saving ? "Generando…" : "Generar enlace"}</button>
            )}
          </div>
          {canAssign ? (
            <div className="share-new-actions">
              <p className="field-hint">El seguimiento queda con el comercial elegido. El cliente recibe el WhatsApp y el correo con su nombre y su número.</p>
              <button className="btn-primary" type="submit" disabled={saving || Boolean(lookup?.activeShare) || (form.docKind === "ruc" && !lookup) || (form.contacts.length > 0 && !contactChoice) || !form.vendorId}>{saving ? "Generando…" : "Generar enlace"}</button>
            </div>
          ) : null}
        </form>
      </div>

      <div className="share-board">
        <div className="panel">
          <div className="odoo-toolbar">
            <h3 style={{ margin: 0 }}>Enlaces</h3>
            <div className="doc-kind-switch" role="group" aria-label="Tipo de enlace">
              <button type="button" className={origin === "todos" ? "on" : ""} onClick={() => { setOrigin("todos"); setLinkPage(1); }}>Todos</button>
              <button type="button" className={origin === "comercial" ? "on" : ""} onClick={() => { setOrigin("comercial"); setLinkPage(1); }}>Comercial</button>
              <button type="button" className={origin === "cliente" ? "on" : ""} onClick={() => { setOrigin("cliente"); setLinkPage(1); }}>Cliente</button>
            </div>
            <input className="share-search" value={query} onChange={(e) => { setQuery(e.target.value); setLinkPage(1); }} placeholder="Buscar cliente, RUC, DNI o comercial" aria-label="Buscar enlaces" />
            <button className="btn-ghost" type="button" disabled={exporting} onClick={downloadExcel}>{exporting ? "Preparando Excel…" : "Descargar Excel"}</button>
            <a className="btn-ghost" href={publicUrl("/?vista=comercial")} target="_blank" rel="noreferrer">Ver catálogo comercial</a>
            <a className="btn-ghost" href={publicUrl("/?vista=cliente")} target="_blank" rel="noreferrer">Ver como cliente</a>
            {canArchive ? (
              <button className="btn-ghost" type="button" onClick={() => setArchivedView((v) => !v)}>
                {archivedView ? "Ver vigentes" : "Ver archivados"}
              </button>
            ) : null}
          </div>
          {rucDraft ? (
            <form className="form-grid" onSubmit={savePendingRuc}>
              <div>
                <label>RUC pendiente</label>
                <input value={rucDraft.ruc} onChange={(e) => setRucDraft({ ...rucDraft, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })} required placeholder="11 dígitos" inputMode="numeric" />
              </div>
              <div className="action-row">
                <button className="btn-primary" type="submit">Validar y agregar RUC</button>
                <button className="btn-ghost" type="button" onClick={() => setRucDraft(null)}>Cancelar</button>
              </div>
            </form>
          ) : null}
          {editing ? (
            <form className="form-grid" onSubmit={saveEdit}>
              <div><label>Persona que verá el catálogo</label><input value={editing.contactName} onChange={(e) => setEditing({ ...editing, contactName: e.target.value })} required /></div>
              <PhoneFields
                prefix={editing.phonePrefix}
                local={editing.phoneLocal}
                onPrefix={(phonePrefix) => setEditing({ ...editing, phonePrefix })}
                onLocal={(phoneLocal) => setEditing({ ...editing, phoneLocal })}
                label="Celular del contacto"
              />
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
            <table className="data share-table">
              <thead><tr><th>Cliente</th><th>Comercial</th><th>Vence</th><th>Estado</th></tr></thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className={openId === r.id ? "share-row-on" : ""} onClick={() => open(r.id)}>
                    <td>
                      <button className="share-client" type="button" onClick={() => open(r.id)}>
                        <b>{r.clientCompany || r.clientName}</b> <span className={r.source === "cliente" ? "share-origin cliente" : "share-origin"}>{r.source === "cliente" ? "Cliente" : "Comercial"}</span><br /><span className="muted">{r.ruc ? `RUC ${r.ruc} · ` : ""}{r.dni ? `DNI ${r.dni} · ` : ""}{r.rucPending ? "RUC pendiente · " : ""}{r.contactName || r.clientName}</span>
                      </button>
                    </td>
                    <td>{r.vendorName || "—"}</td>
                    <td>{formatWhen(r.expiresAt)}</td>
                    <td>{STATUS[r.status] || (r.live ? "Activo" : "Vencido")}</td>
                  </tr>
                ))}
                {!originRows.length ? <tr><td colSpan={4}>{archivedView ? "No hay enlaces archivados." : query ? "Ningún enlace coincide con la búsqueda." : origin === "cliente" ? "Todavía no hay enlaces que haya pedido el cliente." : origin === "comercial" ? "No hay enlaces creados por un comercial." : "Aún no hay enlaces. Genera el primero para un cliente."}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="share-pager" aria-label="Páginas de enlaces">
            <button type="button" disabled={safePage <= 1} onClick={() => setLinkPage(safePage - 1)} aria-label="Página anterior">‹</button>
            {pages.map((n) => (
              <button key={n} type="button" className={n === safePage ? "on" : ""} onClick={() => setLinkPage(n)} aria-label={`Página ${n}`} aria-current={n === safePage ? "page" : undefined}>{n}</button>
            ))}
            <button type="button" disabled={safePage >= linkPages} onClick={() => setLinkPage(safePage + 1)} aria-label="Página siguiente">›</button>
          </div>
        </div>
        <div className="panel">
          <h3>Detalle del enlace</h3>
          {detail ? (
            <>
              <p className="section-sub">
                <b>{detail.clientCompany || detail.clientName}</b> · {detail.contactName || detail.clientName}
                {detail.ruc ? ` · RUC ${detail.ruc}` : ""}{detail.dni ? ` · DNI ${detail.dni}` : ""}
                <br />
                Comercial asignado: <b>{detail.vendorName || "—"}</b>{detail.vendorWhatsapp ? ` · ${showPhone(detail.vendorWhatsapp)}` : ""}
                <br />
                {STATUS[detail.status] || ""} · vence {formatWhen(detail.expiresAt)}{detail.accessCode ? ` · clave ${detail.accessCode}` : ""}
                <br />
                <a href={shareUrl(detail.token)} target="_blank" rel="noreferrer">{shareUrl(detail.token)}</a>
              </p>
              <div className="share-actions">
                {detail.status === "activo" ? (
                  <button className="btn-ghost" type="button" onClick={() => navigator.clipboard?.writeText(shareInvite(detail)).then(() => setMsg("Mensaje copiado.")).catch(() => setError("No se pudo copiar."))}>Copiar mensaje</button>
                ) : null}
                {detail.status === "activo" && detail.clientPhone && !whatsappQueued(detail.salida) ? (
                  <a className="btn-ghost" href={shareWhatsApp(detail)} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
                ) : null}
                {detail.status === "activo" ? (
                  <button className="btn-ghost" type="button" onClick={() => suspend(detail.id)}>Suspender</button>
                ) : null}
                {detail.status === "activo" || detail.status === "vencido" ? (
                  <button className="btn-ghost" type="button" onClick={() => { setExtendHours(24); setExtendAsk({ id: detail.id, name: detail.clientCompany || detail.clientName, reactivate: detail.status === "vencido" }); }}>{detail.status === "vencido" ? "Reactivar" : "Extender"}</button>
                ) : null}
                {detail.rucPending && detail.status !== "archivado" ? (
                  <button className="btn-ghost" type="button" onClick={() => setRucDraft({ id: detail.id, ruc: "" })}>Agregar RUC</button>
                ) : null}
                {detail.status === "archivado" ? null : (
                  <button className="btn-ghost" type="button" onClick={() => startEdit(detail)}>Editar</button>
                )}
                {canArchive && detail.status !== "archivado" ? (
                  <button className="btn-ghost" type="button" onClick={() => archive(detail.id)}>Archivar</button>
                ) : null}
              </div>
            </>
          ) : <p className="section-sub">Elige un enlace para ver el cliente, el comercial asignado y las acciones.</p>}
        </div>
        <div className="panel">
          <h3>{detail ? `Actividad · ${detail.clientCompany || detail.clientName}` : "Actividad del cliente"}</h3>
          <div ref={briefRef}>
            {detail && !pickedIso ? <p className="section-sub">Elige un equipo de la actividad. Su ficha y la solicitud de precio quedan aquí arriba.</p> : null}
            {pickedIso ? <UnitBrief unit={pickedUnit} error={pickedError} /> : null}
            {pickedIso ? (
              <PriceAsk
                thread={offerThread}
                onSent={async (next) => {
                  setOfferThread(next);
                  setShareThreads((rows) => rows.map((row) => (row.id === next.id ? { ...row, ...next } : row)));
                  if (detail?.id) setFollow(await api(`/catalog-shares/${detail.id}/seguimiento`).catch(() => null));
                  setMsg(`Precio de ${next.iso} enviado al cliente.`);
                }}
              />
            ) : null}
          </div>
          <div className="share-scroll">
            <ShareActivity detail={detail} picked={pickedIso} onPick={setPickedIso} asked={new Set(shareThreads.filter((row) => row.status !== "cerrado").map((row) => row.iso))} />
            {detail?.events?.length ? (
              <ul className="dash-list">
                {detail.events.slice(0, 40).map((e) => (
                  <li key={e.id}>
                    <b>{KIND[e.kind] || e.kind}{e.iso ? ` · ${e.iso}` : ""}{e.kind === "email_taken" && e.detail?.email ? ` · ${e.detail.email}` : ""}{e.detail?.q ? ` · ${e.detail.q}` : ""}{e.detail?.slot != null && e.kind === "view_image" ? ` · foto ${Number(e.detail.slot) + 1}` : ""}</b>
                    <span>{formatWhen(e.at)}{e.device ? ` · ${e.device}` : ""}{e.client ? ` · ${e.client}` : ""}{e.ip ? ` · ${e.ip}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
      {extendAsk ? (
        <div className="overlay open" role="dialog" aria-modal="true" aria-labelledby="extend-title" onClick={() => setExtendAsk(null)}>
          <div className="modal quote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 id="extend-title">{extendAsk.reactivate ? "Reactivar enlace" : "Extender enlace"}</h3>
              <button className="modal-close" type="button" onClick={() => setExtendAsk(null)} aria-label="Cerrar">×</button>
            </div>
            <div className="modal-body single">
              <p>¿Cuántas horas queda vigente el enlace de {extendAsk.name}?</p>
              <div className="doc-kind-switch" role="group" aria-label="Horas de vigencia">
                {[24, 48, 72].map((hours) => (
                  <button key={hours} type="button" className={extendHours === hours ? "on" : ""} onClick={() => setExtendHours(hours)}>{hours} horas</button>
                ))}
              </div>
              <div className="action-row">
                <button className="btn-primary" type="button" disabled={renewing} onClick={() => renew(extendAsk.id, extendHours)}>{renewing ? "Guardando…" : `Confirmar ${extendHours} horas`}</button>
                <button className="btn-ghost" type="button" onClick={() => setExtendAsk(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {detail ? (
        <div className="panel">
          <h3>Seguimiento · {detail.clientCompany || detail.clientName}</h3>
          <p className="section-sub">Aquí queda el precio enviado, el descuento, lo que se habló por teléfono o correo, y la cotización de Odoo cuando la vinculas.</p>
          {follow?.quote ? (
            <p>
              Cotización ZDRY <b>{follow.quote.number}</b>
              {follow.quote.odooSaleName ? ` · Odoo ${follow.quote.odooSaleName}` : ""}
              {follow.quote.total != null ? ` · total $${Number(follow.quote.total).toLocaleString("en-US")}` : ""}
              {follow.quote.url ? <> · <a href={follow.quote.url} target="_blank" rel="noreferrer">abrir en Odoo</a></> : null}
            </p>
          ) : null}
          <form className="form-grid" onSubmit={linkSale}>
            <div>
              <label>Cotización de Odoo</label>
              <input value={saleName} onChange={(e) => setSaleName(e.target.value)} placeholder="S00123" />
            </div>
            <button className="btn-primary" type="submit">Vincular y asimilar</button>
          </form>
          <form className="form-grid" onSubmit={saveLog}>
            <div>
              <label>Canal</label>
              <select value={log.channel} onChange={(e) => setLog({ ...log, channel: e.target.value })}>
                <option value="telefono">Teléfono</option>
                <option value="correo">Correo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="nota">Nota</option>
              </select>
            </div>
            <div>
              <label>Qué ofreciste o qué dijo el cliente</label>
              <input value={log.body} onChange={(e) => setLog({ ...log, body: e.target.value })} required />
            </div>
            <div>
              <label>Precio neto, si lo diste</label>
              <input value={log.priceNet} onChange={(e) => setLog({ ...log, priceNet: e.target.value })} inputMode="decimal" />
            </div>
            <div>
              <label>Imagen</label>
              <input name="foto" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
            </div>
            <button className="btn-ghost" type="submit">Registrar en la bitácora</button>
          </form>
          <ul className="dash-list">
            {(follow?.follows || []).map((item) => (
              <li key={item.id}>
                <b>{FOLLOW_KIND[item.channel] || item.channel}{item.iso ? ` · ${item.iso}` : ""}{item.priceNet != null ? ` · $${Number(item.priceNet).toLocaleString("en-US")}` : ""}</b>
                <span>{item.authorName ? `${item.authorName} · ` : ""}{formatWhen(item.createdAt)}</span>
                <p>{item.body}</p>
                {item.files?.map((file) => (
                  <img key={file.id} alt={file.name} src={apiUrl(`/catalog-shares/seguimiento/archivo/${file.id}`)} style={{ maxWidth: 220, display: "block", marginTop: 8 }} />
                ))}
              </li>
            ))}
            {follow && !follow.follows?.length ? <li>Todavía no hay notas de seguimiento.</li> : null}
          </ul>
        </div>
      ) : null}
    </>
  );
}
