import { useState } from "react";
import { api, apiUpload, apiUrl } from "../api.js";
import { useLightbox } from "../media-lightbox.jsx";

const LABELS = [
  "Frontal (puertas)",
  "Posterior (panel ciego)",
  "Lateral izquierdo",
  "Lateral derecho",
  "Techo exterior",
  "Interior (piso)",
  "Interior (semi-cerrada)",
  "Placa CSC",
  "Sellos de puerta",
];

export default function GearMedia({ depotId, gear, canEdit, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bust, setBust] = useState(0);
  const [picked, setPicked] = useState("");
  const lb = useLightbox();
  const media = gear?.media || [];
  const photos = media.filter((item) => item.kind === "photo");
  const videos = media.filter((item) => item.kind === "video");

  async function run(work) {
    setBusy(true);
    setError("");
    try {
      await work();
      setBust(Date.now());
      await onSaved?.();
    } catch (e) {
      setError(e.message || "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  function upload(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    const body = new FormData();
    body.append("depotId", depotId);
    body.append("outsiderId", gear.id);
    files.forEach((file) => body.append("files", file));
    run(() => apiUpload("/yard/gear/media", body));
  }

  function place(mediaId, slot) {
    if (!mediaId) return;
    run(async () => {
      await api("/yard/gear/media/slot", { method: "POST", body: { depotId, outsiderId: gear.id, mediaId, slot } });
      setPicked("");
    });
  }

  function remove(mediaId) {
    if (picked === mediaId) setPicked("");
    run(() => api("/yard/gear/media/remove", { method: "POST", body: { depotId, outsiderId: gear.id, mediaId } }));
  }

  const src = (item) => `${apiUrl(`/yard/gear/${depotId}/${gear.id}/${item.id}`)}?t=${bust}`;

  function openPhoto(item) {
    const items = photos.map((photo) => ({ src: src(photo), type: "image", label: photo.name || "Foto" }));
    const index = Math.max(0, photos.findIndex((photo) => photo.id === item.id));
    lb.open(items, index);
  }

  return (
    <div className="gear-media">
      <h3>Fotos y videos</h3>
      <p className="section-sub">Las fotos son opcionales. Si no hay, la casilla queda vacía, igual que un DRY sin foto. Sube varias a la vez, elige una y ponla en la casilla.</p>
      {error ? <div className="err">{error}</div> : null}
      {canEdit ? (
        <label className="btn-primary gear-upload">
          {busy ? "Cargando…" : "Cargar fotos y videos"}
          <input
            type="file"
            accept="image/*,video/mp4,video/webm"
            multiple
            hidden
            disabled={busy}
            onChange={(event) => {
              upload(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}

      {photos.length ? (
        <>
          <div className="odoo-assign-thumbs">
            {photos.map((item) => (
              <div key={item.id} className={`odoo-assign-thumb${picked === item.id ? " on" : ""}`}>
                <button type="button" className="thumb-zoom" onClick={() => openPhoto(item)}>
                  <img src={src(item)} alt={item.name || "Foto"} />
                </button>
                {canEdit ? (
                  <button type="button" className="thumb-pick" disabled={busy} onClick={() => setPicked(picked === item.id ? "" : item.id)}>
                    {item.name || "Foto"}{Number.isInteger(item.slot) ? ` · ${LABELS[item.slot]}` : ""} · {picked === item.id ? "Elegida" : "Elegir"}
                  </button>
                ) : (
                  <span>{item.name || "Foto"}{Number.isInteger(item.slot) ? ` · ${LABELS[item.slot]}` : ""}</span>
                )}
                {canEdit ? (
                  <button type="button" className="thumb-arch" disabled={busy} onClick={() => remove(item.id)}>Quitar</button>
                ) : null}
              </div>
            ))}
          </div>
          {canEdit ? (
            picked ? (
              <div className="odoo-assign-slots">
                <b>Asignar a casilla</b>
                {LABELS.map((label, index) => {
                  const current = photos.find((item) => item.slot === index);
                  return (
                    <button key={label} type="button" className="btn-ghost" disabled={busy} onClick={() => place(picked, index)}>
                      {index + 1}. {label}{current ? " (reemplazar)" : ""}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="section-sub">Toca la imagen para verla. Pulsa «Elegir» y luego la casilla donde debe quedar.</p>
            )
          ) : null}
        </>
      ) : <p className="section-sub">Todavía no hay fotos. Al cargarlas, eliges una y la pones en una casilla.</p>}

      <div className="yard-detail-photos">
        {LABELS.map((label, index) => {
          const photo = photos.find((item) => item.slot === index);
          const aiming = canEdit && Boolean(picked);
          return (
            <div key={label} className={`yard-detail-slot${photo ? " has" : ""}${aiming ? " pick" : ""}`}>
              {aiming ? (
                <button type="button" className="slot-hit" disabled={busy} onClick={() => place(picked, index)}>
                  {photo ? <img src={src(photo)} alt={label} /> : <span className="n">{index + 1}</span>}
                  <span>{label}{photo ? "" : " · Vacío"}</span>
                </button>
              ) : (
                <>
                  {photo ? (
                    <button type="button" className="slot-hit" onClick={() => openPhoto(photo)}>
                      <img src={src(photo)} alt={label} />
                      <span>{label}</span>
                    </button>
                  ) : (
                    <>
                      <span className="n">{index + 1}</span>
                      <span>{label} · Vacío</span>
                    </>
                  )}
                </>
              )}
              {canEdit && photo && !aiming ? (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => place(photo.id, null)}>Vaciar</button>
              ) : null}
            </div>
          );
        })}
      </div>

      {videos.length ? (
        <>
          <h3>Videos</h3>
          <div className="gear-files">
            {videos.map((item) => (
              <div className="gear-file" key={item.id}>
                <video src={src(item)} controls />
                <span>{item.name || "Video"}</span>
                {canEdit ? <button className="btn-ghost" type="button" disabled={busy} onClick={() => remove(item.id)}>Quitar</button> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
      {lb.node}
    </div>
  );
}
