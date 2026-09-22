import { useEffect, useState } from "react";
import { api, formatWhen, APP_ROOT } from "../api.js";
import { useAuth } from "../auth.jsx";

const HOURS = [48, 72, 96, 120];
const KIND = {
  open: "Abrió el catálogo",
  view_unit: "Vio un DRY",
  whatsapp: "WhatsApp",
  cart: "Carrito",
  search: "Búsqueda",
};

function shareUrl(token) {
  const base = `${window.location.origin}${APP_ROOT === "/" ? "" : APP_ROOT.replace(/\/$/, "")}`;
  return `${base}/c/${token}`;
}

export default function CatalogShares() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    clientName: "",
    clientCompany: "",
    clientPhone: "",
    clientNote: "",
    vendorWhatsapp: user?.whatsapp || "",
    hours: 72,
  });

  async function load() {
    const list = await api("/catalog-shares");
    setRows(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function create(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const row = await api("/catalog-shares", { method: "POST", body: form });
      const url = shareUrl(row.token);
      await navigator.clipboard?.writeText(url).catch(() => {});
      setMsg(`Enlace para ${row.clientName} listo. Vigente ${row.hours} h. Copiado al portapapeles.`);
      setForm({ ...form, clientName: "", clientCompany: "", clientPhone: "", clientNote: "" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function open(id) {
    setOpenId(id);
    try {
      setDetail(await api(`/catalog-shares/mine/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Enlaces de catálogo</h2>
      <p className="section-sub">
        Modo promoción: creas un enlace con el nombre del cliente (48–120 h). El cliente ve el stock publicado y te escribe
        por WhatsApp. Tú cotizas. Aquí ves qué DRY revisó.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Nuevo enlace temporizado</h3>
        <form className="form-grid" onSubmit={create}>
          <div><label>Cliente</label><input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required placeholder="Nombre de quien recibe el link" /></div>
          <div><label>Empresa</label><input value={form.clientCompany} onChange={(e) => setForm({ ...form, clientCompany: e.target.value })} /></div>
          <div><label>Teléfono cliente</label><input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} /></div>
          <div>
            <label>Vigencia</label>
            <select value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{h} horas</option>)}
            </select>
          </div>
          <div><label>Tu WhatsApp</label><input value={form.vendorWhatsapp} onChange={(e) => setForm({ ...form, vendorWhatsapp: e.target.value })} required placeholder="51 9XX XXX XXX" /></div>
          <div><label>Nota</label><input value={form.clientNote} onChange={(e) => setForm({ ...form, clientNote: e.target.value })} placeholder="Opcional" /></div>
          <button className="btn-primary" type="submit">Generar enlace</button>
        </form>
      </div>

      <div className="dash-grid home-dash-grid">
        <div className="panel">
          <h3>Enlaces</h3>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Cliente</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.clientName}</b><br /><span className="muted">{r.clientCompany || r.vendorName}</span></td>
                    <td>{formatWhen(r.expiresAt)}</td>
                    <td>{r.live ? "Vigente" : "Vencido"}</td>
                    <td>
                      <button className="link-btn" type="button" onClick={() => open(r.id)}>Ver actividad</button>
                      {" "}
                      <button className="link-btn" type="button" onClick={() => navigator.clipboard?.writeText(shareUrl(r.token))}>Copiar</button>
                    </td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={4}>Aún no hay enlaces. Genera el primero para un cliente.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>{detail ? `Actividad · ${detail.clientName}` : "Actividad del cliente"}</h3>
          {!detail ? <p className="section-sub">Elige un enlace para ver los DRY que revisó.</p> : (
            <>
              <p className="section-sub">
                {shareUrl(detail.token)} · {detail.live ? `vence ${formatWhen(detail.expiresAt)}` : "vencido"}
              </p>
              <ul className="dash-list">
                {(detail.events || []).map((e) => (
                  <li key={e.id}>
                    <b>{KIND[e.kind] || e.kind}{e.iso ? ` · ${e.iso}` : ""}</b>
                    <span>{formatWhen(e.at)}</span>
                  </li>
                ))}
                {!detail.events?.length ? <li className="muted">El cliente aún no abrió el enlace.</li> : null}
              </ul>
            </>
          )}
          {openId && detail ? (
            <p className="section-sub" style={{ marginTop: 10 }}>
              <button className="btn-ghost" type="button" onClick={() => { setOpenId(""); setDetail(null); }}>Cerrar</button>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
