import { useCallback, useEffect, useState } from "react";
import { api, apiUpload, ApiError, apiUrl, formatWhen } from "../api.js";
import { useAuth } from "../auth.jsx";

const STATUS = {
  pendiente: { label: "Pendiente de publicación", color: "#c9720b" },
  aprobado: { label: "Visible en catálogo", color: "#2f9e44" },
  oculto: { label: "Oculta del catálogo", color: "#5c6370" },
  rechazado: { label: "Oculta del catálogo", color: "#5c6370" },
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
  const [rejectingSlot, setRejectingSlot] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [bust, setBust] = useState(0);
  const [preview, setPreview] = useState(null);
  const [histPreview, setHistPreview] = useState(null);

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
    setHistPreview(null);
    setRejectingSlot(null);
  }

  async function applyUnit(u, text) {
    setUnit(u);
    setBust(Date.now());
    setMsg(text);
    setRejectingSlot(null);
    setRejectNote("");
    loadList();
  }

  async function saveNotes() {
    try {
      const u = await api(`/catalog-media/${iso}`, { method: "PATCH", body: { inspectionNotes: notes } });
      await applyUnit(u, "Descripción guardada. Publicar u ocultar el catálogo no cambia.");
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
      setPreview(slot === "video" ? { type: "video" } : { type: "photo", slot: Number(slot) });
      await applyUnit(u, "Archivo actualizado. La foto anterior, si había, queda en el historial de esta unidad.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function publish() {
    try {
      const u = await api(`/catalog-media/${iso}/approve`, { method: "POST", body: {} });
      await applyUnit(u, "Visible en el catálogo público. El cliente solo ve las fotos activas.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  async function hide() {
    try {
      const u = await api(`/catalog-media/${iso}/hide`, { method: "POST", body: {} });
      await applyUnit(u, "Oculta del catálogo. Las fotos se conservan.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  async function rejectSlot(slot) {
    try {
      const u = await api(`/catalog-media/${iso}/photos/${slot}/reject`, { method: "POST", body: { note: rejectNote } });
      setPreview(firstPreview(u));
      await applyUnit(u, `Foto ${slot + 1} rechazada. Pasó al historial de la unidad; el catálogo no se toca salvo que no quede ninguna foto.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  async function restore(id) {
    try {
      const u = await api(`/catalog-media/${iso}/history/${id}/restore`, { method: "POST", body: {} });
      setPreview(firstPreview(u));
      setHistPreview(null);
      await applyUnit(u, "Foto restaurada al hueco original. Vuelve a publicar si quieres que el cliente la vea.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  const labels = unit?.photoLabels || meta.photoLabels || [];
  const st = unit ? STATUS[unit.mediaStatus] || STATUS.pendiente : null;
  const photoCount = unit ? (unit.photos?.length ?? unit.photoSlots?.filter(Boolean).length ?? 0) : 0;
  const photoSrc = (slot) => `${apiUrl(`/catalog-media/${unit.iso}/photos/${slot}`)}?t=${bust}`;
  const histSrc = (id) => `${apiUrl(`/catalog-media/${unit.iso}/history/${id}`)}?t=${bust}`;
  const videoSrc = unit ? `${apiUrl(`/catalog-media/${unit.iso}/photos/video`)}?t=${bust}` : "";
  const previewingPhoto = preview?.type === "photo" && unit?.photoSlots?.[preview.slot];
  const previewingVideo = preview?.type === "video" && unit?.hasVideo;

  return (
    <>
      <h2 className="section-title">Ficha multimedia del catálogo</h2>
      <p className="section-sub">Fotos de inspección, publicar u ocultar el catálogo. Rechazar una foto la manda al historial de esa unidad.</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="dash-grid">
        <div className="panel">
          <h3>Unidades en stock</h3>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr><th>ISO</th><th>Tipo</th><th>Ingreso</th><th>Fotos</th><th>Historial</th><th>Video</th><th>Catálogo</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.iso} className="expandable" onClick={() => open(r.iso)}>
                    <td className="card-iso">{r.iso}{r.demo ? <span className="demo-chip">DEMO</span> : null}</td>
                    <td>{r.type}</td>
                    <td className="recv-who">{r.registeredByName || "—"}<br />{formatWhen(r.createdAt)}</td>
                    <td>{r.photoCount}</td>
                    <td>{r.historyCount || "—"}</td>
                    <td>{r.hasVideo ? "sí" : "—"}</td>
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
            <p className="recv-who">Ingresó {unit.registeredByName || "—"} · {formatWhen(unit.createdAt)}</p>
            <div style={{ color: st.color, fontWeight: 800, marginBottom: 10 }}>{st.label}</div>
            <p className="section-sub">{photoCount} foto{photoCount === 1 ? "" : "s"} activa{photoCount === 1 ? "" : "s"}{unit.hasVideo ? " · video 360°" : ""}{(unit.history || []).length ? ` · ${(unit.history || []).length} en historial` : ""}.</p>

            <div className="media-stage">
              {histPreview ? (
                <img key={histSrc(histPreview)} src={histSrc(histPreview)} alt="Foto de historial" />
              ) : previewingVideo ? (
                <video key={videoSrc} src={videoSrc} controls autoPlay muted playsInline />
              ) : previewingPhoto ? (
                <img key={photoSrc(preview.slot)} src={photoSrc(preview.slot)} alt={labels[preview.slot] || `Foto ${preview.slot + 1}`} />
              ) : (
                <span className="muted">Carga una foto o elige una del historial para previsualizarla.</span>
              )}
            </div>

            <div className="media-slots">
              {labels.map((label, i) => {
                const filled = !!unit.photoSlots[i];
                const active = !histPreview && preview?.type === "photo" && preview.slot === i;
                const inputId = `media-photo-${unit.iso}-${i}`;
                return (
                  <div key={i} className={`media-slot ${filled ? "filled" : ""} ${active ? "active" : ""}`}>
                    {filled ? (
                      <>
                        <button type="button" className="media-slot-preview" onClick={() => { setHistPreview(null); setPreview({ type: "photo", slot: i }); }}>
                          <img src={photoSrc(i)} alt={label} />
                        </button>
                        <span className="slot-label">{i + 1}. {label}</span>
                        <label className="replace" htmlFor={inputId}>Cambiar</label>
                        {canApprove ? (
                          <button
                            type="button"
                            className="slot-reject"
                            onClick={() => { setRejectingSlot(i); setRejectNote(""); setHistPreview(null); setPreview({ type: "photo", slot: i }); }}
                          >
                            Rechazar
                          </button>
                        ) : null}
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
                const active = !histPreview && preview?.type === "video";
                return (
                  <div className={`media-slot video-slot ${unit.hasVideo ? "filled" : ""} ${active ? "active" : ""}`}>
                    {unit.hasVideo ? (
                      <>
                        <button type="button" className="media-slot-preview" onClick={() => { setHistPreview(null); setPreview({ type: "video" }); }}>
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

            {rejectingSlot != null ? (
              <div className="locked-note" style={{ marginTop: 12 }}>
                Rechazar foto {rejectingSlot + 1} ({labels[rejectingSlot]}). Pasa al historial de {unit.iso}.
                <input
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Motivo del rechazo de esta foto"
                  style={{ display: "block", width: "100%", margin: "8px 0" }}
                />
                <div className="action-row">
                  <button className="btn-primary" type="button" onClick={() => rejectSlot(rejectingSlot)}>Confirmar rechazo</button>
                  <button className="btn-ghost" type="button" onClick={() => setRejectingSlot(null)}>Cancelar</button>
                </div>
              </div>
            ) : null}

            {(unit.history || []).length ? (
              <div style={{ marginTop: 18 }}>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>Historial de fotos de esta unidad</h4>
                <p className="section-sub">Fotos que pertenecieron al contenedor y fueron rechazadas o reemplazadas. No se muestran al cliente.</p>
                <div className="media-slots">
                  {unit.history.map((h) => (
                    <div key={h.id} className={`media-slot filled ${histPreview === h.id ? "active" : ""}`}>
                      <button type="button" className="media-slot-preview" onClick={() => setHistPreview(h.id)}>
                        <img src={histSrc(h.id)} alt={h.label} />
                      </button>
                      <span className="slot-label">Hueco {h.slot + 1} · {h.label}</span>
                    </div>
                  ))}
                </div>
                {histPreview ? (() => {
                  const h = unit.history.find((x) => x.id === histPreview);
                  if (!h) return null;
                  return (
                    <div className="section-sub" style={{ marginTop: 8 }}>
                      {h.rejectNote || "Sin motivo"} · {h.rejectedByName || "—"} · {h.rejectedAt ? new Date(h.rejectedAt).toLocaleString("es-PE") : ""}
                      {canApprove ? (
                        <button className="btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={() => restore(h.id)}>Restaurar a hueco {h.slot + 1}</button>
                      ) : null}
                    </div>
                  );
                })() : null}
              </div>
            ) : null}

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
              <div className="action-row" style={{ marginTop: 16 }}>
                <button className="btn-primary" type="button" onClick={publish} disabled={photoCount < 1}>Publicar en catálogo</button>
                <button className="btn-ghost" type="button" onClick={hide} disabled={unit.mediaStatus !== "aprobado"}>Ocultar del catálogo</button>
              </div>
            ) : (
              <div className="locked-note">Tú cargas las fotos. Administrador o Gerencia publican, ocultan o rechazan foto a foto.</div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
