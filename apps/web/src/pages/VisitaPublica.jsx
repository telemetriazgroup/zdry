import { useEffect, useState } from "react";
import { api, apiUpload, apiUrl, ApiError } from "../api.js";

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

export default function VisitaPublica() {
  const [form, setForm] = useState(empty);
  const [locked, setLocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [photoStatus, setPhotoStatus] = useState("none");
  const [photoBust, setPhotoBust] = useState(0);

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
      setPhotoStatus(d.visit.photoStatus || "none");
      setPhotoBust(Date.now());
      setMsg(
        d.locked
          ? "Esta placa ya está vinculada a un contenedor. No se puede editar."
          : "Ficha ya guardada. Puedes corregir los datos y volver a enviar hasta que el coordinador vincule un contenedor.",
      );
    } catch {
      /* ignore lookup */
    }
  }

  useEffect(() => {
    const t = setTimeout(() => lookup(form.tractorPlate), 400);
    return () => clearTimeout(t);
  }, [form.tractorPlate]);

  async function submit(e) {
    e.preventDefault();
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
      } else {
        setPhotoStatus(v?.photoStatus || "none");
      }
      setLocked(!!v?.locked);
      setSaved(!!out.saved && !v?.locked);
      if (v?.locked) {
        setMsg("Registrado y vinculado. Espera en portería.");
      } else if (photoStatus === "pending" || photo) {
        setMsg("Ficha guardada. La foto queda pendiente de aprobación del coordinador. Puedes editar hasta que vinculen un contenedor.");
      } else {
        setMsg("Ficha guardada. Puedes editarla y volver a enviar hasta que el coordinador vincule un contenedor. Espera en portería.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    } finally {
      setBusy(false);
    }
  }

  function set(k, v) {
    if (locked) return;
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="panel visita-public">
      <h2 className="section-title">Visita de puerta</h2>
      <p className="section-sub">Identifícate con la placa del tracto. Si ya la usaste y aún no está vinculada a un contenedor, puedes corregir los datos.</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {saved && !locked ? (
        <div className="ok-msg">Datos guardados. El botón guarda los cambios de esta ficha.</div>
      ) : null}
      <form className="form-grid" onSubmit={submit}>
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
          {photoStatus !== "none" && !photo ? (
            <img className="visit-photo-preview" src={`${apiUrl(`/gate-visits/by-plate/${encodeURIComponent(form.tractorPlate)}/photo`)}?t=${photoBust}`} alt="Tu unidad" />
          ) : null}
          <div className="file-field" style={{ marginTop: 6 }}>
            <span className="file-field-name">
              {photo?.name
                || (photoStatus === "approved" ? "Foto enviada y aprobada"
                  : photoStatus === "pending" ? "Foto enviada · pendiente de aprobación"
                    : photoStatus === "rejected" ? "Foto rechazada · puedes cargar otra"
                      : "Ningún archivo seleccionado")}
            </span>
            <label className="btn-ghost">
              {photoStatus === "none" ? "Elegir foto" : "Cambiar foto"}
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
        <div className="action-row" style={{ gridColumn: "1 / -1" }}>
          <button className="btn-primary" type="submit" disabled={busy || locked}>
            {locked ? "Vinculada" : saved ? "Guardar cambios" : "Enviar"}
          </button>
        </div>
      </form>
    </div>
  );
}
