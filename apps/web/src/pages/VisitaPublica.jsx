import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, apiUpload, apiUrl, ApiError, publicUrl } from "../api.js";
import { localPhone, PeruPhone } from "../peru-phone.jsx";
import { hasRole, useAuth } from "../auth.jsx";
import { useLightbox } from "../media-lightbox.jsx";
import {
  VISIT_FIELDS,
  downloadVisitPdf,
  visitFieldValue,
  visitTicketHref,
} from "../visit-ticket.js";

const empty = {
  siteId: "",
  motiveId: "",
  motiveDetail: "",
  company: "",
  ruc: "",
  driverName: "",
  license: "",
  phone: "",
  tractorPlate: "",
  trailerPlate: "",
  equipmentCode: "",
  observations: "",
};

function Brand() {
  return (
    <div className="reg-logo">
      <img src={publicUrl("/brand/zg_marca.png")} alt="ZGROUP" />
      <span>INGENIERÍA EN FRÍO</span>
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <section className="reg-section">
      <h3>{icon}<span>{title}</span></h3>
      <div className="reg-grid">{children}</div>
    </section>
  );
}

function siteByName(sites, name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  return (sites || []).find((site) => String(site.name || "").trim().toLowerCase() === wanted) || null;
}

function isVisitToken(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function PreviewList({ data }) {
  return (
    <dl className="visita-preview-dl">
      {VISIT_FIELDS.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{visitFieldValue(key, data)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function VisitaPublica() {
  const { token } = useParams();
  const visitToken = isVisitToken(token) ? token : "";
  const siteSlug = visitToken ? "" : String(token || "").trim();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user, ready } = useAuth();
  const lb = useLightbox();
  const showReceipt = params.get("recibo") === "1";
  const forceEdit = params.get("editar") === "1";
  const [options, setOptions] = useState({ sites: [], motives: [] });
  const [form, setForm] = useState(empty);
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [photoLocal, setPhotoLocal] = useState("");
  const [photoStatus, setPhotoStatus] = useState("none");
  const [photoBust, setPhotoBust] = useState(0);
  const [ticket, setTicket] = useState(null);
  const [qrSrc, setQrSrc] = useState("");

  const staffVisitas = hasRole(user, "admin", "coordinador", "almacen");
  const motive = options.motives.find((item) => item.id === form.motiveId);

  function applyVisit(v) {
    const editable = v.editable !== false && v.status === "REGISTRADO" && !v.archived;
    setLocked(!editable);
    setForm({
      siteId: v.siteId || "",
      motiveId: v.motiveId || "",
      motiveDetail: v.motiveDetail || "",
      company: v.company || "",
      ruc: v.ruc || "",
      driverName: v.driverName || "",
      license: v.license || "",
      phone: localPhone(v.phone || ""),
      tractorPlate: v.tractorPlate || "",
      trailerPlate: v.trailerPlate || "",
      equipmentCode: v.equipmentCode || "",
      observations: v.observations || "",
    });
    setPhotoStatus(v.photoStatus || "none");
  }

  useEffect(() => {
    api("/gate-visits/public/options")
      .then((data) => {
        setOptions({ sites: data.sites || [], motives: data.motives || [] });
        const sites = data.sites || [];
        const picked = siteByName(sites, siteSlug) || siteByName(sites, "Piura") || sites[0];
        if (siteSlug && !siteByName(sites, siteSlug)) setError(`No hay una sede ${siteSlug}. Quedó Piura.`);
        setForm((current) => ({
          ...current,
          siteId: current.siteId || picked?.id || "",
          motiveId: current.motiveId || data.motives?.[0]?.id || "",
        }));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : e.message));
  }, [siteSlug]);

  useEffect(() => {
    if (!photo) {
      setPhotoLocal("");
      return undefined;
    }
    const url = URL.createObjectURL(photo);
    setPhotoLocal(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (!visitToken) return undefined;
    let cancelled = false;
    api(`/gate-visits/ticket/${visitToken}`)
      .then((d) => {
        if (cancelled || !d.visit) return;
        const motives = options.motives;
        const match = motives.find((item) => item.name === d.visit.motive);
        applyVisit({ ...d.visit, editable: d.editable, motiveId: match?.id || "" });
        setTicket(d.visit);
        setPhotoBust(Date.now());
        if (!d.editable) setMsg("Este ingreso ya no se puede modificar. Puedes descargar el comprobante.");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : e.message);
      });
    return () => { cancelled = true; };
  }, [visitToken, options.motives]);

  useEffect(() => {
    if (!ready || !visitToken || !ticket || showReceipt || forceEdit) return;
    if (staffVisitas) nav(`/app/almacen/visitas?visita=${encodeURIComponent(ticket.id)}`, { replace: true });
  }, [ready, visitToken, ticket, showReceipt, forceEdit, staffVisitas, nav]);

  useEffect(() => {
    if (!ticket?.publicToken) {
      setQrSrc("");
      return undefined;
    }
    let cancelled = false;
    import("qrcode").then((QRCode) => {
      const lib = QRCode.default || QRCode;
      return lib.toDataURL(visitTicketHref(ticket.publicToken), { width: 280, margin: 1 });
    }).then((src) => {
      if (!cancelled) setQrSrc(src);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [ticket?.publicToken]);

  function set(key, value) {
    if (locked) return;
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submitForm(e) {
    e.preventDefault();
    setError("");
    if (motive?.asksDetail && form.motiveDetail.trim().length < 3) {
      setError("Si el motivo es Otros, escribe el detalle.");
      return;
    }
    proceed();
  }

  async function proceed() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const body = visitToken ? { ...form, publicToken: visitToken } : form;
      const out = await api("/gate-visits/public", { method: "POST", body });
      const v = out.visit;
      let next = v;
      if (photo && v?.publicToken && !locked) {
        const fd = new FormData();
        fd.append("file", photo);
        fd.append("publicToken", v.publicToken);
        fd.append("tractorPlate", form.tractorPlate);
        next = await apiUpload("/gate-visits/public/photo", fd);
        setPhoto(null);
        setPhotoBust(Date.now());
      }
      setTicket(next);
      setPhotoStatus(next?.photoStatus || "none");
      setLocked(!!next?.locked);
      if (v?.publicToken) nav(`/visita/${v.publicToken}?recibo=1`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    } finally {
      setBusy(false);
    }
  }

  const photoSrc = visitToken && photoStatus === "visible"
    ? `${apiUrl(`/gate-visits/ticket/${visitToken}/photo`)}?t=${photoBust}`
    : "";
  const shownPhoto = photoLocal || photoSrc;
  const pdfPhoto = photoLocal || (ticket?.hasPhoto ? photoSrc : "");
  const previewData = {
    ...form,
    ...ticket,
    siteName: options.sites.find((site) => site.id === form.siteId)?.name || ticket?.siteName,
    motive: motive?.name || ticket?.motive,
    motiveDetail: form.motiveDetail,
  };
  const welcomeName = (ticket?.driverName || form.driverName || "").trim() || "a ZGROUP";

  if (visitToken && ready && staffVisitas && !showReceipt && !forceEdit && !error) {
    return (
      <div className="reg-page">
        <Brand />
        <div className="reg-card reg-card-plain"><p>Abriendo el ingreso en el panel…</p></div>
      </div>
    );
  }

  if (showReceipt && !ticket && !error) {
    return (
      <div className="reg-page">
        <Brand />
        <div className="reg-card reg-card-plain"><p>Preparando tu comprobante…</p></div>
      </div>
    );
  }

  if ((showReceipt && ticket) || (locked && ticket)) {
    return (
      <div className="reg-page">
        <Brand />
        <div className="reg-card reg-receipt">
          <header className="reg-banner">
            <span className="reg-banner-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 7h11v8H3V7zm11 2h4l3 3v3h-7V9zM7 18a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>
            </span>
            <div>
              <strong>REGISTRO DE CONDUCTORES</strong>
              <small>Control de ingreso</small>
            </div>
          </header>
          <div className="reg-body">
            <p className="reg-hello">Bienvenido, {welcomeName}.</p>
            {error ? <div className="err">{error}</div> : null}
            {msg ? <div className="ok-msg">{msg}</div> : null}
            {qrSrc ? <img className="visita-qr" src={qrSrc} alt="QR del registro" /> : null}
            <p className="visita-code">Registro {ticket.publicCode || "—"}</p>
            <PreviewList data={{ ...ticket, ...previewData }} />
            {shownPhoto ? (
              <button type="button" className="visit-photo-btn" onClick={() => lb.open([{ src: shownPhoto, type: "image", label: "Foto de la unidad" }])}>
                <img className="visit-photo-preview" src={shownPhoto} alt="Foto de la unidad" />
              </button>
            ) : null}
            <div className="reg-receipt-actions">
              <button className="reg-submit" type="button" onClick={() => downloadVisitPdf(ticket, pdfPhoto).catch((e) => setError(e.message))}>Descargar PDF</button>
              {!ticket.locked ? <Link className="reg-link" to={`/visita/${ticket.publicToken}?editar=1`}>Corregir datos</Link> : null}
            </div>
          </div>
        </div>
        {lb.node}
      </div>
    );
  }

  return (
    <div className="reg-page">
      <Brand />
      <form className="reg-card" onSubmit={submitForm}>
        <header className="reg-banner">
          <span className="reg-banner-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 7h11v8H3V7zm11 2h4l3 3v3h-7V9zM7 18a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>
          </span>
          <div>
            <strong>REGISTRO DE CONDUCTORES</strong>
            <small>Control de ingreso</small>
          </div>
        </header>
        <div className="reg-body">
          {error ? <div className="err">{error}</div> : null}
          {msg ? <div className="ok-msg">{msg}</div> : null}
          <Section icon={<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" /></svg>} title="SEDE DE REGISTRO">
            <label className="reg-field reg-span">
              Sede<i>*</i>
              <select value={form.siteId} onChange={(e) => set("siteId", e.target.value)} required disabled={locked}>
                <option value="">Seleccione una sede</option>
                {options.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
              <small>Seleccione la sede de ZGROUP donde realizará el ingreso.</small>
            </label>
          </Section>
          <Section icon={<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z" /></svg>} title="DATOS DEL CONDUCTOR">
            <label className="reg-field">Empresa<i>*</i><input value={form.company} onChange={(e) => set("company", e.target.value)} required disabled={locked} placeholder="Ingrese la empresa" /></label>
            <label className="reg-field">RUC<i>*</i><input value={form.ruc} onChange={(e) => set("ruc", e.target.value.replace(/\D/g, "").slice(0, 11))} required inputMode="numeric" disabled={locked} placeholder="Ingrese RUC de 11 dígitos" /></label>
            <label className="reg-field">Nombres y apellidos<i>*</i><input value={form.driverName} onChange={(e) => set("driverName", e.target.value)} required disabled={locked} placeholder="Ingrese nombres y apellidos" /></label>
            <label className="reg-field">N.º de brevete<i>*</i><input value={form.license} onChange={(e) => set("license", e.target.value)} required disabled={locked} placeholder="Ingrese n.º de brevete" /></label>
            <label className="reg-field">Teléfono<i>*</i><PeruPhone value={form.phone} onChange={(phone) => set("phone", phone)} required disabled={locked} placeholder="Ingrese teléfono de 9 dígitos" /></label>
          </Section>
          <Section icon={<svg viewBox="0 0 24 24"><path d="M3 7h11v8H3V7zm11 2h4l3 3v3h-7V9zM7 18a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>} title="DATOS DEL VEHÍCULO">
            <label className="reg-field">Placa tracto<i>*</i><input value={form.tractorPlate} onChange={(e) => set("tractorPlate", e.target.value.toUpperCase())} required disabled={locked} placeholder="Ingrese placa del tracto" /></label>
            <label className="reg-field">Placa carreta<i>*</i><input value={form.trailerPlate} onChange={(e) => set("trailerPlate", e.target.value.toUpperCase())} required disabled={locked} placeholder="Ingrese placa de la carreta" /></label>
          </Section>
          <Section icon={<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM8 12h8v1.6H8zm0 3.4h8V17H8z" /></svg>} title="DATOS DE LA VISITA">
            <label className="reg-field">
              Motivo de visita<i>*</i>
              <select value={form.motiveId} onChange={(e) => set("motiveId", e.target.value)} required disabled={locked}>
                <option value="">Seleccione una opción</option>
                {options.motives.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="reg-field">Código de equipo<input value={form.equipmentCode} onChange={(e) => set("equipmentCode", e.target.value)} disabled={locked} placeholder="Ingrese código de equipo" /></label>
            {motive?.asksDetail ? (
              <label className="reg-field reg-span">Detalle del motivo<i>*</i><input value={form.motiveDetail} onChange={(e) => set("motiveDetail", e.target.value)} disabled={locked} placeholder="Describe la visita" /></label>
            ) : null}
            <label className="reg-field reg-span">
              Observaciones
              <textarea value={form.observations} onChange={(e) => set("observations", e.target.value)} disabled={locked} placeholder="Ingrese observaciones si corresponde" rows={3} />
            </label>
            <label className="reg-field reg-span">
              Foto de la unidad
              <span className="reg-file">
                {shownPhoto ? <img src={shownPhoto} alt="Vista previa de la unidad" /> : null}
                <span>{photo?.name || (photoStatus === "visible" ? "Foto cargada" : "Opcional")}</span>
                <input type="file" accept="image/*" capture="environment" disabled={locked} onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
              </span>
            </label>
          </Section>
          <button className="reg-submit" type="submit" disabled={busy || locked}>
            <span aria-hidden="true">▶</span> {busy ? "REGISTRANDO…" : visitToken ? "GUARDAR CAMBIOS" : "REGISTRAR INGRESO"}
          </button>
          <p className="reg-safe">La información será registrada de forma segura.</p>
        </div>
      </form>
      {lb.node}
    </div>
  );
}
