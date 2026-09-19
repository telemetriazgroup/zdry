import { useEffect, useState } from "react";
import { api, apiUrl } from "../api.js";
import { costLabel, originBadge } from "../odoo-origin.js";

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

function foldKey(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function matchSelectValue(raw, options) {
  const t = String(raw ?? "").trim();
  if (!t || !options?.length) return t;
  const hit = options.find(([k, lab]) => k === t || lab === t || foldKey(k) === foldKey(t) || foldKey(lab) === foldKey(t));
  return hit ? hit[0] : t;
}

function OdooOwnedInput({ field, value, onChange }) {
  const options = field.options || [];
  if (options.length) {
    const current = matchSelectValue(value, options);
    const known = options.some(([k]) => k === current);
    return (
      <select value={known ? current : current || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {!known && current ? <option value={current}>{current}</option> : null}
        {options.map(([k, lab]) => (
          <option key={k} value={k}>{lab}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={field.key === "tareKg" || field.key === "mgwKg" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const DOC_KIND = {
  purchase: "Orden de compra",
  bill: "Factura proveedor",
  picking_in: "Entrada (IN)",
  picking_out: "Salida (OUT)",
  mo: "Fabricación (MO)",
  sale: "Pedido de venta",
};

function ExpedientePanel({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api(`/odoo-import/candidates/${id}/expediente`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    setError("");
    load();
  }, [id]);

  async function saveNote() {
    setBusy(true);
    setError("");
    try {
      const out = await api(`/odoo-import/candidates/${id}/notes`, { method: "POST", body: { body: note } });
      setData(out);
      setNote("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="section-sub">{error || "Cargando expediente…"}</p>;

  const evo = data.evolution || [];

  return (
    <div>
      {error ? <div className="err">{error}</div> : null}
      <h4>Evolución de la ficha <small>Odoo es la fuente principal: si cambia allá, pisa ZDRY y queda el rastro. Puedes volver a editar en Ficha.</small></h4>
      {!evo.length ? <p className="section-sub">Aún no hay historial. Se arma al guardar aquí o al llegar un cambio de Odoo.</p> : null}
      {evo.map((row) => (
        <div key={row.field} className="evo-field">
          <div className="evo-head">
            <b>{row.label}</b>
            <span className="section-sub">ahora: {row.current || "—"}</span>
          </div>
          <div className="evo-track">
            {row.steps.map((s, i) => (
              <span key={`${row.field}-${i}`} className="evo-step-wrap">
                {i ? <span className="evo-arrow" aria-hidden>→</span> : null}
                <span className={`evo-chip src-${s.source === "odoo" ? "odoo" : s.source === "zdry" ? "zdry" : "prev"}${s.applied === false ? " not-applied" : ""}`}>
                  <em>{s.value || "—"}</em>
                  <small>{s.source === "odoo" ? "Odoo" : s.source === "zdry" ? "ZDRY" : "antes"}{s.applied === false ? " · no aplicado" : ""} · {new Date(s.at).toLocaleString("es-PE")}</small>
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}

      <h4>Detalle cronológico</h4>
      {!data.timeline?.length ? null : (
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr><th>Cuándo</th><th>Campo</th><th>Antes</th><th>Después</th><th>Origen</th></tr>
          </thead>
          <tbody>
            {(data.timeline || []).map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.createdAt).toLocaleString("es-PE")}</td>
                <td>{t.field}</td>
                <td>{t.before || "—"}</td>
                <td>{t.after || "—"}</td>
                <td>{t.source}{t.event ? ` · ${t.event}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <h4>Documentos Odoo <small>copia informativa versionada. No hay que abrir Odoo para ver OC / IN / factura / MO.</small></h4>
      {!data.documents?.length ? <p className="section-sub">Sin documentos aún. «Buscar en Odoo» rellena OC/MO ya clasificados.</p> : null}
      {(data.documents || []).map((g) => (
        <div key={g.current.id} className="odoo-sheet" style={{ marginBottom: 10, padding: 10 }}>
          <b>{DOC_KIND[g.current.kind] || g.current.kind}</b> · {g.current.name}
          <div className="section-sub">{g.current.summary || "—"} · v{g.current.version}</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "8px 0 0" }}>{JSON.stringify(g.current.data, null, 2)}</pre>
          {g.versions.length > 1 ? (
            <p className="section-sub">{g.versions.length} versiones. La de arriba es la última.</p>
          ) : null}
        </div>
      ))}

      <h4>Notas de la serie</h4>
      <p className="section-sub">Las de Odoo son informativas. Aquí solo se agregan notas ZDRY.</p>
      <div className="odoo-form">
        <label className="odoo-span2">
          <span>Nueva nota ZDRY</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button className="btn-ghost" type="button" disabled={busy || !note.trim()} onClick={saveNote}>Agregar nota</button>
      <ul>
        {(data.notes || []).map((n) => (
          <li key={n.id}>
            <b>{n.source === "odoo" ? "Odoo" : "ZDRY"}</b>
            {n.author ? ` · ${n.author}` : ""}
            {n.occurredAt || n.createdAt ? ` · ${new Date(n.occurredAt || n.createdAt).toLocaleString("es-PE")}` : ""}
            <div>{n.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OdooLotFicha({ id, busy, onClose, onAssimilated, onSaved }) {
  const [row, setRow] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("ficha");

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
        year: form.year === "" || form.year === "NO DEFINE" ? null : Number(form.year),
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
              <span className="badge-scope" style={{ background: originBadge(row).color }}>{originBadge(row).label}</span>
              <div>Cantidad a la mano: <b>{row.qtyOnHand || 0}</b></div>
              <div>Ubicación: <b>{row.locationName || "—"}</b></div>
              <div>Estado: <b>{row.status === "assimilated" ? `En ZDRY · ${row.containerIso}` : row.status}</b></div>
            </div>
          </div>

          <div className="action-row" style={{ margin: "10px 0 14px" }}>
            <button className={tab === "ficha" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setTab("ficha")}>Ficha</button>
            <button className={tab === "expediente" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => setTab("expediente")}>Expediente</button>
          </div>

          {tab === "expediente" ? <ExpedientePanel id={id} /> : null}

          {tab === "ficha" ? (
            <p className="section-sub" style={{ marginBottom: 12 }}>
              Odoo es la fuente principal. Si Odoo cambia un campo, pisa el valor de ZDRY (el historial queda en Expediente). Aquí puedes volver a editar y se escribe en Odoo.
            </p>
          ) : null}

          {tab === "ficha" ? (
          <>
          <h4>Datos Odoo <small>guardar escribe en Odoo (zdry_sync, sin eco). Un cambio posterior en Odoo vuelve a prevalecer.</small></h4>
          <div className="odoo-form">
            {(row.odooFields || []).map((f) => (
              <label key={f.key}>
                <span>{f.label} <SyncIcon status={f.sync} compact /></span>
                <OdooOwnedInput field={f} value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
              </label>
            ))}
          </div>

          <h4>Origen y costo <small>trazabilidad Odoo: ajuste, OC o fabricación. Un ajuste o una MO no inventa factura ZDRY.</small></h4>
          <div className="odoo-form">
            <label>
              <span>Origen</span>
              <input readOnly value={originBadge(row).label} />
            </label>
            <label>
              <span>Albarán / movimiento</span>
              <input readOnly value={row.odooPickingName || "—"} />
            </label>
            <label>
              <span>Fuente de costo</span>
              <input
                readOnly
                value={
                  row.costSource === "oc"
                    ? "OC / factura"
                    : row.costSource === "referential"
                      ? "Referencial DRY"
                      : row.costSource === "mo"
                        ? "MO / referencial DRY"
                        : "Sin costo"
                }
              />
            </label>
            <label>
              <span>Costo a usar</span>
              <input readOnly value={costLabel(row, row.dryReferential)} />
            </label>
          </div>

          {row.odooIntakeKind === "fabrication" ? (
            <>
              <h4>Precursor <small>mismo serial, otro producto. No se crea una segunda unidad vendible.</small></h4>
              <div className="odoo-form">
                <label>
                  <span>Orden de fabricación</span>
                  <input readOnly value={row.odooMoName || row.odooPickingName || "—"} />
                </label>
                <label>
                  <span>Era</span>
                  <input
                    readOnly
                    value={
                      row.odooSourceProductCode
                        ? `[${row.odooSourceProductCode}] ${row.odooSourceProductName || ""}`.trim()
                        : "—"
                    }
                  />
                </label>
                <label>
                  <span>Origen del precursor</span>
                  <input
                    readOnly
                    value={
                      row.odooSourceIntakeKind === "purchase"
                        ? row.odooSourcePoName || "OC"
                        : row.odooSourceIntakeKind === "adjustment"
                          ? "Ajuste"
                          : row.odooSourceIntakeKind || "—"
                    }
                  />
                </label>
                <label>
                  <span>Lote precursor Odoo</span>
                  <input readOnly value={row.odooSourceLotId != null ? String(row.odooSourceLotId) : "—"} />
                </label>
              </div>
            </>
          ) : null}

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
          </>
          ) : null}
        </div>

        <aside className="odoo-chatter">
          <h4>Notas Odoo</h4>
          <p className="section-sub">Mensajes y notas del chatter. Solo lectura; no se editan en ZDRY.</p>
          {!(row.odooNotes || []).length ? <p className="section-sub">Este lote no tiene notas en Odoo, o aún no se pudieron traer.</p> : null}
          <ul className="odoo-note-list">
            {(row.odooNotes || []).map((n) => (
              <li key={n.id} className="odoo-note">
                <div className="odoo-note-meta">
                  {n.author || "Odoo"}
                  {n.date ? ` · ${new Date(n.date.includes("T") ? n.date : `${n.date.replace(" ", "T")}Z`).toLocaleString("es-PE")}` : ""}
                </div>
                <div className="odoo-note-body">{n.body}</div>
              </li>
            ))}
          </ul>
          <h4>Fotos Odoo</h4>
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
