import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { homeFor, ROLE_LABELS, useAuth } from "../auth.jsx";

const RISK = ["A", "B", "C", "D"];
const ROLES = [
  { id: "admin", label: "Administrador" },
  { id: "gerente", label: "Gerente" },
  { id: "vendedor", label: "Vendedor" },
  { id: "compras", label: "Compras" },
  { id: "almacen", label: "Almacén" },
];

export default function People() {
  const { user, impersonate } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("customers");
  const [customers, setCustomers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [collabs, setCollabs] = useState([]);
  const [error, setError] = useState("");
  const [cForm, setCForm] = useState({ rucDni: "", companyName: "", email: "", phone: "", risk: "B" });
  const [pForm, setPForm] = useState({ name: "", type: "Transporte", rate: "0", unit: "viaje" });
  const [uForm, setUForm] = useState({ email: "", name: "", role: "vendedor", password: "Zdry123!" });
  const [resetId, setResetId] = useState(null);
  const [resetPw, setResetPw] = useState("");

  async function load() {
    const [c, p, u] = await Promise.all([
      api("/people/customers"),
      api("/people/providers"),
      api("/people/collaborators"),
    ]);
    setCustomers(c); setProviders(p); setCollabs(u);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function addCustomer(e) {
    e.preventDefault();
    try {
      await api("/people/customers", { method: "POST", body: cForm });
      setCForm({ rucDni: "", companyName: "", email: "", phone: "", risk: "B" });
      await load();
    } catch (err) { setError(err.message); }
  }

  async function addProvider(e) {
    e.preventDefault();
    try {
      await api("/people/providers", { method: "POST", body: { ...pForm, rate: Number(pForm.rate) } });
      setPForm({ name: "", type: "Transporte", rate: "0", unit: "viaje" });
      await load();
    } catch (err) { setError(err.message); }
  }

  async function addCollab(e) {
    e.preventDefault();
    try {
      await api("/people/collaborators", { method: "POST", body: uForm });
      setUForm({ email: "", name: "", role: "vendedor", password: "Zdry123!" });
      await load();
    } catch (err) { setError(err.message); }
  }

  async function viewAs(id) {
    setError("");
    try {
      const u = await impersonate(id);
      nav(homeFor(u));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function resetPassword(e) {
    e.preventDefault();
    if (!resetId) return;
    setError("");
    try {
      await api(`/people/collaborators/${resetId}/password`, { method: "POST", body: { password: resetPw } });
      setResetId(null);
      setResetPw("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Personas</h2>
      <p className="section-sub">Clientes (riesgo A–D), proveedores y colaboradores. Como administrador puedes ver la interfaz de otro usuario y restablecer su clave.</p>
      {error ? <div className="err">{error}</div> : null}
      <div className="subtab-row">
        <button type="button" className={`subtab ${tab === "customers" ? "active" : ""}`} onClick={() => setTab("customers")}>Clientes</button>
        <button type="button" className={`subtab ${tab === "providers" ? "active" : ""}`} onClick={() => setTab("providers")}>Proveedores</button>
        <button type="button" className={`subtab ${tab === "collabs" ? "active" : ""}`} onClick={() => setTab("collabs")}>Colaboradores</button>
      </div>

      {tab === "customers" && (
        <div className="panel">
          <form className="form-grid" onSubmit={addCustomer}>
            <div><label>RUC / DNI</label><input value={cForm.rucDni} onChange={(e) => setCForm({ ...cForm, rucDni: e.target.value })} required /></div>
            <div><label>Empresa</label><input value={cForm.companyName} onChange={(e) => setCForm({ ...cForm, companyName: e.target.value })} required /></div>
            <div><label>Email</label><input type="email" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} /></div>
            <div><label>Teléfono</label><input value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} /></div>
            <div>
              <label>Riesgo</label>
              <select value={cForm.risk} onChange={(e) => setCForm({ ...cForm, risk: e.target.value })}>
                {RISK.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <button className="btn-primary" type="submit">+ Cliente</button>
          </form>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Empresa</th><th>RUC/DNI</th><th>Email</th><th>Riesgo</th></tr></thead>
              <tbody>{customers.map((c) => <tr key={c.id}><td>{c.companyName}{c.demo ? <span className="demo-chip">DEMO</span> : null}</td><td>{c.rucDni}</td><td>{c.email}</td><td>{c.risk}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "providers" && (
        <div className="panel">
          <form className="form-grid" onSubmit={addProvider}>
            <div><label>Nombre</label><input value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} required /></div>
            <div><label>Tipo</label><input value={pForm.type} onChange={(e) => setPForm({ ...pForm, type: e.target.value })} required /></div>
            <div><label>Tarifa</label><input type="number" value={pForm.rate} onChange={(e) => setPForm({ ...pForm, rate: e.target.value })} /></div>
            <div><label>Unidad</label><input value={pForm.unit} onChange={(e) => setPForm({ ...pForm, unit: e.target.value })} /></div>
            <button className="btn-primary" type="submit">+ Proveedor</button>
          </form>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Nombre</th><th>Tipo</th><th>Tarifa</th><th>Unidad</th></tr></thead>
              <tbody>{providers.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.type}</td><td>{Number(p.rate)}</td><td>{p.unit}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "collabs" && (
        <div className="panel">
          <form className="form-grid" onSubmit={addCollab}>
            <div><label>Nombre</label><input value={uForm.name} onChange={(e) => setUForm({ ...uForm, name: e.target.value })} required /></div>
            <div><label>Email</label><input type="email" value={uForm.email} onChange={(e) => setUForm({ ...uForm, email: e.target.value })} required /></div>
            <div>
              <label>Rol</label>
              <select value={uForm.role} onChange={(e) => setUForm({ ...uForm, role: e.target.value })}>
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div><label>Clave inicial</label><input value={uForm.password} onChange={(e) => setUForm({ ...uForm, password: e.target.value })} /></div>
            <button className="btn-primary" type="submit">+ Colaborador</button>
          </form>
          {resetId ? (
            <form className="form-grid" onSubmit={resetPassword} style={{ marginTop: 12 }}>
              <div><label>Nueva clave</label><input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} required minLength={8} /></div>
              <button className="btn-primary" type="submit">Restablecer</button>
              <button className="btn-ghost" type="button" onClick={() => { setResetId(null); setResetPw(""); }}>Cancelar</button>
            </form>
          ) : null}
          <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th><th></th></tr></thead>
            <tbody>
              {collabs.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{u.demo ? <span className="demo-chip">DEMO</span> : null}</td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>{u.active ? "sí" : "no"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {u.id !== user.id && u.active ? (
                      <button type="button" className="btn-ghost" onClick={() => viewAs(u.id)}>Ver como</button>
                    ) : null}
                    <button type="button" className="btn-ghost" onClick={() => { setResetId(u.id); setResetPw(""); }}>Clave</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </>
  );
}
