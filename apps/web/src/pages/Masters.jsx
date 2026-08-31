import { useEffect, useState } from "react";
import { api, ApiError } from "../api.js";

export default function Masters() {
  const [tab, setTab] = useState("depots");
  const [showArchived, setShowArchived] = useState(false);
  const [types, setTypes] = useState([]);
  const [cats, setCats] = useState([]);
  const [depots, setDepots] = useState([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [depotForm, setDepotForm] = useState({ name: "", city: "", address: "", dailyRateTeu: "1.2" });
  const [editingDepot, setEditingDepot] = useState(null);
  const [typeForm, setTypeForm] = useState({ code: "", label: "", dims: "", color: "#1971c2" });
  const [editingType, setEditingType] = useState(null);
  const [catForm, setCatForm] = useState({ code: "", label: "", color: "#1971c2" });
  const [editingCat, setEditingCat] = useState(null);

  const q = showArchived ? "?includeArchived=1" : "";

  async function load() {
    const [t, c, d] = await Promise.all([
      api(`/masters/types${q}`),
      api(`/masters/categories${q}`),
      api(`/masters/depots${q}`),
    ]);
    setTypes(t);
    setCats(c);
    setDepots(d);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [showArchived]);

  function flash(ok) {
    setMsg(ok);
    setError("");
  }

  async function saveDepot(e) {
    e.preventDefault();
    setError("");
    try {
      const body = { ...depotForm, dailyRateTeu: Number(depotForm.dailyRateTeu) };
      if (editingDepot) {
        await api(`/masters/depots/${editingDepot}`, { method: "PUT", body });
        flash("Depósito actualizado.");
      } else {
        await api("/masters/depots", { method: "POST", body });
        flash("Depósito creado.");
      }
      setDepotForm({ name: "", city: "", address: "", dailyRateTeu: "1.2" });
      setEditingDepot(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function saveType(e) {
    e.preventDefault();
    setError("");
    try {
      if (editingType) {
        await api(`/masters/types/${editingType}`, { method: "PUT", body: { label: typeForm.label, dims: typeForm.dims, color: typeForm.color } });
        flash("Tipo actualizado.");
      } else {
        await api("/masters/types", { method: "POST", body: typeForm });
        flash("Tipo creado.");
      }
      setTypeForm({ code: "", label: "", dims: "", color: "#1971c2" });
      setEditingType(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function saveCat(e) {
    e.preventDefault();
    setError("");
    try {
      if (editingCat) {
        await api(`/masters/categories/${editingCat}`, { method: "PUT", body: { label: catForm.label, color: catForm.color } });
        flash("Condición actualizada.");
      } else {
        await api("/masters/categories", { method: "POST", body: catForm });
        flash("Condición creada.");
      }
      setCatForm({ code: "", label: "", color: "#1971c2" });
      setEditingCat(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function archive(path) {
    setError("");
    try {
      await api(path, { method: "DELETE" });
      flash("Archivado. El superusuario puede verlo y restaurarlo.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function restore(path) {
    setError("");
    try {
      await api(path, { method: "POST", body: {} });
      flash("Registro restaurado. Vuelve a verse en catálogo y operaciones.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  function editDepot(d) {
    setEditingDepot(d.id);
    setDepotForm({ name: d.name, city: d.city, address: d.address, dailyRateTeu: String(Number(d.dailyRateTeu)) });
  }

  function editType(t) {
    setEditingType(t.code);
    setTypeForm({ code: t.code, label: t.label, dims: t.dims, color: t.color });
  }

  function editCat(c) {
    setEditingCat(c.code);
    setCatForm({ code: c.code, label: c.label, color: c.color });
  }

  return (
    <>
      <h2 className="section-title">Catálogos maestros</h2>
      <p className="section-sub">
        Edita depósitos, tipos y condiciones. Nada se borra: archivar los oculta del catálogo y de las operaciones.
        El administrador puede ver los archivados y restaurarlos.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <div className="subtab-row">
        <button type="button" className={`subtab ${tab === "depots" ? "active" : ""}`} onClick={() => setTab("depots")}>Depósitos</button>
        <button type="button" className={`subtab ${tab === "types" ? "active" : ""}`} onClick={() => setTab("types")}>Tipos</button>
        <button type="button" className={`subtab ${tab === "cats" ? "active" : ""}`} onClick={() => setTab("cats")}>Condiciones</button>
        <label className="muted" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Ver archivados
        </label>
      </div>

      {tab === "depots" && (
        <div className="panel">
          <form className="form-grid" onSubmit={saveDepot}>
            <div><label>Nombre</label><input value={depotForm.name} onChange={(e) => setDepotForm({ ...depotForm, name: e.target.value })} required /></div>
            <div><label>Ciudad</label><input value={depotForm.city} onChange={(e) => setDepotForm({ ...depotForm, city: e.target.value })} required /></div>
            <div><label>Dirección</label><input value={depotForm.address} onChange={(e) => setDepotForm({ ...depotForm, address: e.target.value })} required /></div>
            <div><label>Tarifa diaria TEU</label><input type="number" step="0.1" value={depotForm.dailyRateTeu} onChange={(e) => setDepotForm({ ...depotForm, dailyRateTeu: e.target.value })} /></div>
            <button className="btn-primary" type="submit">{editingDepot ? "Guardar cambios" : "+ Depósito"}</button>
            {editingDepot ? (
              <button className="btn-ghost" type="button" onClick={() => { setEditingDepot(null); setDepotForm({ name: "", city: "", address: "", dailyRateTeu: "1.2" }); }}>Cancelar</button>
            ) : null}
          </form>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Nombre</th><th>Ciudad</th><th>Dirección</th><th>USD/TEU/día</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {depots.map((d) => (
                  <tr key={d.id} style={d.archivedAt ? { opacity: 0.55 } : undefined}>
                    <td>{d.name}</td><td>{d.city}</td><td>{d.address}</td><td>{Number(d.dailyRateTeu)}</td>
                    <td>{d.archivedAt ? "archivado" : (d.protected ? "activo · seed" : "activo")}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn-ghost" onClick={() => editDepot(d)}>Editar</button>
                      {d.archivedAt
                        ? <button type="button" className="btn-ghost" onClick={() => restore(`/masters/depots/${d.id}/restore`)}>Restaurar</button>
                        : <button type="button" className="btn-ghost" onClick={() => archive(`/masters/depots/${d.id}`)}>Archivar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "types" && (
        <div className="panel">
          <form className="form-grid" onSubmit={saveType}>
            <div><label>Código</label><input value={typeForm.code} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })} required disabled={!!editingType} /></div>
            <div><label>Etiqueta</label><input value={typeForm.label} onChange={(e) => setTypeForm({ ...typeForm, label: e.target.value })} required /></div>
            <div><label>Medidas</label><input value={typeForm.dims} onChange={(e) => setTypeForm({ ...typeForm, dims: e.target.value })} /></div>
            <div><label>Color</label><input value={typeForm.color} onChange={(e) => setTypeForm({ ...typeForm, color: e.target.value })} /></div>
            <button className="btn-primary" type="submit">{editingType ? "Guardar cambios" : "+ Tipo"}</button>
            {editingType ? (
              <button className="btn-ghost" type="button" onClick={() => { setEditingType(null); setTypeForm({ code: "", label: "", dims: "", color: "#1971c2" }); }}>Cancelar</button>
            ) : null}
          </form>
          <table className="data">
            <thead><tr><th>Código</th><th>Etiqueta</th><th>Medidas</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.code} style={t.archivedAt ? { opacity: 0.55 } : undefined}>
                  <td>{t.code}</td><td>{t.label}</td><td>{t.dims}</td>
                  <td>{t.archivedAt ? "archivado" : (t.protected ? "activo · seed" : "activo")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn-ghost" onClick={() => editType(t)}>Editar</button>
                    {t.archivedAt
                      ? <button type="button" className="btn-ghost" onClick={() => restore(`/masters/types/${t.code}/restore`)}>Restaurar</button>
                      : <button type="button" className="btn-ghost" onClick={() => archive(`/masters/types/${t.code}`)}>Archivar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "cats" && (
        <div className="panel">
          <form className="form-grid" onSubmit={saveCat}>
            <div><label>Código</label><input value={catForm.code} onChange={(e) => setCatForm({ ...catForm, code: e.target.value })} required disabled={!!editingCat} /></div>
            <div><label>Etiqueta</label><input value={catForm.label} onChange={(e) => setCatForm({ ...catForm, label: e.target.value })} required /></div>
            <div><label>Color</label><input value={catForm.color} onChange={(e) => setCatForm({ ...catForm, color: e.target.value })} /></div>
            <button className="btn-primary" type="submit">{editingCat ? "Guardar cambios" : "+ Condición"}</button>
            {editingCat ? (
              <button className="btn-ghost" type="button" onClick={() => { setEditingCat(null); setCatForm({ code: "", label: "", color: "#1971c2" }); }}>Cancelar</button>
            ) : null}
          </form>
          <table className="data">
            <thead><tr><th>Código</th><th>Etiqueta</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.code} style={c.archivedAt ? { opacity: 0.55 } : undefined}>
                  <td>{c.code}</td><td style={{ color: c.color }}>{c.label}</td>
                  <td>{c.archivedAt ? "archivado" : (c.protected ? "activo · seed" : "activo")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn-ghost" onClick={() => editCat(c)}>Editar</button>
                    {c.archivedAt
                      ? <button type="button" className="btn-ghost" onClick={() => restore(`/masters/categories/${c.code}/restore`)}>Restaurar</button>
                      : <button type="button" className="btn-ghost" onClick={() => archive(`/masters/categories/${c.code}`)}>Archivar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
