import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, apiUpload, apiUrl, ApiError, publicUrl } from "../api.js";
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
    <div className="visita-brand">
      <img src={publicUrl("/brand/zg_marca.png")} alt="ZGROUP" />
    </div>
  );
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
  const [preview, setPreview] = useState(false);
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
      phone: v.phone || "",
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
        setForm((current) => ({
          ...current,
          siteId: current.siteId || data.sites?.[0]?.id || "",
          motiveId: current.motiveId || data.motives?.[0]?.id || "",
        }));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : e.message));
  }, []);

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
    if (!token) return undefined;
    let cancelled = false;
    api(`/gate-visits/ticket/${token}`)
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
  }, [token, options.motives]);

  useEffect(() => {
    if (!ready || !token || !ticket || showReceipt || forceEdit) return;
    if (staffVisitas) nav(`/app/almacen/visitas?visita=${encodeURIComponent(ticket.id)}`, { replace: true });
  }, [ready, token, ticket, showReceipt, forceEdit, staffVisitas, nav]);

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

  function openPreview(e) {
    e.preventDefault();
    setError("");
    if (motive?.asksDetail && form.motiveDetail.trim().length < 3) {
      setError("Si el motivo es Otros, escribe el detalle.");
      return;
    }
    setPreview(true);
  }

  async function proceed() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const body = token ? { ...form, publicToken: token } : form;
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
      setPreview(false);
      if (v?.publicToken) nav(`/visita/${v.publicToken}?recibo=1`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
      setPreview(false);
    } finally {
      setBusy(false);
    }
  }

  const photoSrc = token && photoStatus === "visible"
    ? `${apiUrl(`/gate-visits/ticket/${token}/photo`)}?t=${photoBust}`
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

  if (token && ready && staffVisitas && !showReceipt && !forceEdit && !error) {
    return (
      <div className="panel visita-public">
        <Brand />
        <p className="section-sub">Abriendo el ingreso en el panel…</p>
      </div>
    );
  }

  if (showReceipt && !ticket && !error) {
    return (
      <div className="panel visita-public">
        <Brand />
        <p className="section-sub">Preparando tu comprobante…</p>
      </div>
    );
  }

  if ((showReceipt && ticket) || (locked && ticket)) {
    return (
      <div className="panel visita-public visita-welcome">
        <Brand />
        <h2 className="section-title">Registro de conductores</h2>
        <p className="section-sub">Bienvenido, {welcomeName}. Este es tu comprobante.</p>
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="ok-msg">{msg}</div> : null}
        {qrSrc ? <img className="visita-qr" src={qrSrc} alt="QR del registro" /> : null}
        <p className="visita-code">Registro {ticket.publicCode || "—"}</p>
        <PreviewList data={{ ...ticket, ...previewData }} />
        {shownPhoto ? (
          <button type="button" className="visit-photo-btn" onClick={() => lb.open([{ src: shownPhoto, type: "image", label: "Foto de la unidad" }])} style={{ margin: "12px auto 0" }}>
            <img className="visit-photo-preview" src={shownPhoto} alt="Foto de la unidad" />
          </button>
        ) : null}
        <div className="action-row" style={{ justifyContent: "center", marginTop: 16 }}>
          <button className="btn-primary" type="button" onClick={() => downloadVisitPdf(ticket, pdfPhoto).catch((e) => setError(e.message))}>
            Descargar PDF
          </button>
          {!ticket.locked ? (
            <Link className="btn-ghost" to={`/visita/${ticket.publicToken}?editar=1`}>Corregir datos</Link>
          ) : null}
        </div>
        {lb.node}
      </div>
    );
  }

  return (
    <div className="panel visita-public">
      <Brand />
      <h2 className="section-title">Registro de conductores</h2>
      <p className="section-sub">Control de ingreso</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <form className="form-grid" onSubmit={openPreview}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label>Sede *</label>
          <select value={form.siteId} onChange={(e) => set("siteId", e.target.value)} required disabled={locked}>
            <option value="">Seleccione una sede</option>
            {options.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </div>
        <div><label>Empresa *</label><input value={form.company} onChange={(e) => set("company", e.target.value)} required disabled={locked} placeholder="Ingrese la empresa" /></div>
        <div><label>RUC *</label><input value={form.ruc} onChange={(e) => set("ruc", e.target.value.replace(/\D/g, "").slice(0, 11))} required inputMode="numeric" disabled={locked} placeholder="Ingrese RUC de 11 dígitos" /></div>
        <div><label>Nombres y apellidos *</label><input value={form.driverName} onChange={(e) => set("driverName", e.target.value)} required disabled={locked} /></div>
        <div><label>N.º de brevete *</label><input value={form.license} onChange={(e) => set("license", e.target.value)} required disabled={locked} /></div>
        <div><label>Teléfono *</label><input value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 9))} required inputMode="numeric" disabled={locked} placeholder="9 dígitos" /></div>
        <div><label>Placa tracto *</label><input value={form.tractorPlate} onChange={(e) => set("tractorPlate", e.target.value.toUpperCase())} required disabled={locked} /></div>
        <div><label>Placa carreta *</label><input value={form.trailerPlate} onChange={(e) => set("trailerPlate", e.target.value.toUpperCase())} required disabled={locked} /></div>
        <div>
          <label>Motivo de visita *</label>
          <select value={form.motiveId} onChange={(e) => set("motiveId", e.target.value)} required disabled={locked}>
            <option value="">Seleccione una opción</option>
            {options.motives.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div><label>Código de equipo</label><input value={form.equipmentCode} onChange={(e) => set("equipmentCode", e.target.value)} disabled={locked} placeholder="Ingrese código de equipo" /></div>
        {motive?.asksDetail ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Detalle del motivo *</label>
            <input value={form.motiveDetail} onChange={(e) => set("motiveDetail", e.target.value)} disabled={locked} placeholder="Describe la visita" />
          </div>
        ) : null}
        <div style={{ gridColumn: "1 / -1" }}>
          <label>Observaciones</label>
          <textarea value={form.observations} onChange={(e) => set("observations", e.target.value)} disabled={locked} placeholder="Ingrese observaciones si corresponde" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label>Foto de la unidad (opcional)</label>
          <div className="visit-photo-box">
            {shownPhoto ? (
              <button type="button" className="visit-photo-btn" onClick={() => lb.open([{ src: shownPhoto, type: "image", label: "Foto de la unidad" }])}>
                <img className="visit-photo-preview" src={shownPhoto} alt="Vista previa de la unidad" />
              </button>
            ) : null}
            <label className="btn-ghost">
              {shownPhoto ? "Cambiar foto" : "Elegir foto"}
              <input type="file" accept="image/*" capture="environment" hidden disabled={locked} onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            </label>
          </div>
        </div>
        <div className="action-row" style={{ gridColumn: "1 / -1" }}>
          <button className="btn-primary" type="submit" disabled={busy || locked}>
            {token ? "Guardar cambios" : "Registrar ingreso"}
          </button>
        </div>
      </form>
      <div className={`overlay ${preview ? "open" : ""}`} onClick={() => !busy && setPreview(false)}>
        <div className="modal quote-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <b>Revisa tus datos</b>
            <button type="button" className="modal-close" onClick={() => setPreview(false)} disabled={busy}>×</button>
          </div>
          <div className="modal-body single">
            <PreviewList data={previewData} />
            <div className="action-row" style={{ marginTop: 16 }}>
              <button className="btn-ghost" type="button" disabled={busy} onClick={() => setPreview(false)}>Corregir</button>
              <button className="btn-primary" type="button" disabled={busy} onClick={proceed}>{busy ? "Guardando…" : "Proceder"}</button>
            </div>
          </div>
        </div>
      </div>
      {lb.node}
    </div>
  );
}
