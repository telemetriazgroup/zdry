import { useEffect, useState } from "react";
import { api, apiUrl } from "../api.js";

function SyncIcon({ status, compact }) {
  const s = status || "live";
  const title = s === "deferred" ? "Diferido: guardado en ZDRY, Odoo pendiente" : s === "error" ? "Error al escribir en Odoo" : "En vivo con Odoo";
  return (
    <span className={`odoo-sync ${s}`} title={title} aria-label={title}>
      <i />
      {compact ? null : <span>{s === "deferred" ? "Diferido" : s === "error" ? "Error Odoo" : "En vivo"}</span>}
    </span>
  );
}

export default function OdooLotFicha({ id, busy, onClose, onAssimilated, onSaved }) {
  const [row, setRow] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const d = await api(`/odoo-import/candidates/${id}`);
    setRow(d);
    setForm({
      color: d.color || "",
      tareKg: d.tareKg ?? "",
      mgwKg: d.mgwKg ?? "",
      year: d.year ?? "",
      manufacturer: d.manufacturer || "",
      dua: d.dua || "",
      originCountry: d.originCountry || "",
      material: d.material || "",
      zdryType: d.zdryType || "",
      zdryCat: d.zdryCat || "",
      zdryNotes: d.zdryNotes || "",
    });
    api(`/odoo-import/candidates/${id}/photos`).then(setPhotos).catch(() => setPhotos([]));
  }

  useEffect(() => {
    setError("");
    setMsg("");
    load().catch((e) => setError(e.message));
  }, [id]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const body = {
        ...form,
        tareKg: form.tareKg === "" ? null : Number(form.tareKg),
        mgwKg: form.mgwKg === "" ? null : Number(form.mgwKg),
        year: form.year === "" ? null : Number(form.year),
      };
      const d = await api(`/odoo-import/candidates/${id}`, { method: "PATCH", body });
      setRow(d);
      setForm({
        color: d.color || "",
        tareKg: d.tareKg ?? "",
        mgwKg: d.mgwKg ?? "",
        year: d.year ?? "",
        manufacturer: d.manufacturer || "",
        dua: d.dua || "",
        originCountry: d.originCountry || "",
        material: d.material || "",
        zdryType: d.zdryType || "",
        zdryCat: d.zdryCat || "",
        zdryNotes: d.zdryNotes || "",
      });
      setMsg(d.saveMessage || "Guardado.");
      if (d.odooSyncStatus === "error" && d.odooSyncError) setError(d.odooSyncError);
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!row) {
    return (
      <div className="odoo-ficha">
        <button className="btn-ghost" type="button" onClick={onClose}>← Lista</button>
        {error ? <div className="err">{error}</div> : <p className="section-sub">Cargando ficha…</p>}
      </div>
    );
  }

  const status = row.status === "pending" || row.status === "qty_anomaly";

  return (
    <div className="odoo-ficha">
      <div className="odoo-ficha-bar">
        <button className="btn-ghost" type="button" onClick={onClose}>← Lista</button>
        <SyncIcon status={row.odooSyncStatus} />
        {row.odooSyncError ? <span className="err" style={{ margin: 0 }}>{row.odooSyncError}</span> : null}
        <button
          className="btn-ghost"
          type="button"
          disabled={saving || !!busy}
          onClick={() => {
            setSaving(true);
            api(`/odoo-import/candidates/${id}?refresh=1`)
              .then((d) => {
                setRow(d);
                setForm({
                  color: d.color || "",
                  tareKg: d.tareKg ?? "",
                  mgwKg: d.mgwKg ?? "",
                  year: d.year ?? "",
                  manufacturer: d.manufacturer || "",
                  dua: d.dua || "",
                  originCountry: d.originCountry || "",
                  material: d.material || "",
                  zdryType: d.zdryType || "",
                  zdryCat: d.zdryCat || "",
                  zdryNotes: d.zdryNotes || "",
                });
                setMsg("Ficha actualizada desde Odoo.");
              })
              .catch((e) => setError(e.message))
              .finally(() => setSaving(false));
          }}
        >
          Traer de Odoo
        </button>
        <button className="btn-ghost" type="button" disabled={saving || !!busy} onClick={() => api(`/odoo-import/candidates/${id}/flush`, { method: "POST" }).then(() => load()).catch((e) => setError(e.message))}>
          Reintentar Odoo
        </button>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="odoo-ficha-grid">
        <div className="odoo-sheet">
          <div className="odoo-sheet-head">
            <div>
              <div className="odoo-kicker">Número de serie / lote</div>
              <h3 className="odoo-serial">{row.serialRaw || row.isoNormalized}</h3>
              <p className="section-sub">
                {row.productCode ? `[${row.productCode}] ` : ""}{row.productName}
                {row.zgroupCode ? ` · Código ZGroup ${row.zgroupCode}` : ""}
              </p>
            </div>
            <div className="odoo-sheet-meta">
              {row.iso6346Ok ? <span className="badge-scope" style={{ background: "#2f9e44" }}>ISO OK</span> : <span className="badge-scope" style={{ background: "#c92a2a" }}>Por revisar</span>}
              <div>Cantidad a la mano: <b>{row.qtyOnHand || 0}</b></div>
              <div>Ubicación: <b>{row.locationName || "—"}</b></div>
              <div>Estado: <b>{row.status === "assimilated" ? `En ZDRY · ${row.containerIso}` : row.status}</b></div>
            </div>
          </div>

          <h4>Datos Odoo <small>si los cambias aquí se guardan en ZDRY y luego se escriben en Odoo (no bloquea)</small></h4>
          <div className="odoo-form">
            {(row.odooFields || []).map((f) => (
              <label key={f.key}>
                <span>{f.label} <SyncIcon status={f.sync} compact /></span>
                <input
                  type={f.key === "tareKg" || f.key === "mgwKg" || f.key === "year" ? "number" : "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </label>
            ))}
          </div>

          <h4>Compras Odoo <small>referencia de OC / factura; Compras enlaza la deuda. No se inventa factura al asimilar.</small></h4>
          <div className="odoo-form">
            <label>
              <span>Orden de compra</span>
              <input readOnly value={row.odooPoName || "—"} />
            </label>
            <label>
              <span>Proveedor</span>
              <input readOnly value={row.odooVendorName || "—"} />
            </label>
            <label>
              <span>Factura Odoo</span>
              <input readOnly value={row.odooBillName || "—"} />
            </label>
            <label>
              <span>Precio unitario</span>
              <input readOnly value={row.odooUnitPrice != null && row.odooUnitPrice !== "" ? `USD ${Number(row.odooUnitPrice).toLocaleString("en-US")}` : "—"} />
            </label>
          </div>

          <h4>Complemento ZDRY <small>no viaja a Odoo — tipo, condición y notas de regularización</small></h4>
          <div className="odoo-form">
            <label>
              <span>Tipo ZDRY</span>
              <select value={form.zdryType || ""} onChange={(e) => set("zdryType", e.target.value)}>
                <option value="">—</option>
                {(row.types || []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </label>
            <label>
              <span>Condición comercial</span>
              <select value={form.zdryCat || ""} onChange={(e) => set("zdryCat", e.target.value)}>
                <option value="">—</option>
                {(row.categories || []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            <label className="odoo-span2">
              <span>Notas ZDRY</span>
              <textarea rows={3} value={form.zdryNotes || ""} onChange={(e) => set("zdryNotes", e.target.value)} />
            </label>
          </div>

          <div className="action-row" style={{ marginTop: 14 }}>
            <button className="btn-primary" type="button" disabled={saving || !!busy} onClick={save}>Guardar</button>
            {status ? (
              <button
                className="btn-ghost"
                type="button"
                disabled={saving || !!busy}
                onClick={() => onAssimilated(row.id)}
              >
                Asimilar a Recepción
              </button>
            ) : (
              <span className="section-sub">Ya asimilado. Los cambios de Odoo se reenvían en segundo plano.</span>
            )}
          </div>
        </div>

        <aside className="odoo-chatter">
          <h4>Chatter / fotos Odoo</h4>
          <p className="section-sub">Adjuntos del lote. No sustituyen las 9 casillas de inspección.</p>
          {!photos.length ? <p className="section-sub">Sin fotos en este lote, o Odoo no las devolvió.</p> : null}
          <div className="odoo-thumbs">
            {photos.map((p) => (
              <a key={p.id} href={apiUrl(`/odoo-import/candidates/${id}/photos/${p.id}`)} target="_blank" rel="noreferrer">
                <img src={apiUrl(`/odoo-import/candidates/${id}/photos/${p.id}`)} alt={p.name} />
                <span>{p.name}</span>
              </a>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export { SyncIcon };
