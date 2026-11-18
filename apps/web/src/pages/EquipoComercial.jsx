import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function EquipoComercial() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ vendorId: "", executiveId: "", enabled: true });
  const [saving, setSaving] = useState(false);

  function load() {
    return api("/commercial/equipo")
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/commercial/equipo", { method: "PUT", body: form });
      setForm({ vendorId: "", executiveId: "", enabled: true });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row) {
    setError("");
    try {
      await api("/commercial/equipo", {
        method: "PUT",
        body: { vendorId: row.vendor.id, executiveId: row.executive.id, enabled: !row.enabled },
      });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Equipo comercial</h1>
          <p className="muted">Los vendedores habilitados reciben los clientes del formulario. Cada uno tiene un ejecutivo de seguimiento.</p>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {data?.canEdit ? (
        <div className="panel">
          <form className="form-grid" onSubmit={save}>
            <div>
              <label>Vendedor</label>
              <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} required>
                <option value="">Elegir</option>
                {(data.vendors || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </div>
            <div>
              <label>Ejecutivo de seguimiento</label>
              <select value={form.executiveId} onChange={(e) => setForm({ ...form, executiveId: e.target.value })} required>
                <option value="">Elegir</option>
                {(data.executives || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </div>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "end", paddingBottom: 8 }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Habilitado para el registro
            </label>
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </form>
        </div>
      ) : null}
      <div className="panel">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>Vendedor</th><th>WhatsApp</th><th>Ejecutivo</th><th>WhatsApp</th><th>Registro</th></tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((row) => (
                <tr key={row.id}>
                  <td>{row.vendor.name}</td>
                  <td>{row.vendor.whatsapp || "—"}</td>
                  <td>{row.executive.name}</td>
                  <td>{row.executive.whatsapp || "—"}</td>
                  <td>
                    {data?.canEdit ? (
                      <button className="btn-ghost" type="button" onClick={() => toggle(row)}>{row.enabled ? "Habilitado" : "Apagado"}</button>
                    ) : (
                      row.enabled ? "Habilitado" : "Apagado"
                    )}
                  </td>
                </tr>
              ))}
              {data && !data.rows?.length ? (
                <tr><td colSpan={5}>Todavía no hay vendedores en el equipo.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
