import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload, ApiError, apiUrl, formatWhen } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useLightbox } from "../media-lightbox.jsx";
import VideoMarks, { videoSilenceProps } from "../video-marks.jsx";
import { EvalGrid } from "../eval-ratings.jsx";

const PAGE_SIZE = 20;

const GRADES = [
  { value: "", label: "—" },
  { value: "bueno", label: "Bueno" },
  { value: "regular", label: "Regular" },
  { value: "malo", label: "Malo" },
];

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
  const canPrice = canApprove;
  const lb = useLightbox();
  const [meta, setMeta] = useState({ photoLabels: [] });
  const [rows, setRows] = useState([]);
  const [iso, setIso] = useState("");
  const [unit, setUnit] = useState(null);
  const [notes, setNotes] = useState("");
  const [conds, setConds] = useState({ conditionFloor: "", conditionRoof: "", conditionDoors: "", conditionPaint: "" });
  const [rejectNote, setRejectNote] = useState("");
  const [rejectingSlot, setRejectingSlot] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [bust, setBust] = useState(0);
  const [preview, setPreview] = useState(null);
  const [histPreview, setHistPreview] = useState(null);
  const [portrait, setPortrait] = useState({});
  const [offer, setOffer] = useState(null);
  const [priceNet, setPriceNet] = useState("");
  const [showMode, setShowMode] = useState("inherit");
  const [priceNote, setPriceNote] = useState("");
  const [priceBusy, setPriceBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  async function loadOffer(nextIso) {
    if (!canPrice || !nextIso) {
      setOffer(null);
      return;
    }
    try {
      const o = await api(`/catalog-media/${nextIso}/price`);
      setOffer(o);
      setPriceNet(String(o.priceList ?? ""));
      setShowMode(o.visibility || "inherit");
    } catch {
      setOffer(null);
    }
  }

  const loadList = useCallback(() => {
    api("/catalog-media").then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api("/catalog-media/meta").then(setMeta).catch(() => {});
    loadList();
  }, [loadList]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  async function open(nextIso) {
    setError("");
    setMsg("");
    const u = await api(`/catalog-media/${nextIso}`);
    setIso(nextIso);
    setPortrait({});
    setUnit(u);
    setNotes(u.inspectionNotes || "");
    setConds({
      conditionFloor: u.conditionFloor || "",
      conditionRoof: u.conditionRoof || "",
      conditionDoors: u.conditionDoors || "",
      conditionPaint: u.conditionPaint || "",
    });
    setBust(Date.now());
    setPreview(firstPreview(u));
    setHistPreview(null);
    setRejectingSlot(null);
    await loadOffer(nextIso);
  }

  async function applyUnit(u, text) {
    setUnit(u);
    setBust(Date.now());
    setMsg(text);
    setRejectingSlot(null);
    setRejectNote("");
    loadList();
  }

  async function saveOffer(recompute = false) {
    if (!iso || !canPrice) return;
    setError("");
    setPriceBusy(true);
    try {
      const o = await api(`/catalog-media/${iso}/price`, {
        method: "PATCH",
        body: recompute
          ? { recompute: true, visibility: showMode, note: priceNote }
          : { priceNet: Number(priceNet), visibility: showMode, note: priceNote },
      });
      setOffer(o);
      setPriceNet(String(o.priceList ?? ""));
      setShowMode(o.visibility || "inherit");
      setPriceNote("");
      setMsg(recompute ? "Precio recalculado según reglas." : "Precio de oferta guardado. Queda en el historial.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    } finally {
      setPriceBusy(false);
    }
  }

  async function saveNotes() {
    try {
      const u = await api(`/catalog-media/${iso}`, {
        method: "PATCH",
        body: { inspectionNotes: notes, ...conds },
      });
      setConds({
        conditionFloor: u.conditionFloor || "",
        conditionRoof: u.conditionRoof || "",
        conditionDoors: u.conditionDoors || "",
        conditionPaint: u.conditionPaint || "",
      });
      await applyUnit(u, "Evaluación y descripción guardadas. No salen al catálogo público.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    }
  }

  async function saveRating(conceptId, levelId) {
    if (!iso || !levelId) return;
    try {
      const u = await api(`/catalog-media/${iso}/ratings`, { method: "POST", body: { conceptId, levelId } });
      await applyUnit(u, "Evaluación actualizada.");
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

  function markOrientation(slot, el) {
    if (!el?.naturalWidth) return;
    const vertical = el.naturalHeight > el.naturalWidth;
    setPortrait((p) => (p[slot] === vertical ? p : { ...p, [slot]: vertical }));
  }

  async function publish() {
    const names = unit?.photoLabels || meta.photoLabels || [];
    const verticals = Object.entries(portrait)
      .filter(([, v]) => v)
      .map(([slot]) => `${Number(slot) + 1}. ${names[Number(slot)] || `Foto ${Number(slot) + 1}`}`);
    if (verticals.length) {
      const ok = window.confirm(
        `Estas fotos están en vertical y no cubren el ancho de la ficha web (quedan bandas a los lados):\n\n${verticals.join("\n")}\n\n¿Publicar igual? Lo ideal es reemplazarlas por fotos horizontales del contenedor.`,
      );
      if (!ok) return;
    }
    try {
      const u = await api(`/catalog-media/${iso}/approve`, { method: "POST", body: {} });
      await applyUnit(u, "Visible en el catálogo. Las fotos horizontales cubren todo el ancho. El original de patio no se toca.");
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
  const photoItems = unit
    ? labels
      .map((label, i) => (unit.photoSlots[i] ? { src: photoSrc(i), type: "image", label: `${i + 1}. ${label}` } : null))
      .filter(Boolean)
    : [];
  const markSrc = apiUrl("/catalog-media/watermark");
  const filteredRows = useMemo(() => {
    const raw = q.trim().toUpperCase();
    const compact = raw.replace(/[\s-]/g, "");
    if (!raw) return rows;
    return rows.filter((r) => {
      const hay = [r.iso, r.type, r.cat, r.depotName, r.manufacturer, r.registeredByName, STATUS[r.mediaStatus]?.label]
        .filter(Boolean)
        .join(" ")
        .toUpperCase();
      return hay.includes(raw) || hay.replace(/[\s-]/g, "").includes(compact);
    });
  }, [rows, q]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const videoItem = unit?.hasVideo ? { src: videoSrc, type: "video", label: "Video 360°", watermark: markSrc } : null;
  const histItems = (unit?.history || []).map((h) => ({
    src: histSrc(h.id),
    type: "image",
    label: `Historial · hueco ${h.slot + 1} · ${h.label}`,
  }));
  const unitItems = [...photoItems, ...(videoItem ? [videoItem] : [])];
  const allItems = [...unitItems, ...histItems];
  function openStage() {
    if (histPreview) {
      const idx = (unit.history || []).findIndex((h) => h.id === histPreview);
      lb.open(allItems, unitItems.length + Math.max(0, idx));
      return;
    }
    if (previewingVideo) {
      lb.open(unitItems, photoItems.length);
      return;
    }
    if (previewingPhoto) {
      const idx = photoItems.findIndex((x) => x.src === photoSrc(preview.slot));
      lb.open(unitItems, Math.max(0, idx));
    }
  }

  return (
    <>
      <h2 className="section-title">Ficha multimedia del catálogo</h2>
      <p className="section-sub">Fotos de inspección, evaluación interna (piso / techo / puertas / pintura) y publicación. La marca de agua se aplica a la copia pública, no al original.</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="dash-grid">
        <div className="panel">
          <h3>Unidades en stock</h3>
          {canApprove ? (
            <p className="section-sub">
              La marca de agua y el recorte de la ficha pública se configuran en{" "}
              <Link to="/app/configuracion">Configuración</Link>
              {meta.watermarkName ? ` (ahora: ${meta.watermarkName}).` : "."}
            </p>
          ) : null}
          <div className="odoo-toolbar">
            <input
              className="odoo-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar ISO, tipo, depósito o quien ingresó…"
              aria-label="Buscar unidades del catálogo"
            />
          </div>
          <p className="section-sub">
            {filteredRows.length} unidad{filteredRows.length === 1 ? "" : "es"}
            {q.trim() ? ` de ${rows.length}` : ""}. Se listan de {PAGE_SIZE} en {PAGE_SIZE}.
          </p>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr><th>ISO</th><th>Tipo</th><th>Ingreso</th><th>Fotos</th><th>Historial</th><th>Video</th><th>Catálogo</th></tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
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
          {!pageRows.length ? <p className="section-sub">Ninguna unidad coincide con la búsqueda.</p> : null}
          {pages > 1 ? (
            <div className="odoo-pager">
              <button className="btn-ghost" type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Anterior</button>
              <span>Página {safePage} / {pages}</span>
              <button className="btn-ghost" type="button" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Siguiente</button>
            </div>
          ) : null}
        </div>

        {unit ? (
          <div className="panel">
            <h3>{unit.iso}</h3>
            <p className="section-sub">{unit.type} · {unit.cat} · {unit.depotName} · {unit.manufacturer} {unit.year || ""}</p>
            <p className="recv-who">Ingresó {unit.registeredByName || "—"} · {formatWhen(unit.createdAt)}</p>
            <div style={{ color: st.color, fontWeight: 800, marginBottom: 10 }}>{st.label}</div>
            <p className="section-sub">{photoCount} foto{photoCount === 1 ? "" : "s"} activa{photoCount === 1 ? "" : "s"}{unit.hasVideo ? " · video 360°" : ""}{(unit.history || []).length ? ` · ${(unit.history || []).length} en historial` : ""}.</p>

            <div className={`media-stage ${histPreview || previewingVideo || previewingPhoto ? "has-media" : ""}`}>
              {histPreview ? (
                <img key={histSrc(histPreview)} src={histSrc(histPreview)} alt="Foto de historial" onClick={openStage} />
              ) : previewingVideo ? (
                <>
                  <video key={videoSrc} src={videoSrc} controls autoPlay {...videoSilenceProps()} onClick={(e) => e.stopPropagation()} />
                  <VideoMarks src={markSrc} />
                  <button className="gallery-expand" type="button" onClick={openStage}>Ampliar</button>
                </>
              ) : previewingPhoto ? (
                <img
                  key={photoSrc(preview.slot)}
                  src={photoSrc(preview.slot)}
                  alt={labels[preview.slot] || `Foto ${preview.slot + 1}`}
                  onLoad={(e) => markOrientation(preview.slot, e.currentTarget)}
                  onClick={openStage}
                />
              ) : (
                <span className="muted">Carga una foto o elige una del historial para previsualizarla.</span>
              )}
            </div>

            <div className="media-slots">
              {labels.map((label, i) => {
                const filled = !!unit.photoSlots[i];
                const active = !histPreview && preview?.type === "photo" && preview.slot === i;
                const inputId = `media-photo-${unit.iso}-${i}`;
                const vertical = !!portrait[i];
                return (
                  <div key={i} className={`media-slot ${filled ? "filled" : ""} ${active ? "active" : ""} ${vertical ? "portrait" : ""}`}>
                    {filled ? (
                      <>
                        <button
                          type="button"
                          className="media-slot-preview"
                          onClick={() => {
                            setHistPreview(null);
                            setPreview({ type: "photo", slot: i });
                            const idx = photoItems.findIndex((x) => x.src === photoSrc(i));
                            lb.open(unitItems, Math.max(0, idx));
                          }}
                        >
                          <img src={photoSrc(i)} alt={label} onLoad={(e) => markOrientation(i, e.currentTarget)} />
                        </button>
                        <span className="slot-label">{i + 1}. {label}{vertical ? " · vertical" : ""}</span>
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
                        <button
                          type="button"
                          className="media-slot-preview"
                          onClick={() => {
                            setHistPreview(null);
                            setPreview({ type: "video" });
                            lb.open(unitItems, photoItems.length);
                          }}
                        >
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
                      <button
                        type="button"
                        className="media-slot-preview"
                        onClick={() => {
                          setHistPreview(h.id);
                          const idx = (unit.history || []).findIndex((x) => x.id === h.id);
                          lb.open(allItems, unitItems.length + Math.max(0, idx));
                        }}
                      >
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

            <h4 style={{ fontSize: 14, margin: "16px 0 8px" }}>Evaluación interna</h4>
            <p className="section-sub">Conceptos que arma el admin. Solo staff; el cliente no lo ve.</p>
            {(meta.evaluationConcepts || []).length ? (
              <EvalGrid
                concepts={meta.evaluationConcepts}
                levels={meta.evaluationLevels}
                ratings={unit.ratings}
                onChange={saveRating}
              />
            ) : (
              <div className="odoo-form">
                {[
                  ["conditionFloor", "Piso"],
                  ["conditionRoof", "Techo"],
                  ["conditionDoors", "Puertas"],
                  ["conditionPaint", "Pintura"],
                ].map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <select value={conds[key] || ""} onChange={(e) => setConds((c) => ({ ...c, [key]: e.target.value }))}>
                      {GRADES.map((g) => <option key={g.value || "empty"} value={g.value}>{g.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}

            <label style={{ marginTop: 16, display: "block" }}>Descripción para el cliente</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              style={{ width: "100%", padding: 8, border: "1px solid var(--line)", borderRadius: 7, font: "inherit" }}
              placeholder="Estado de la unidad, particularidades, qué ve el cliente en la ficha…"
            />
            <button className="btn-ghost" type="button" style={{ marginTop: 8 }} onClick={saveNotes}>Guardar evaluación y descripción</button>

            {canPrice && offer ? (
              <div className="offer-box">
                <h4>Precio de oferta</h4>
                <p className="section-sub"><b>{offer.title}</b></p>
                <p className="section-sub">{offer.detail}</p>
                <p className="section-sub">{offer.visibilityLabel}</p>
                <div className="form-grid">
                  <div>
                    <label>Neto USD (sin IGV)</label>
                    <input type="number" min="1" step="1" value={priceNet} onChange={(e) => setPriceNet(e.target.value)} />
                  </div>
                  <div>
                    <label>IGV 18%</label>
                    <input readOnly value={priceNet ? Math.round(Number(priceNet) * 0.18) : ""} />
                  </div>
                  <div>
                    <label>Con IGV</label>
                    <input readOnly value={priceNet ? Math.round(Number(priceNet) * 1.18) : ""} />
                  </div>
                  <div>
                    <label>Qué ve el cliente</label>
                    <select value={showMode} onChange={(e) => setShowMode(e.target.value)}>
                      <option value="show">Mostrar este precio</option>
                      <option value="request">No mostrar — solicitar precio</option>
                      <option value="inherit">Según reglas (CIMC visible, resto consulta)</option>
                    </select>
                  </div>
                </div>
                <label>Nota del cambio (opcional)</label>
                <input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} placeholder="Ej. ajuste por 1-trip 2025" maxLength={240} />
                <div className="action-row" style={{ marginTop: 8 }}>
                  <button className="btn-primary" type="button" disabled={priceBusy} onClick={() => saveOffer(false)}>Guardar precio</button>
                  <button className="btn-ghost" type="button" disabled={priceBusy} onClick={() => saveOffer(true)}>Recalcular por reglas</button>
                </div>
                {(offer.history || []).length ? (
                  <div className="offer-hist">
                    <b>Historial de precio</b>
                    <ul>
                      {offer.history.map((h) => (
                        <li key={h.id}>
                          {formatWhen(h.createdAt)} · {h.changedByName} · neto ${Math.round(Number(h.priceList))}
                          {h.source === "manual" ? " (oferta)" : " (regla)"}
                          {h.showPrice ? " · visible" : " · solicitar precio"}
                          {h.note ? ` — ${h.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="section-sub" style={{ marginTop: 8 }}>Aún no hay cambios guardados. El primer ajuste queda aquí.</p>
                )}
              </div>
            ) : null}

            {Object.values(portrait).some(Boolean) ? (
              <div className="warn-inline" style={{ marginTop: 14 }}>
                Hay fotos verticales. En la web no cubren el ancho (bandas a los lados). Cámbialas por tomas horizontales del contenedor antes de publicar.
              </div>
            ) : null}

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
      {lb.node}
    </>
  );
}
