import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, apiUpload, apiUrl, ApiError, publicUrl } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useLightbox } from "../media-lightbox.jsx";
import {
  VISIT_FIELDS,
  downloadVisitPdf,
  shortVisitCode,
  visitFieldValue,
  visitTicketHref,
} from "../visit-ticket.js";

const empty = {
  tractorPlate: "",
  company: "",
  ruc: "",
  driverName: "",
  visitAt: "",
  license: "",
  motive: "descargar",
  trailerPlate: "",
  phone: "",
  equipmentCode: "",
};

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  const [form, setForm] = useState(empty);
  const [locked, setLocked] = useState(false);
  const [saved, setSaved] = useState(false);
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

  const staffVisitas = user?.role === "admin" || user?.role === "coordinador";

  function applyVisit(v, lockedNow, found) {
    setLocked(!!lockedNow);
    setSaved(!!found && !lockedNow);
    setForm({
      tractorPlate: v.tractorPlate,
      company: v.company,
      ruc: v.ruc,
      driverName: v.driverName,
      visitAt: toLocalInput(v.visitAt),
      license: v.license,
      motive: v.motive || "descargar",
      trailerPlate: v.trailerPlate,
      phone: v.phone,
      equipmentCode: v.equipmentCode || "",
    });
  }

  async function lookup(plate) {
    if (token) return;
    if ((plate || "").replace(/[^A-Za-z0-9]/g, "").length < 3) return;
    try {
      const d = await api(`/gate-visits/by-plate/${encodeURIComponent(plate)}`);
      if (!d.found || !d.visit) {
        setLocked(false);
        setSaved(false);
        setPhotoStatus("none");
        return;
      }
      applyVisit(d.visit, d.locked, true);
      setTicket(d.visit);
      setPhotoStatus(d.visit.photoStatus || "none");
      setPhotoBust(Date.now());
      setMsg(d.locked ? "Esta placa ya está vinculada a un contenedor." : "");
    } catch {
      /* ignore lookup */
    }
  }

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
    const t = setTimeout(() => lookup(form.tractorPlate), 400);
    return () => clearTimeout(t);
  }, [form.tractorPlate, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api(`/gate-visits/ticket/${token}`)
      .then((d) => {
        if (cancelled || !d.visit) return;
        applyVisit(d.visit, d.locked, true);
        setTicket(d.visit);
        setPhotoStatus(d.visit.photoStatus || "none");
        setPhotoBust(Date.now());
        if (d.locked) setMsg("Esta placa ya está vinculada a un contenedor.");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : e.message);
      });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!ready || !token || !ticket || showReceipt || forceEdit) return;
    if (staffVisitas) {
      nav(`/app/almacen/visitas?visita=${encodeURIComponent(ticket.id)}`, { replace: true });
    }
  }, [ready, token, ticket, showReceipt, forceEdit, staffVisitas, nav]);

  useEffect(() => {
    if (!ticket?.publicToken) {
      setQrSrc("");
      return;
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

  function openPreview(e) {
    e.preventDefault();
    setError("");
    setPreview(true);
  }

  async function proceed() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const out = await api("/gate-visits/public", { method: "POST", body: form });
      const v = out.visit;
      if (photo && v?.id) {
        const fd = new FormData();
        fd.append("file", photo);
        fd.append("tractorPlate", form.tractorPlate);
        const withPhoto = await apiUpload("/gate-visits/public/photo", fd);
        setPhotoStatus(withPhoto.photoStatus || "pending");
        setPhoto(null);
        setPhotoBust(Date.now());
        setTicket({ ...v, ...withPhoto, publicToken: withPhoto.publicToken || v.publicToken });
      } else {
        setPhotoStatus(v?.photoStatus || "none");
        setTicket(v);
      }
      setLocked(!!v?.locked);
      setSaved(!!out.saved && !v?.locked);
      setPreview(false);
      if (v?.publicToken) {
        nav(`/visita/${v.publicToken}?recibo=1`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
      setPreview(false);
    } finally {
      setBusy(false);
    }
  }

  function set(k, v) {
    if (locked) return;
    setForm((f) => ({ ...f, [k]: v }));
  }

  const photoSrc = token
    ? `${apiUrl(`/gate-visits/ticket/${token}/photo`)}?t=${photoBust}`
    : `${apiUrl(`/gate-visits/by-plate/${encodeURIComponent(form.tractorPlate)}/photo`)}?t=${photoBust}`;
  const shownPhoto = photoLocal || (photoStatus !== "none" ? photoSrc : "");
  const pdfPhoto = photoLocal || ((ticket?.hasPhoto || photoStatus !== "none") ? photoSrc : "");

  function openPhoto() {
    if (!shownPhoto) return;
    lb.open([{ src: shownPhoto, type: "image", label: "Foto de la unidad" }]);
  }

  const welcomeName = (ticket?.driverName || form.driverName || "").trim() || "a ZGROUP";
  const linked = !!(locked || ticket?.locked);

  if (linked && ticket) {
    return (
      <div className="panel visita-public visita-welcome">
        <Brand />
        <p className="ok-msg">Esta placa ya está vinculada a un contenedor.</p>
        {error ? <div className="err">{error}</div> : null}
        <PreviewList data={{ ...form, visitAt: form.visitAt || ticket.visitAt }} />
        {shownPhoto ? (
          <button type="button" className="visit-photo-btn" onClick={openPhoto} style={{ margin: "12px auto 0" }}>
            <img className="visit-photo-preview" src={shownPhoto} alt="Foto de la unidad" />
          </button>
        ) : null}
        <div className="action-row" style={{ justifyContent: "center", marginTop: 16 }}>
          <button className="btn-primary" type="button" onClick={() => downloadVisitPdf({ ...ticket, locked: true }, pdfPhoto).catch((e) => setError(e.message))}>
            Descargar PDF
          </button>
        </div>
        {lb.node}
      </div>
    );
  }

  if (token && ready && staffVisitas && !showReceipt && !forceEdit && !error) {
    return (
      <div className="panel visita-public">
        <Brand />
        <p className="section-sub">Abriendo la visita en el panel…</p>
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

  if (showReceipt && ticket) {
    return (
      <div className="panel visita-public visita-welcome">
        <Brand />
        <h2 className="section-title">Bienvenido, {welcomeName}</h2>
        <p className="section-sub">Bienvenido. Descarga el comprobante.</p>
        {error ? <div className="err">{error}</div> : null}
        {qrSrc ? <img className="visita-qr" src={qrSrc} alt="QR de validación" /> : null}
        <p className="visita-code">Código {shortVisitCode(ticket.publicToken)}</p>
        <PreviewList data={{ ...form, visitAt: form.visitAt || ticket.visitAt }} />
        {shownPhoto ? (
          <button type="button" className="visit-photo-btn" onClick={openPhoto} style={{ margin: "12px auto 0" }}>
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
      <h2 className="section-title">Visita de puerta</h2>
      <p className="section-sub">Identifícate con la placa del tracto.</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <form className="form-grid" onSubmit={openPreview}>
        <div><label>Placa tracto *</label><input value={form.tractorPlate} onChange={(e) => set("tractorPlate", e.target.value.toUpperCase())} required disabled={locked} /></div>
        <div><label>Empresa</label><input value={form.company} onChange={(e) => set("company", e.target.value)} disabled={locked} /></div>
        <div><label>RUC</label><input value={form.ruc} onChange={(e) => set("ruc", e.target.value)} disabled={locked} /></div>
        <div><label>Conductor</label><input value={form.driverName} onChange={(e) => set("driverName", e.target.value)} disabled={locked} /></div>
        <div><label>Hora</label><input type="datetime-local" value={form.visitAt} onChange={(e) => set("visitAt", e.target.value)} disabled={locked} /></div>
        <div><label>Brevete</label><input value={form.license} onChange={(e) => set("license", e.target.value)} disabled={locked} /></div>
        <div>
          <label>Motivo</label>
          <select value={form.motive} onChange={(e) => set("motive", e.target.value)} disabled={locked}>
            <option value="descargar">Descargar</option>
            <option value="cargar">Cargar</option>
          </select>
        </div>
        <div><label>Placa carreta</label><input value={form.trailerPlate} onChange={(e) => set("trailerPlate", e.target.value.toUpperCase())} disabled={locked} /></div>
        <div><label>Teléfono</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={locked} /></div>
        <div><label>Código de equipo (opcional)</label><input value={form.equipmentCode} onChange={(e) => set("equipmentCode", e.target.value.toUpperCase())} disabled={locked} /></div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label>Foto de la unidad (opcional)</label>
          <p className="section-sub" style={{ marginBottom: 6 }}>
            Una toma del contenedor o del tracto para que patio lo contraste. El coordinador debe aprobarla antes de que la vea el personal de campo.
          </p>
          <div className="visit-photo-box">
            {shownPhoto ? (
              <button type="button" className="visit-photo-btn" onClick={openPhoto}>
                <img className="visit-photo-preview" src={shownPhoto} alt="Vista previa de la unidad" />
              </button>
            ) : null}
            <div className="visit-photo-actions">
              <span className="file-field-name">
                {photo?.name
                  || (photoStatus === "approved" ? "Foto enviada y aprobada"
                    : photoStatus === "pending" ? "Foto enviada · pendiente de aprobación"
                      : photoStatus === "rejected" ? "Foto rechazada · puedes cargar otra"
                        : "Ningún archivo seleccionado")}
              </span>
              {shownPhoto ? (
                <button className="btn-ghost" type="button" onClick={openPhoto}>Ver foto</button>
              ) : null}
              <label className="btn-ghost">
                {shownPhoto ? "Cambiar foto" : "Elegir foto"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  disabled={locked}
                  onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          </div>
        </div>
        <div className="action-row" style={{ gridColumn: "1 / -1" }}>
          <button className="btn-primary" type="submit" disabled={busy || locked}>
            {locked ? "Vinculada" : saved ? "Revisar cambios" : "Enviar"}
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
            <p className="section-sub">Si algo está mal, pulsa Corregir. Si está bien, Proceder registra la visita.</p>
            <PreviewList data={form} />
            {shownPhoto ? (
              <button type="button" className="visit-photo-btn" onClick={openPhoto} style={{ marginTop: 10 }}>
                <img className="visit-photo-preview" src={shownPhoto} alt="Vista previa" />
              </button>
            ) : null}
            <div className="action-row" style={{ marginTop: 16 }}>
              <button className="btn-ghost" type="button" disabled={busy} onClick={() => setPreview(false)}>Corregir</button>
              <button className="btn-primary" type="button" disabled={busy} onClick={proceed}>
                {busy ? "Guardando…" : "Proceder"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {lb.node}
    </div>
  );
}
