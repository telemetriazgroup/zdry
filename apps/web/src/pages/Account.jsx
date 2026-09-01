import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload, ApiError, publicUrl } from "../api.js";
import { useAuth } from "../auth.jsx";
import SiteFooter from "./SiteFooter.jsx";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const STATUS_LABEL = {
  nueva: "Nueva — el comercial te enviará la cotización",
  cotizada: "Cotizada — ya puedes pedir reserva o descuento",
  reservada: "Reservada 48 h — transfiere y adjunta el voucher",
  en_negociacion: "En negociación con tu comercial",
  comprobante_subido: "Comprobante recibido",
  en_verificacion: "Pago en verificación (interbancario 24–48 h)",
  pago_validado: "Pago validado",
  pago_rechazado: "Pago rechazado — puedes re-subir el voucher",
  asignacion_confirmada: "ISO asignado",
  despacho_programado: "Despacho programado",
  perdida: "Perdida",
  expirada: "Expirada",
};

function canPay(status) {
  return ["reservada", "en_negociacion", "pago_rechazado", "comprobante_subido"].includes(status);
}

function BankBox({ accounts }) {
  if (!accounts?.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 18, background: "#fff7ed", borderColor: "#fcd9b6" }}>
      <h3>Cuentas ZDRY para transferencia</h3>
      <p className="section-sub">Paga el neto cotizado por transferencia o interbancario y sube el voucher. El abono CCI puede tardar 24–48 h: tu comercial lo marcará «en verificación» hasta que acredite. No hay pasarela de cobro.</p>
      <div className="tablewrap">
      <table className="data">
        <thead><tr><th>Banco</th><th>Moneda</th><th>Cuenta</th><th>CCI</th><th>Titular</th></tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.cci}>
              <td>{a.bank}</td>
              <td>{a.currency}</td>
              <td className="card-iso">{a.account}</td>
              <td className="card-iso">{a.cci}</td>
              <td>{a.holder}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default function Account() {
  const { user, logout, refreshUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bank, setBank] = useState("BCP");
  const [op, setOp] = useState("");
  const [form, setForm] = useState({ companyName: "", rucDni: "", contactName: "", phone: "" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(() => {
    api("/account").then((p) => {
      setProfile(p);
      setForm({
        companyName: p.customer?.companyName || "",
        rucDni: p.customer?.rucDni || "",
        contactName: p.contact?.name || user.name,
        phone: p.customer?.phone || "",
      });
    }).catch((e) => setError(e.message));
    api("/account/quotes").then(setQuotes).catch((e) => setError(e.message));
  }, [user.name]);

  useEffect(() => { load(); }, [load]);

  async function saveProfile(e) {
    e.preventDefault();
    setError("");
    try {
      const p = await api("/account/profile", { method: "PUT", body: form });
      setProfile(p);
      await refreshUser();
      setNotice("Datos guardados.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function openQuote(id) {
    setError("");
    const q = await api(`/quotes/${id}`);
    setOpen(id);
    setDetail(q);
  }

  async function sendMsg(e) {
    e.preventDefault();
    try {
      const q = await api(`/quotes/${open}/thread`, { method: "POST", body: { body: msg } });
      setDetail(q);
      setMsg("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function uploadVoucher(e) {
    const file = e.target.files?.[0];
    if (!file || !open) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("bank", bank);
    fd.append("operationNumber", op);
    try {
      const q = await apiUpload(`/quotes/${open}/vouchers`, fd);
      setDetail(q);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function accept(eid) {
    const q = await api(`/quotes/${open}/extras/${eid}/accept`, { method: "POST", body: {} });
    setDetail(q);
  }

  const incomplete = profile && !profile.complete;

  return (
    <div className="site-page">
      <header className="topbar">
        <div className="topbar-inner topbar-public">
          <Link to="/" className="brand"><img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></Link>
          <nav className="navtabs">
            <Link to="/" className="navtab">Catálogo</Link>
            <Link to="/mi-cuenta" className="navtab active-link">Mi cuenta</Link>
          </nav>
          <div className="topbar-tools">
            <span className="topbar-user">{user.name}</span>
            <button className="btn-primary btn-salir" type="button" onClick={() => logout()}>Salir</button>
          </div>
        </div>
      </header>
      <div className="page">
        <h2 className="section-title">Mi cuenta</h2>
        <p className="section-sub">
          Empresa y persona de contacto son obligatorios para cotizar, pedir descuento al comercial y pagar.
          El catálogo público solo deja ver stock y armar el carrito.
        </p>
        {error ? <div className="err">{error}</div> : null}
        {notice ? <div className="ok-msg">{notice}</div> : null}
        {incomplete ? (
          <div className="err">Faltan datos: {(profile.missing || []).join(", ")}. Complétalos para negociar o adjuntar el voucher.</div>
        ) : null}

        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Empresa y contacto</h3>
          <form className="form-grid" onSubmit={saveProfile}>
            <div>
              <label>Empresa</label>
              <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required />
            </div>
            <div>
              <label>RUC / DNI</label>
              <input value={form.rucDni} onChange={(e) => setForm({ ...form, rucDni: e.target.value })} required />
            </div>
            <div>
              <label>Persona de contacto</label>
              <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} required />
            </div>
            <div>
              <label>Teléfono</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
            </div>
            <button className="btn-primary" type="submit">Guardar datos</button>
          </form>
        </div>

        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Cambiar clave</h3>
          {user?.impersonator ? (
            <p className="section-sub">En una sesión asistida no se cambia la clave. Restablécela en Personas.</p>
          ) : (
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                try {
                  await api("/auth/password", { method: "POST", body: { currentPassword, newPassword } });
                  setCurrentPassword("");
                  setNewPassword("");
                  setNotice("Clave actualizada.");
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : err.message);
                }
              }}
            >
              <div><label>Clave actual</label><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></div>
              <div><label>Nueva clave (mín. 8)</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></div>
              <button className="btn-primary" type="submit">Cambiar clave</button>
            </form>
          )}
        </div>

        <BankBox accounts={profile?.paymentAccounts} />

        <div className="dash-grid">
          <div className="panel">
            <h3>Cotizaciones</h3>
            <div className="tablewrap">
            <table className="data">
              <thead><tr><th>N°</th><th>Estado</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td>{q.number}{q.demo ? <span className="demo-chip">DEMO</span> : null}</td>
                    <td>{STATUS_LABEL[q.dealStatus] || q.dealStatus}</td>
                    <td>{money(q.totals.gross)}</td>
                    <td><button className="link-btn" type="button" onClick={() => openQuote(q.id)}>Ver</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          {detail ? (
            <div className="panel">
              <h3>{detail.number}</h3>
              <p className="section-sub">{STATUS_LABEL[detail.dealStatus]} · asesor {detail.vendor?.name}</p>
              <ul>
                {detail.lines.map((l) => <li key={l.id}>{l.iso} · neto {money(l.priceNet)} · IGV {money(l.priceNet * 0.18)}</li>)}
              </ul>
              <div className="cost-total" style={{ margin: "8px 0" }}>
                <span>Total a transferir</span>
                <b>{money(detail.totals.gross)}</b>
              </div>
              {["nueva", "cotizada"].includes(detail.dealStatus) ? (
                <div className="locked-note">Cuando tu comercial envíe/reserve la cotización (hold 48 h) podrás negociar descuento y transferir a las cuentas ZDRY.</div>
              ) : null}
              <div style={{ maxHeight: 180, overflow: "auto", background: "var(--bg)", padding: 10, borderRadius: 8, margin: "12px 0" }}>
                {detail.messages.map((m) => (
                  <div key={m.id} style={{ marginBottom: 8 }}>
                    <b>{m.authorName}</b> <span className="muted">{m.authorRole}</span>
                    <div>{m.body}</div>
                  </div>
                ))}
              </div>
              {["reservada", "en_negociacion"].includes(detail.dealStatus) ? (
                <form className="inline-form" onSubmit={sendMsg}>
                  <input style={{ flex: 1 }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Pedir descuento al comercial (antes de pagar)…" />
                  <button className="btn-primary" type="submit">Enviar</button>
                </form>
              ) : null}
              {canPay(detail.dealStatus) ? (
                <div style={{ marginTop: 14 }}>
                  <div className="box-kicker">Adjuntar voucher de transferencia</div>
                  <select value={bank} onChange={(e) => setBank(e.target.value)}>
                    {(profile?.paymentAccounts || [{ bank: "BCP" }, { bank: "Interbank" }]).map((a) => (
                      <option key={a.bank} value={a.bank}>{a.bank}</option>
                    ))}
                  </select>
                  <input value={op} onChange={(e) => setOp(e.target.value)} placeholder="N° operación / referencia" style={{ marginTop: 6, width: "100%" }} />
                  <input type="file" accept="application/pdf,image/*" onChange={uploadVoucher} style={{ marginTop: 8 }} />
                </div>
              ) : null}
              {detail.extras.filter((e) => !e.accepted).map((e) => (
                <div key={e.id} style={{ marginTop: 10 }}>
                  {e.label} — {money(e.amount)}
                  <button className="link-btn" type="button" onClick={() => accept(e.id)}>Aceptar</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
