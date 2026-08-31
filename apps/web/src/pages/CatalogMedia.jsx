import { useCallback, useEffect, useState } from "react";
import { api, apiUpload, ApiError, apiUrl } from "../api.js";
import { useAuth } from "../auth.jsx";

const STATUS = {
  pendiente: { label: "Pendiente de publicación", color: "#c9720b" },
  aprobado: { label: "Publicada en catálogo", color: "#2f9e44" },
  rechazado: { label: "Rechazada", color: "#c92a2a" },
};

function firstPreview(unit) {
  const first = (unit.photoSlots || []).findIndex(Boolean);
  if (first >= 0) return { type: "photo", slot: first };
  if (unit.hasVideo) return { type: "video" };
  return null;
}

export default function CatalogMedia() {
  const { user } = useAuth();
  const canApprove = user.role === "admin" || user.role === "gerente";
  const [meta, setMeta] = useState({ photoLabels: [] });
  const [rows, setRows] = useState([]);
  const [iso, setIso] = useState("");
  const [unit, setUnit] = useState(null);
  const [notes, setNotes] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [bust, setBust] = useState(0);
  const [preview, setPreview] = useState(null);

  const loadList = useCallback(() => {
    api("/catalog-media").then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api("/catalog-media/meta").then(setMeta).catch(() => {});
    loadList();
  }, [loadList]);

  async function open(nextIso) {
    setError("");
    setMsg("");
    const u = await api(`/catalog-media/${nextIso}`);
    setIso(nextIso);
    setUnit(u);
    setNotes(u.inspectionNotes || "");
    setBust(Date.now());
    setPreview(firstPreview(u));
  }

  async function saveNotes() {
    try {
      const u = await api(`/catalog-media/${iso}`, { method: "PATCH", body: { inspectionNotes: notes } });
      setUnit(u);
      setMsg("Descripción guardada. Queda pendiente de publicación.");
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  async function upload(slot, file) {
    if (!file || !iso) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("slot", String(slot));
    try {
      const u = await apiUpload(`/catalog-media/${iso}/photos`, fd);
      setUnit(u);
      setBust(Date.now());
      setPreview(slot === "video" ? { type: "video" } : { type: "photo", slot: Number(slot) });
      setMsg("Archivo actualizado. Las demás fotos se conservan. Admin o Gerencia deben volver a publicar para que el cliente lo vea.");
      loadList();
    } catch (e) {
      setError(e.message);
    }
  }

  async function approve() {
    try {
      const u = await api(`/catalog-media/${iso}/approve`, { method: "POST", body: {} });
      setUnit(u);
      setMsg("Ficha publicada en el catálogo público. El cliente solo ve las fotos y el video que existen (sin casillas vacías).");
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  async function reject() {
    try {
      const u = await api(`/catalog-media/${iso}/reject`, { method: "POST", body: { note: rejectNote } });
      setUnit(u);
      setMsg("Ficha rechazada — no se muestra al cliente.");
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  const labels = unit?.photoLabels || meta.photoLabels || [];
  const st = unit ? STATUS[unit.mediaStatus] || STATUS.pendiente : null;
  const photoCount = unit ? (unit.photos?.length ?? unit.photoSlots?.filter(Boolean).length ?? 0) : 0;
  const photoSrc = (slot) => `${apiUrl(`/catalog-media/${unit.iso}/photos/${slot}`)}?t=${bust}`;
  const videoSrc = unit ? `${apiUrl(`/catalog-media/${unit.iso}/photos/video`)}?t=${bust}` : "";
  const previewingPhoto = preview?.type === "photo" && unit?.photoSlots?.[preview.slot];
  const previewingVideo = preview?.type === "video" && unit?.hasVideo;

  return (
    <>
      <h2 className="section-title">Ficha multimedia del catálogo</h2>
      <p className="section-sub">
        Carga o reemplaza cada foto por separado: las que no toques se conservan. El cliente verá solo las que existan, en recorrido automático.
        Admin, Almacén y Compras pueden cargar. Incluye compras facturadas y reentregas aún sin factura. <b>Solo Administrador o Gerencia publican</b> lo que ve el cliente. Cualquier cambio vuelve la ficha a pendiente.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="dash-grid">
        <div className="panel">
          <h3>Unidades en stock</h3>
          <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>ISO</th><th>Tipo</th><th>Fotos</th><th>Video</th><th>Origen</th><th>Ficha</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.iso} className="expandable" onClick={() => open(r.iso)}>
                  <td className="card-iso">{r.iso}{r.demo ? <span className="demo-chip">DEMO</span> : null}</td>
                  <td>{r.type}</td>
                  <td>{r.photoCount}</td>
                  <td>{r.hasVideo ? "sí" : "—"}</td>
                  <td>{r.invoicePending || r.intakeType === "pendiente_factura" ? "compra sin factura" : "compra"}</td>
                  <td style={{ color: (STATUS[r.mediaStatus] || STATUS.pendiente).color, fontWeight: 700 }}>
                    {(STATUS[r.mediaStatus] || STATUS.pendiente).label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {unit ? (
          <div className="panel">
            <h3>{unit.iso}</h3>
            <p className="section-sub">{unit.type} · {unit.cat} · {unit.depotName} · {unit.manufacturer} {unit.year || ""}</p>
            <div style={{ color: st.color, fontWeight: 800, marginBottom: 10 }}>{st.label}</div>
            {unit.mediaReviewNote ? <div className="err">Motivo: {unit.mediaReviewNote}</div> : null}
            <p className="section-sub">{photoCount} foto{photoCount === 1 ? "" : "s"} cargada{photoCount === 1 ? "" : "s"}{unit.hasVideo ? " · video 360°" : ""}. Pulsa una miniatura para verla en grande; «Cambiar» sustituye solo esa.</p>

            <div className="media-stage">
              {previewingVideo ? (
                <video key={videoSrc} src={videoSrc} controls autoPlay muted playsInline />
              ) : previewingPhoto ? (
                <img key={photoSrc(preview.slot)} src={photoSrc(preview.slot)} alt={labels[preview.slot] || `Foto ${preview.slot + 1}`} />
              ) : (
                <span className="muted">Carga una foto o el video para previsualizarlo aquí.</span>
              )}
            </div>

            <div className="media-slots">
              {labels.map((label, i) => {
                const filled = !!unit.photoSlots[i];
                const active = preview?.type === "photo" && preview.slot === i;
                const inputId = `media-photo-${unit.iso}-${i}`;
                return (
                  <div key={i} className={`media-slot ${filled ? "filled" : ""} ${active ? "active" : ""}`}>
                    {filled ? (
                      <>
                        <button type="button" className="media-slot-preview" onClick={() => setPreview({ type: "photo", slot: i })}>
                          <img src={photoSrc(i)} alt={label} />
                        </button>
                        <span className="slot-label">{i + 1}. {label}</span>
                        <label className="replace" htmlFor={inputId}>Cambiar</label>
                      </>
                    ) : (
                      <label className="media-slot-empty" htmlFor={inputId}>
                        <span className="n">{i + 1}</span>
                        {label}
                        <small>Cargar</small>
                      </label>
                    )}
                    <input
                      id={inputId}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => { upload(i, e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </div>
                );
              })}
              {(() => {
                const inputId = `media-video-${unit.iso}`;
                const active = preview?.type === "video";
                return (
                  <div className={`media-slot video-slot ${unit.hasVideo ? "filled" : ""} ${active ? "active" : ""}`}>
                    {unit.hasVideo ? (
                      <>
                        <button type="button" className="media-slot-preview" onClick={() => setPreview({ type: "video" })}>
                          360°
                        </button>
                        <span className="slot-label">Video recorrido</span>
                        <label className="replace" htmlFor={inputId}>Cambiar</label>
                      </>
                    ) : (
                      <label className="media-slot-empty" htmlFor={inputId}>
                        <span className="n">360°</span>
                        Video recorrido
                        <small>Cargar</small>
                      </label>
                    )}
                    <input
                      id={inputId}
                      type="file"
                      accept="video/mp4,video/webm"
                      hidden
                      onChange={(e) => { upload("video", e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </div>
                );
              })()}
            </div>

            <label style={{ marginTop: 16, display: "block" }}>Descripción para el cliente</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              style={{ width: "100%", padding: 8, border: "1px solid var(--line)", borderRadius: 7, font: "inherit" }}
              placeholder="Estado de la unidad, particularidades, qué ve el cliente en la ficha…"
            />
            <button className="btn-ghost" type="button" style={{ marginTop: 8 }} onClick={saveNotes}>Guardar descripción</button>

            {canApprove ? (
              <div style={{ marginTop: 16 }}>
                <button className="btn-primary" type="button" onClick={approve} disabled={photoCount < 1}>Publicar en catálogo</button>
                <input
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Motivo si rechazas"
                  style={{ marginLeft: 8 }}
                />
                <button className="btn-ghost" type="button" onClick={reject}>Rechazar</button>
              </div>
            ) : (
              <div className="locked-note">Tú cargas la ficha. Administrador o Gerencia la publican para el cliente.</div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
