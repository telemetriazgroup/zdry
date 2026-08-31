import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Masters() {
  const [tab, setTab] = useState("depots");
  const [types, setTypes] = useState([]);
  const [cats, setCats] = useState([]);
  const [depots, setDepots] = useState([]);
  const [error, setError] = useState("");
  const [depotForm, setDepotForm] = useState({ name: "", city: "", address: "", dailyRateTeu: "1.2" });

  async function load() {
    const [t, c, d] = await Promise.all([api("/masters/types"), api("/masters/categories"), api("/masters/depots")]);
    setTypes(t); setCats(c); setDepots(d);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function addDepot(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/masters/depots", { method: "POST", body: { ...depotForm, dailyRateTeu: Number(depotForm.dailyRateTeu) } });
      setDepotForm({ name: "", city: "", address: "", dailyRateTeu: "1.2" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeDepot(id) {
    setError("");
    try {
      await api(`/masters/depots/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Catálogos maestros</h2>
      <p className="section-sub">Tipos, condiciones y depósitos. Los registros protegidos del seed no se pueden borrar (regla 17).</p>
      {error ? <div className="err">{error}</div> : null}
      <div className="subtab-row">
        <button type="button" className={`subtab ${tab === "depots" ? "active" : ""}`} onClick={() => setTab("depots")}>Depósitos</button>
        <button type="button" className={`subtab ${tab === "types" ? "active" : ""}`} onClick={() => setTab("types")}>Tipos</button>
        <button type="button" className={`subtab ${tab === "cats" ? "active" : ""}`} onClick={() => setTab("cats")}>Condiciones</button>
      </div>

      {tab === "depots" && (
        <div className="panel">
          <form className="form-grid" onSubmit={addDepot}>
            <div><label>Nombre</label><input value={depotForm.name} onChange={(e) => setDepotForm({ ...depotForm, name: e.target.value })} required /></div>
            <div><label>Ciudad</label><input value={depotForm.city} onChange={(e) => setDepotForm({ ...depotForm, city: e.target.value })} required /></div>
            <div><label>Dirección</label><input value={depotForm.address} onChange={(e) => setDepotForm({ ...depotForm, address: e.target.value })} required /></div>
            <div><label>Tarifa diaria TEU</label><input type="number" step="0.1" value={depotForm.dailyRateTeu} onChange={(e) => setDepotForm({ ...depotForm, dailyRateTeu: e.target.value })} /></div>
            <button className="btn-primary" type="submit">+ Depósito</button>
          </form>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Nombre</th><th>Ciudad</th><th>Dirección</th><th>USD/TEU/día</th><th></th></tr></thead>
              <tbody>
                {depots.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td><td>{d.city}</td><td>{d.address}</td><td>{Number(d.dailyRateTeu)}</td>
                    <td>{d.protected ? "protegido" : <button type="button" className="btn-ghost" onClick={() => removeDepot(d.id)}>Eliminar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "types" && (
        <div className="panel">
          <table className="data">
            <thead><tr><th>Código</th><th>Etiqueta</th><th>Medidas</th></tr></thead>
            <tbody>{types.map((t) => <tr key={t.code}><td>{t.code}</td><td>{t.label}</td><td>{t.dims}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {tab === "cats" && (
        <div className="panel">
          <table className="data">
            <thead><tr><th>Código</th><th>Etiqueta</th></tr></thead>
            <tbody>{cats.map((c) => <tr key={c.code}><td>{c.code}</td><td style={{ color: c.color }}>{c.label}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
