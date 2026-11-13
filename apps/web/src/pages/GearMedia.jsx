import { useState } from "react";
import { api, apiUpload, apiUrl } from "../api.js";

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
  const media = gear?.media || [];
  const photos = media.filter((item) => item.kind === "photo");

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
    run(() => api("/yard/gear/media/slot", { method: "POST", body: { depotId, outsiderId: gear.id, mediaId, slot } }));
  }

  function remove(mediaId) {
    run(() => api("/yard/gear/media/remove", { method: "POST", body: { depotId, outsiderId: gear.id, mediaId } }));
  }

  const src = (item) => `${apiUrl(`/yard/gear/${depotId}/${gear.id}/${item.id}`)}?t=${bust}`;

  return (
    <div className="gear-media">
      <h3>Fotos y videos</h3>
      <p className="section-sub">Las fotos son opcionales. Si no hay, la casilla queda vacía, igual que un DRY sin foto. Sube varias a la vez y elige cuál va en cada vista.</p>
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
      <div className="yard-detail-photos">
        {LABELS.map((label, index) => {
          const photo = photos.find((item) => item.slot === index);
          return (
            <div key={label} className={`yard-detail-slot${photo ? " has" : ""}`}>
              {photo ? <img src={src(photo)} alt={label} /> : <span className="n">{index + 1}</span>}
              <span>{label}{photo ? "" : " · Vacío"}</span>
              {canEdit ? (
                <select
                  aria-label={`Foto de ${label}`}
                  value={photo?.id || ""}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!next && photo) place(photo.id, null);
                    else if (next) place(next, index);
                  }}
                >
                  <option value="">Sin foto</option>
                  {photos.map((item) => (
                    <option key={item.id} value={item.id}>{item.name || `Foto ${item.id.slice(0, 6)}`}</option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>
      <h3>Archivos del equipo</h3>
      {media.length ? (
        <div className="gear-files">
          {media.map((item) => (
            <div className="gear-file" key={item.id}>
              {item.kind === "video" ? <video src={src(item)} controls /> : <img src={src(item)} alt={item.name || "Foto"} />}
              <span>{item.name || (item.kind === "video" ? "Video" : "Foto")}{Number.isInteger(item.slot) ? ` · ${LABELS[item.slot]}` : ""}</span>
              {canEdit ? <button className="btn-ghost" type="button" disabled={busy} onClick={() => remove(item.id)}>Quitar</button> : null}
            </div>
          ))}
        </div>
      ) : <p className="section-sub">Todavía no hay fotos ni videos.</p>}
    </div>
  );
}
