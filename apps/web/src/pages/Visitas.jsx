import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiUrl, publicUrl } from "../api.js";
import { useLightbox } from "../media-lightbox.jsx";
import { downloadVisitPdf } from "../visit-ticket.js";

const emptyForm = {
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

export default function Visitas() {
  const lb = useLightbox();
  const [params] = useSearchParams();
  const focusId = params.get("visita") || "";
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState(focusId ? "all" : "pending");
  const [iso, setIso] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const qr = typeof window !== "undefined" ? `${window.location.origin}${publicUrl("/visita")}` : "/zdry/visita";

  function openEdit(v) {
    setCreating(false);
    setEditing(v.id);
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
    setIso(v.containerIso || "");
  }

  async function load(f = filter) {
    const list = await api(`/gate-visits?filter=${f}`);
    setRows(list);
    if (focusId) {
      const hit = list.find((v) => v.id === focusId);
      if (hit) {
        if (hit.locked) {
          setEditing(null);
          setCreating(false);
          setMsg("Esta placa ya está vinculada a un contenedor.");
        } else {
          openEdit(hit);
        }
      }
    }
    return list;
  }

  useEffect(() => {
    load(focusId ? "all" : "pending").catch((e) => setError(e.message));
  }, [focusId]);

  async function saveEdit() {
    setError("");
    try {
      if (creating) {
        await api("/gate-visits", { method: "POST", body: { ...form, iso: iso || undefined } });
        setMsg("Visita registrada.");
      } else {
        await api(`/gate-visits/${editing}`, { method: "PATCH", body: form });
        setMsg("Visita actualizada. Puedes volver a vincularla a otro contenedor.");
      }
      setEditing(null);
      setCreating(false);
      setForm(emptyForm);
      await load(filter);
    } catch (e) {
      setError(e.message);
    }
  }

  async function link(id) {
    setError("");
    try {
      await api(`/gate-visits/${id}/link`, { method: "POST", body: { iso } });
      setMsg(`Visita vinculada a ${iso.toUpperCase()}. El chofer ya no puede editar.`);
      setIso("");
      await load(filter);
    } catch (e) {
      setError(e.message);
    }
  }

  async function unlink(id) {
    setError("");
    try {
      await api(`/gate-visits/${id}/unlink`, { method: "POST" });
      setMsg("Visita desvinculada. El chofer puede corregir datos y puedes enlazarla a otro DRY.");
      await load(filter);
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(id) {
    if (!window.confirm("¿Eliminar esta visita?")) return;
    setError("");
    try {
      await api(`/gate-visits/${id}`, { method: "DELETE" });
      setMsg("Visita eliminada.");
      if (editing === id) setEditing(null);
      await load(filter);
    } catch (e) {
      setError(e.message);
    }
  }

  async function reviewPhoto(id, approve) {
    setError("");
    try {
      await api(`/gate-visits/${id}/photo/${approve ? "approve" : "reject"}`, { method: "POST" });
      setMsg(approve ? "Foto aprobada. Patio ya puede contrastarla." : "Foto rechazada.");
      await load(filter);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="panel">
      <div className="visita-brand visitas-brand">
        <img src={publicUrl("/brand/zg_marca.png")} alt="ZGROUP" />
      </div>
      <h3>Visitas de puerta</h3>
      <p className="section-sub">
        QR de portería (URL fija): <a href={qr} target="_blank" rel="noreferrer">{qr}</a>
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <div className="recv-actions">
        <button className={`btn-ghost ${filter === "pending" ? "on" : ""}`} type="button" onClick={() => { setFilter("pending"); load("pending"); }}>Pendientes</button>
        <button className={`btn-ghost ${filter === "linked" ? "on" : ""}`} type="button" onClick={() => { setFilter("linked"); load("linked"); }}>Vinculadas</button>
        <button className={`btn-ghost ${filter === "all" ? "on" : ""}`} type="button" onClick={() => { setFilter("all"); load("all"); }}>Todas</button>
        <button className="btn-primary" type="button" onClick={() => { setCreating(true); setEditing("new"); setForm(emptyForm); setIso(""); }}>
          + Registrar visita
        </button>
      </div>
      {editing ? (
        <div className="archive-box" style={{ margin: "12px 0" }}>
          <b>{creating ? "Nueva visita" : "Editar visita"}</b>
          <p className="section-sub">Puedes corregir los datos del chofer y vincularlos al DRY que está ingresando.</p>
          <div className="form-grid">
            <div><label>Placa tracto</label><input value={form.tractorPlate} onChange={(e) => setForm({ ...form, tractorPlate: e.target.value.toUpperCase() })} /></div>
            <div><label>Empresa</label><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
            <div><label>RUC</label><input value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value })} /></div>
            <div><label>Conductor</label><input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} /></div>
            <div><label>Hora</label><input type="datetime-local" value={form.visitAt} onChange={(e) => setForm({ ...form, visitAt: e.target.value })} /></div>
            <div><label>Brevete</label><input value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value })} /></div>
            <div>
              <label>Motivo</label>
              <select value={form.motive} onChange={(e) => setForm({ ...form, motive: e.target.value })}>
                <option value="descargar">Descargar</option>
                <option value="cargar">Cargar</option>
              </select>
            </div>
            <div><label>Placa carreta</label><input value={form.trailerPlate} onChange={(e) => setForm({ ...form, trailerPlate: e.target.value.toUpperCase() })} /></div>
            <div><label>Teléfono</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            {creating ? (
              <div><label>ISO a vincular (opcional)</label><input value={iso} onChange={(e) => setIso(e.target.value.toUpperCase())} /></div>
            ) : null}
          </div>
          <div className="action-row" style={{ marginTop: 8 }}>
            <button className="btn-primary" type="button" onClick={saveEdit}>{creating ? "Registrar" : "Guardar cambios"}</button>
            <button className="btn-ghost" type="button" onClick={() => { setEditing(null); setCreating(false); }}>Cancelar</button>
          </div>
        </div>
      ) : null}
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr><th>Tracto</th><th>Conductor</th><th>Motivo</th><th>Foto unidad</th><th>ISO</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((v) => (
                <tr key={v.id} className={focusId === v.id ? "visit-focus" : undefined}>
                <td><b>{v.tractorPlate}</b><div className="recv-who">{v.company} · {v.phone}</div></td>
                <td>{v.driverName || "—"}</td>
                <td>{v.motive}</td>
                <td>
                  {v.hasPhoto ? (
                    <div>
                      <button
                        type="button"
                        className="visit-photo-btn"
                        onClick={() => lb.open([{
                          src: apiUrl(`/gate-visits/${v.id}/photo`),
                          type: "image",
                          label: `Foto ${v.tractorPlate}`,
                        }])}
                      >
                        <img className="visit-photo-preview" src={apiUrl(`/gate-visits/${v.id}/photo`)} alt="" />
                      </button>
                      <div className="recv-who">
                        {v.photoStatus === "approved" ? "Aprobada" : v.photoStatus === "rejected" ? "Rechazada" : "Pendiente"}
                      </div>
                      {v.photoStatus !== "approved" ? (
                        <button className="link-btn" type="button" onClick={() => reviewPhoto(v.id, true)}>Aprobar</button>
                      ) : (
                        <button className="link-btn" type="button" onClick={() => reviewPhoto(v.id, false)}>Rechazar</button>
                      )}
                    </div>
                  ) : (
                    <span className="recv-who">Sin foto</span>
                  )}
                </td>
                <td>
                  {v.containerIso ? (
                    <div>
                      <b>{v.containerIso}</b>
                      <div className="recv-who">Esta placa ya está vinculada a un contenedor.</div>
                    </div>
                  ) : "—"}
                </td>
                <td>
                  <div className="action-row" style={{ flexWrap: "wrap" }}>
                    {v.locked ? (
                      <>
                        <button className="btn-primary" type="button" onClick={() => downloadVisitPdf(v, v.hasPhoto ? apiUrl(`/gate-visits/${v.id}/photo`) : "").catch((e) => setError(e.message))}>Descargar PDF</button>
                        <button className="btn-ghost" type="button" onClick={() => unlink(v.id)}>Desvincular</button>
                      </>
                    ) : (
                      <>
                        <button className="btn-ghost" type="button" onClick={() => openEdit(v)}>Editar</button>
                        <input placeholder="ISO" value={iso} onChange={(e) => setIso(e.target.value.toUpperCase())} style={{ width: 130 }} />
                        <button className="btn-primary" type="button" onClick={() => link(v.id)}>Vincular</button>
                        <button className="btn-ghost" type="button" onClick={() => remove(v.id)}>Eliminar</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="section-sub">No hay visitas en este filtro.</p> : null}
      {lb.node}
    </div>
  );
}
