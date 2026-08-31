import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api, apiBlob, apiUpload, ApiError } from "../api.js";
import { damFormatOk, parseIso6346 } from "../iso6346.js";
import {
  PURCHASE_EXTRA_SERVICES,
  defaultPurchaseExtras,
  extraStatusLabel,
  purchaseExtraLocked,
} from "../purchase-extras.js";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const DOC_KINDS = [
  { key: "factura", label: "Factura" },
  { key: "bl", label: "BL / Conocimiento de embarque" },
  { key: "manifiesto", label: "Manifiesto" },
  { key: "packing_list", label: "Packing list" },
  { key: "dam", label: "DAM" },
  { key: "otro", label: "Otro" },
];
const ACCEPT_DOCS = "application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif";

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  return `${(x / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadInvoiceDocs(invoiceId, items) {
  if (!items.length) return [];
  const fd = new FormData();
  for (const item of items) {
    fd.append("files", item.file);
    fd.append("kinds", item.kind || "factura");
  }
  return apiUpload(`/purchases/invoices/${invoiceId}/documents`, fd);
}

function AmberBadge({ n }) {
  if (!n) return null;
  return <span className="count-badge">{n}</span>;
}

function yearOptions() {
  const maxY = new Date().getFullYear();
  const years = [];
  for (let y = maxY; y >= 1975; y--) years.push(y);
  return years;
}

export default function Compras() {
  const loc = useLocation();
  const tab = loc.pathname.includes("/extras") ? "extras" : loc.pathname.includes("/dam") ? "dam" : "facturas";
  const [badges, setBadges] = useState({ extras: 0, dam: 0 });

  const refreshBadges = useCallback(() => {
    api("/purchases/badges").then(setBadges).catch(() => {});
  }, []);

  useEffect(() => { refreshBadges(); }, [refreshBadges, tab]);

  return (
    <>
      <h2 className="section-title">Compras</h2>
      <p className="section-sub">Facturas de importación, cola de extras reglada por la logística y DAM antes de despachar.</p>
      <div className="subtab-row">
        <NavLink to="/app/compras/facturas" className={`subtab ${tab === "facturas" ? "active" : ""}`}>Facturas de compra</NavLink>
        <NavLink to="/app/compras/extras" className={`subtab ${tab === "extras" ? "active" : ""}`}>
          Costos adicionales <AmberBadge n={badges.extras} />
        </NavLink>
        <NavLink to="/app/compras/dam" className={`subtab ${tab === "dam" ? "active" : ""}`}>
          Nacionalización (DAM) <AmberBadge n={badges.dam} />
        </NavLink>
      </div>
      {tab === "facturas" ? <PurchaseTab onChanged={refreshBadges} /> : null}
      {tab === "extras" ? <ExtrasTab /> : null}
      {tab === "dam" ? <DamTab onChanged={refreshBadges} /> : null}
    </>
  );
}

function PurchaseTab({ onChanged }) {
  const [meta, setMeta] = useState({ incoterms: [], logistics: [], extraServices: PURCHASE_EXTRA_SERVICES, manufacturers: [], providers: [] });
  const [types, setTypes] = useState([]);
  const [cats, setCats] = useState([]);
  const [depots, setDepots] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [mode, setMode] = useState("new");
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState({
    number: "",
    providerName: "",
    incoterm: "FOB",
    logistics: "reentrega",
    depotId: "",
    extras: defaultPurchaseExtras("reentrega"),
    isos: "",
  });
  const [rows, setRows] = useState([]);
  const [docs, setDocs] = useState([]);
  const [viewer, setViewer] = useState(null);

  async function load() {
    const [m, t, c, d, inv] = await Promise.all([
      api("/purchases/meta"),
      api("/masters/types"),
      api("/masters/categories"),
      api("/masters/depots"),
      api("/purchases/invoices"),
    ]);
    setMeta(m);
    setTypes(t);
    setCats(c);
    setDepots(d);
    setInvoices(inv);
    setForm((f) => ({
      ...f,
      providerName: f.providerName || m.providers?.[0]?.name || "",
      depotId: f.depotId || d[0]?.id || "",
    }));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  function onLogistics(val) {
    setForm((f) => ({ ...f, logistics: val, extras: defaultPurchaseExtras(val) }));
  }

  function toggleExtra(key, checked) {
    const svc = PURCHASE_EXTRA_SERVICES.find((s) => s.key === key);
    if (purchaseExtraLocked(svc || {}, form.logistics)) return;
    setForm((f) => ({ ...f, extras: { ...f.extras, [key]: { enabled: checked } } }));
  }

  function generateRows() {
    const isos = form.isos.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!isos.length) {
      setError("Ingresa al menos un código ISO.");
      setOk("");
      return;
    }
    const defaultType = types.find((t) => t.code === "20GP")?.code || types[0]?.code || "20GP";
    const defaultCat = cats.find((c) => c.code === "CW")?.code || cats[0]?.code || "CW";
    setRows(isos.map((iso) => ({
      iso, type: defaultType, cat: defaultCat, year: "", manufacturer: "", price: "",
      bl: "", manifest: "", isoOverride: false, isoExceptionReason: "",
    })));
    setError("");
    setOk("");
  }

  function updateRow(idx, field, val) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }

  function applyIsoFix(idx) {
    setRows((prev) => prev.map((row, i) => {
      if (i !== idx) return row;
      const check = parseIso6346(row.iso);
      if (!check.valid) return row;
      return { ...row, iso: check.suggested, isoOverride: false, isoExceptionReason: "" };
    }));
  }

  function keepIsoAsIs(idx) {
    updateRow(idx, "isoOverride", true);
  }

  function copyRowToAll(includePrice) {
    if (!rows.length) return;
    const first = rows[0];
    setRows((prev) => prev.map((r, i) => (i === 0 ? r : {
      ...r,
      type: first.type,
      cat: first.cat,
      year: first.year,
      manufacturer: first.manufacturer,
      ...(includePrice ? { price: first.price } : {}),
    })));
  }

  const total = rows.reduce((s, r) => s + (parseFloat(r.price) || 0), 0);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setOk("");
    if (mode === "pending") {
      setError("No hay unidades pendientes de factura. Esa consolidación entra cuando Almacén registra un ingreso sin factura (Sprint 3).");
      return;
    }
    if (!form.providerName) {
      setError("Selecciona el proveedor.");
      return;
    }
    if (!rows.length) {
      setError("Ingresa los códigos ISO y genera las filas de detalle antes de registrar.");
      return;
    }
    try {
      const created = await api("/purchases/invoices", {
        method: "POST",
        body: {
          number: form.number,
          providerName: form.providerName,
          incoterm: form.incoterm,
          logistics: form.logistics,
          depotId: form.depotId,
          extras: form.extras,
          lines: rows.map((r) => ({
            iso: r.iso,
            type: r.type,
            cat: r.cat,
            year: r.year ? Number(r.year) : null,
            manufacturer: r.manufacturer || "—",
            price: Number(r.price),
            bl: r.bl,
            manifest: r.manifest,
            isoOverride: !!r.isoOverride,
            isoExceptionReason: r.isoExceptionReason,
          })),
        },
      });
      let docNote = "";
      if (docs.length) {
        try {
          const uploaded = await uploadInvoiceDocs(created.id, docs);
          docNote = ` ${uploaded.length} documento(s) adjunto(s).`;
        } catch (uploadErr) {
          docNote = ` La factura se registró, pero falló la carga de archivos: ${uploadErr.message}. Puedes adjuntarlos abriendo la factura.`;
        }
      }
      const extrasQueued = PURCHASE_EXTRA_SERVICES.filter((s) => form.extras[s.key]?.enabled).map((s) => s.label);
      setOk(`✓ Factura ${created.number} registrada (${created.lines.length} unidad(es)): ${created.lines.map((l) => l.iso).join(", ")}.${extrasQueued.length ? " Quedaron pendientes de monto en Costos adicionales: " + extrasQueued.join(", ") + "." : ""}${docNote}`);
      setRows([]);
      setDocs([]);
      setForm((f) => ({
        ...f,
        number: "",
        isos: "",
        extras: defaultPurchaseExtras(f.logistics),
      }));
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  const extraServices = meta.extraServices?.length ? meta.extraServices : PURCHASE_EXTRA_SERVICES;
  const logisticsLabel = (key) => (meta.logistics || []).find((o) => o.key === key)?.label || key;

  return (
    <div className="dash-grid">
      <div className="panel">
        <h3>Registrar factura de compra de contenedores</h3>
        <p className="section-sub">Toda unidad para reventa nace aquí: de una unidad puntual o de un lote completo. Cada código ISO sigue la regla ISO 6346 (3 letras + U, 6 dígitos y dígito de control).</p>
        {error ? <div className="err">{error}</div> : null}
        {ok ? <div className="ok-msg">{ok}</div> : null}
        <form onSubmit={submit}>
          <div className="form-grid">
            <div><label>N° de factura</label><input value={form.number} placeholder="Ej. F001-4821" onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
            <div>
              <label>Proveedor</label>
              <select value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })}>
                {meta.providers?.length
                  ? meta.providers.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)
                  : <option value="">No hay proveedores registrados — agrégalos en Personas</option>}
              </select>
            </div>
            <div>
              <label>Modo</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="new">Crear unidades nuevas</option>
                <option value="pending">Consolidar unidades con factura pendiente</option>
              </select>
            </div>
          </div>

          <div className="import-box">
            <div className="box-kicker">Términos de importación</div>
            <div className="form-grid">
              <div>
                <label>Incoterm</label>
                <select value={form.incoterm} onChange={(e) => setForm({ ...form, incoterm: e.target.value })}>
                  {(meta.incoterms || []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label>Logística de entrega</label>
                <select value={form.logistics} onChange={(e) => onLogistics(e.target.value)}>
                  {(meta.logistics || []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="hint-inline">BL y Manifiesto (el número, no el gasto) se registran por unidad más abajo, o después en Nacionalización.</div>
          </div>

          <div className="import-box">
            <div className="box-kicker">Condiciones de pago adicionales</div>
            <p className="section-sub" style={{ marginTop: 0 }}>
              {form.logistics === "reentrega"
                ? "Con Reentrega el proveedor entrega en el depósito de ZDRY — ninguno de estos servicios aplica. Solo se paga el Agente de Aduana, siempre obligatorio para nacionalizar."
                : "Con Recojo, ZDRY podría necesitar todos o algunos de estos servicios para trasladar la unidad — marca solo los que apliquen a esta compra."}
              {" "}Esto solo fija la <b>regla</b> de esta compra — el monto real se registra después, en Compras → Costos adicionales, cuando llegue la factura de cada proveedor (puede ser semanas o meses más tarde).
            </p>
            <div className="tablewrap">
              <table className="data">
                <thead><tr><th></th><th>Servicio</th><th>¿Lo paga ZDRY aparte?</th></tr></thead>
                <tbody>
                  {extraServices.map((s) => {
                    const st = form.extras[s.key] || { enabled: false };
                    const locked = purchaseExtraLocked(s, form.logistics);
                    return (
                      <tr key={s.key}>
                        <td><input type="checkbox" checked={!!st.enabled} disabled={locked} onChange={(e) => toggleExtra(s.key, e.target.checked)} /></td>
                        <td>{s.label}{s.mandatory ? <i className="muted"> (obligatorio)</i> : null}</td>
                        <td>{st.enabled
                          ? <span style={{ color: "#c9720b", fontWeight: 600 }}>Sí — quedará pendiente en Costos adicionales</span>
                          : <span style={{ color: "#2f9e44" }}>No / no aplica</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hint-inline">Cada servicio habilitado queda en cola en Compras → Costos adicionales con el proveedor ya sugerido por defecto — cuando llegue la factura real, solo hay que confirmar el proveedor y escribir el monto que está cobrando.</div>
          </div>

          {mode === "new" ? (
            <div style={{ marginTop: 10 }}>
              <p className="hint-inline" style={{ marginTop: 0 }}>Una misma factura puede traer tamaños distintos (20'/40'/45') — cada contenedor tiene su propio precio, no se prorratea un monto único.</p>
              <div className="form-grid">
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Códigos ISO (separados por coma) — formato ISO 6346</label>
                  <input value={form.isos} placeholder="Ej. ZDRU1234565, ZDRU7654327" onChange={(e) => setForm({ ...form, isos: e.target.value })} />
                </div>
                <div>
                  <label>Depósito de ingreso</label>
                  <select value={form.depotId} onChange={(e) => setForm({ ...form, depotId: e.target.value })}>
                    {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div style={{ alignSelf: "end" }}>
                  <button type="button" className="btn-ghost" style={{ width: "100%" }} onClick={generateRows}>Generar filas de detalle</button>
                </div>
              </div>
              {rows.length ? (
                <PiRows
                  rows={rows}
                  types={types}
                  cats={cats}
                  manufacturers={meta.manufacturers || []}
                  total={total}
                  updateRow={updateRow}
                  applyIsoFix={applyIsoFix}
                  keepIsoAsIs={keepIsoAsIs}
                  copyRowToAll={copyRowToAll}
                  removeRow={(idx) => setRows((prev) => prev.filter((_, i) => i !== idx))}
                />
              ) : null}
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <p className="hint-inline">No hay unidades pendientes de factura. Esa consolidación entra cuando Almacén registra un ingreso sin factura (Sprint 3).</p>
            </div>
          )}

          <DocPicker kinds={meta.docKinds?.length ? meta.docKinds : DOC_KINDS} docs={docs} setDocs={setDocs} />

          <button className="btn-primary" type="submit" style={{ marginTop: 12 }}>Registrar factura de compra</button>
        </form>
      </div>

      <div className="panel">
        <h3>Facturas de compra registradas</h3>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th></th><th>N°</th><th>Proveedor</th><th>Fecha</th><th>Incoterm</th><th>Monto</th><th>Unidades</th><th>Docs</th></tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr><td colSpan={8} style={{ color: "var(--text-2)" }}>Aún no hay facturas de compra registradas.</td></tr>
              ) : invoices.map((pi) => {
                const open = expanded === pi.id;
                return (
                  <InvoiceBlock
                    key={pi.id}
                    pi={pi}
                    open={open}
                    onToggle={() => setExpanded(open ? null : pi.id)}
                    extraServices={extraServices}
                    logisticsLabel={logisticsLabel(pi.logistics)}
                    kinds={meta.docKinds?.length ? meta.docKinds : DOC_KINDS}
                    onChanged={async () => { await load(); onChanged?.(); }}
                    onView={setViewer}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {viewer ? <DocViewer doc={viewer} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}

function InvoiceBlock({ pi, open, onToggle, extraServices, logisticsLabel, kinds, onChanged, onView }) {
  const [adding, setAdding] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const documents = pi.documents || [];

  async function attach(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!adding.length) return;
    setBusy(true);
    setMsg("");
    try {
      await uploadInvoiceDocs(pi.id, adding);
      setAdding([]);
      await onChanged?.();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className="expandable" onClick={onToggle}>
        <td><span className={`chev ${open ? "open" : ""}`}>▶</span></td>
        <td>{pi.number}</td>
        <td>{pi.providerName}</td>
        <td>{pi.createdAt ? new Date(pi.createdAt).toLocaleDateString("es-PE") : "—"}</td>
        <td>{pi.incoterm ? <span className="badge-scope" style={{ background: "#495057" }}>{pi.incoterm}</span> : "—"}</td>
        <td>{money(pi.amount)}</td>
        <td>{pi.lines?.length || 0}</td>
        <td>{documents.length ? <span className="count-badge">{documents.length}</span> : "—"}</td>
      </tr>
      {open ? (
        <tr className="subrow">
          <td colSpan={8}>
            <div className="subrow-inner" style={{ maxWidth: "100%" }}>
              <div className="box-kicker" style={{ marginBottom: 4 }}>{logisticsLabel} — condiciones de pago adicionales</div>
              {extraServices.map((s) => {
                const st = extraStatusLabel(pi.extraStatuses?.[s.key] || "included");
                return (
                  <div className="cost-line" key={s.key}>
                    <span>{s.label}</span>
                    <span style={{ color: st.color, fontSize: 12 }}>{st.text}</span>
                  </div>
                );
              })}
              <div style={{ margin: "10px 0", borderTop: "1px solid var(--line)" }} />
              {(pi.lines || []).map((l) => (
                <div className="cost-line" key={l.iso}><span>{l.iso}</span><b>{money(l.price)}</b></div>
              ))}
              <div className="cost-line">
                <span>BL registrado (número)</span>
                <span style={{ color: pi.blComplete ? "#2f9e44" : "#c92a2a", fontSize: 12 }}>{pi.blComplete ? "✓ completo" : "✗ falta"}</span>
              </div>

              <div className="import-box" style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                <div className="box-kicker">Documentos de la compra</div>
                {documents.length === 0 ? (
                  <p className="hint-inline" style={{ marginTop: 0 }}>Aún no hay archivos. Adjunta la factura, BL, manifiesto u otros (PDF o imagen).</p>
                ) : (
                  <div className="tablewrap">
                    <table className="data">
                      <thead><tr><th>Tipo</th><th>Archivo</th><th>Tamaño</th><th></th></tr></thead>
                      <tbody>
                        {documents.map((d) => (
                          <tr key={d.id}>
                            <td>{d.kindLabel || d.kind}</td>
                            <td className="iso-cell">{d.originalName}</td>
                            <td>{formatBytes(d.sizeBytes)}</td>
                            <td>
                              <button type="button" className="link-btn" onClick={() => onView(d)}>Ver</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <DocPicker kinds={kinds} docs={adding} setDocs={setAdding} compact />
                {msg ? <div className="err">{msg}</div> : null}
                {adding.length ? (
                  <button type="button" className="btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={attach}>
                    {busy ? "Subiendo…" : "Adjuntar a esta factura"}
                  </button>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DocPicker({ kinds, docs, setDocs, compact }) {
  function onFiles(e) {
    const chosen = Array.from(e.target.files || []);
    e.target.value = "";
    if (!chosen.length) return;
    setDocs((prev) => {
      const start = prev.length;
      return [
        ...prev,
        ...chosen.map((file, i) => ({ file, kind: start === 0 && i === 0 ? "factura" : "otro" })),
      ];
    });
  }
  return (
    <div className={compact ? "" : "import-box"} style={compact ? { marginTop: 10, padding: 0, border: "none", background: "transparent" } : undefined}>
      {!compact ? <div className="box-kicker">Documentos de la compra</div> : null}
      {!compact ? (
        <p className="section-sub" style={{ marginTop: 0 }}>
          Adjunta el PDF o la foto de la factura y documentos afines (BL, manifiesto, packing list, DAM). Máximo 10 archivos, 15 MB cada uno. PDF, JPG, PNG, WEBP o GIF.
        </p>
      ) : null}
      <label className="btn-ghost" style={{ display: "inline-block" }}>
        {compact ? "+ Adjuntar archivos" : "Seleccionar archivos"}
        <input type="file" accept={ACCEPT_DOCS} multiple hidden onChange={onFiles} />
      </label>
      {docs.length ? (
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table className="data">
            <thead><tr><th>Archivo</th><th>Tipo</th><th></th></tr></thead>
            <tbody>
              {docs.map((item, idx) => (
                <tr key={`${item.file.name}-${idx}`}>
                  <td className="iso-cell">{item.file.name} <span className="muted">({formatBytes(item.file.size)})</span></td>
                  <td>
                    <select value={item.kind} onChange={(e) => setDocs((prev) => prev.map((d, i) => (i === idx ? { ...d, kind: e.target.value } : d)))}>
                      {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="link-btn" style={{ color: "#c92a2a" }} onClick={() => setDocs((prev) => prev.filter((_, i) => i !== idx))}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function DocViewer({ doc, onClose }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    apiBlob(`/purchases/documents/${doc.id}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]);

  return (
    <div className="doc-overlay" onClick={onClose} role="presentation">
      <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="doc-modal-bar">
          <div>
            <div className="box-kicker" style={{ margin: 0 }}>{doc.kindLabel || doc.kind}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{doc.originalName}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {url ? <a className="btn-ghost" href={url} download={doc.originalName}>Descargar</a> : null}
            <button type="button" className="btn-primary" onClick={onClose}>Cerrar</button>
          </div>
        </div>
        {error ? <div className="err">{error}</div> : null}
        {!url && !error ? <p className="hint-inline">Cargando…</p> : null}
        {url && doc.isImage ? <img src={url} alt={doc.originalName} className="doc-preview" /> : null}
        {url && doc.isPdf ? <iframe title={doc.originalName} src={url} className="doc-preview-pdf" /> : null}
        {url && !doc.isImage && !doc.isPdf ? <p className="hint-inline">Archivo listo. Usa Descargar para abrirlo.</p> : null}
      </div>
    </div>
  );
}

function PiRows({ rows, types, cats, manufacturers, total, updateRow, applyIsoFix, keepIsoAsIs, copyRowToAll, removeRow }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div className="box-kicker" style={{ margin: 0 }}>Detalle por unidad ({rows.length}) — cada contenedor es independiente</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn-ghost" onClick={() => copyRowToAll(false)}>Copiar tipo/condición/año/fabricante de la fila 1 a todas</button>
          <button type="button" className="btn-ghost" onClick={() => copyRowToAll(true)}>Copiar también el precio</button>
        </div>
      </div>
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr><th>ISO</th><th>Tipo *</th><th>Condición *</th><th>Año</th><th>Fabricante</th><th>Precio (USD) *</th><th>BL</th><th>Manifiesto</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const check = parseIso6346(r.iso);
              return (
                <tr key={`${r.iso}-${idx}`}>
                  <td className="iso-cell">
                    <IsoStatus check={check} row={r} idx={idx} applyIsoFix={applyIsoFix} keepIsoAsIs={keepIsoAsIs} updateRow={updateRow} />
                  </td>
                  <td>
                    <select value={r.type} onChange={(e) => updateRow(idx, "type", e.target.value)}>
                      {types.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={r.cat} onChange={(e) => updateRow(idx, "cat", e.target.value)}>
                      {cats.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={r.year} onChange={(e) => updateRow(idx, "year", e.target.value)}>
                      <option value="">Selecciona…</option>
                      {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={r.manufacturer} onChange={(e) => updateRow(idx, "manufacturer", e.target.value)}>
                      <option value="">—</option>
                      {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td><input type="number" style={{ width: 100 }} value={r.price} placeholder="0" onChange={(e) => updateRow(idx, "price", e.target.value)} /></td>
                  <td><input type="text" style={{ width: 120 }} value={r.bl} placeholder="Opcional" onChange={(e) => updateRow(idx, "bl", e.target.value)} /></td>
                  <td><input type="text" style={{ width: 120 }} value={r.manifest} placeholder="Opcional" onChange={(e) => updateRow(idx, "manifest", e.target.value)} /></td>
                  <td><button type="button" className="link-btn" style={{ color: "#c92a2a" }} onClick={() => removeRow(idx)}>Quitar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint-inline">BL y Manifiesto son opcionales aquí — si el proveedor aún no los entrega, se pueden completar después en Compras → Nacionalización (DAM), junto con el número de DAM antes de poder despachar la unidad.</p>
      <div className="cost-line" style={{ marginTop: 8 }}><span>Total de la factura (suma de precios por unidad)</span><b>{money(total)}</b></div>
    </div>
  );
}

function IsoStatus({ check, row, idx, applyIsoFix, keepIsoAsIs, updateRow }) {
  if (!check.valid) {
    return <span style={{ color: "#c92a2a" }} title={check.reason}>✗ {row.iso}</span>;
  }
  if (check.checkOk) {
    return <span style={{ color: "#2f9e44" }}>✓ {check.code}</span>;
  }
  if (row.isoOverride) {
    return (
      <div>
        <span style={{ color: "#c9720b" }} title="Caso especial: se mantiene tal como fue ingresado">⚠ {check.code} <i style={{ fontSize: 10 }}>(caso especial)</i></span>
        <input
          type="text"
          style={{ marginTop: 6, width: 220 }}
          placeholder="Motivo de la excepción *"
          value={row.isoExceptionReason}
          onChange={(e) => updateRow(idx, "isoExceptionReason", e.target.value)}
        />
      </div>
    );
  }
  return (
    <div>
      <span style={{ color: "#c9720b" }}>⚠ {check.code}</span><br />
      <span style={{ fontSize: 11, color: "var(--text-2)" }}>Dígito esperado: <b>{check.expectedCheckDigit}</b> → sugerido <b>{check.suggested}</b></span><br />
      <button type="button" className="link-btn" style={{ fontSize: 11 }} onClick={() => applyIsoFix(idx)}>Modificar a {check.suggested}</button>
      {" · "}
      <button type="button" className="link-btn" style={{ fontSize: 11 }} onClick={() => keepIsoAsIs(idx)}>Mantener igual (caso especial)</button>
    </div>
  );
}

function ExtrasTab() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/purchases/extras").then(setRows).catch((e) => setError(e.message));
  }, []);

  const groups = useMemo(() => {
    const by = {};
    for (const p of rows) {
      const id = p.purchaseInvoiceId;
      if (!by[id]) by[id] = { purchaseInvoiceId: id, purchaseNumber: p.purchaseNumber, items: [] };
      by[id].items.push(p);
    }
    return Object.values(by);
  }, [rows]);

  const selected = groups.find((g) => g.purchaseInvoiceId === filter);

  if (error) return <div className="err">{error}</div>;
  if (!rows.length) {
    return (
      <div className="panel">
        <h3>Pendientes por factura de compra</h3>
        <p style={{ color: "#2f9e44", fontWeight: 700, margin: 0 }}>✓ No hay condiciones de pago adicionales pendientes de registrar.</p>
      </div>
    );
  }

  return (
    <div className="panel extras-pending">
      <h3 style={{ marginTop: 0 }}>⏳ Condiciones de pago pendientes ({rows.length} en {groups.length} factura(s) de compra)</h3>
      <p className="section-sub" style={{ marginTop: 0 }}>
        Busca la factura de compra para ver solo sus condiciones pendientes. El monto se confirma cuando llega la factura del proveedor (Sprint 8) — aquí queda la regla que fijó la compra.
      </p>
      <div className="form-grid" style={{ marginBottom: 4 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label>Buscar factura de compra</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Selecciona una factura…</option>
            {groups.map((g) => (
              <option key={g.purchaseInvoiceId} value={g.purchaseInvoiceId}>{g.purchaseNumber} — {g.items.length} servicio(s) pendiente(s)</option>
            ))}
          </select>
        </div>
      </div>
      {selected ? (
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table className="data">
            <thead><tr><th>Servicio</th><th>Unidades</th><th>Proveedor sugerido</th></tr></thead>
            <tbody>
              {selected.items.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.serviceLabel}</td>
                  <td>{(p.isos || []).join(", ")}</td>
                  <td>{p.suggestedProvider || p.provider || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ color: "var(--text-2)", fontSize: 12, marginTop: 8 }}>Selecciona una factura de compra arriba para ver sus condiciones pendientes.</p>
      )}
    </div>
  );
}

function DamTab({ onChanged }) {
  const [pending, setPending] = useState([]);
  const [done, setDone] = useState([]);
  const [form, setForm] = useState({ iso: "", bl: "", manifest: "", damNumber: "" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function load() {
    const [p, d] = await Promise.all([api("/purchases/dam"), api("/purchases/dam?done=1")]);
    setPending(p);
    setDone(d);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  function openForm(c) {
    setForm({ iso: c.iso, bl: c.bl || "", manifest: c.manifest || "", damNumber: "" });
    setError("");
    setOk("");
  }

  async function submit() {
    setError("");
    setOk("");
    if (!form.iso) {
      setError("Selecciona la unidad a nacionalizar.");
      return;
    }
    if (!form.bl.trim() || !form.manifest.trim()) {
      setError("Ingresa el BL y el Manifiesto — el agente de aduana los necesita para tramitar la DAM.");
      return;
    }
    if (!damFormatOk(form.damNumber)) {
      setError("El número de DAM no tiene el formato esperado (ej. 118-2026-40-81593).");
      return;
    }
    try {
      const updated = await api("/purchases/dam", { method: "POST", body: form });
      setOk(`✓ ${updated.iso} nacionalizado — DAM ${updated.damNumber} registrada.`);
      setForm({ iso: "", bl: "", manifest: "", damNumber: "" });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const selected = pending.find((c) => c.iso === form.iso);

  return (
    <>
      <div className="panel">
        <h3>Nacionalización — DAM antes de despachar</h3>
        <p className="section-sub">
          Ninguna unidad importada (compra) puede autorizarse para despacho sin su <b>DAM</b> (Declaración Aduanera de Mercancías) registrada. El proveedor entrega la factura junto con el <b>BL</b> y el <b>Manifiesto</b> de cada contenedor — son los datos que el agente de aduana usa para tramitar la nacionalización. Formato de DAM: <code>118-2026-40-81593</code> (aduana-año-régimen-correlativo).
        </p>
        {error ? <div className="err">{error}</div> : null}
        {ok ? <div className="ok-msg">{ok}</div> : null}
        {pending.length ? (
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>ISO</th><th>Tipo</th><th>Origen</th><th>BL</th><th>Manifiesto</th><th></th></tr></thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.iso}>
                    <td><b>{c.iso}</b></td>
                    <td>{c.type}</td>
                    <td>{c.intakeType === "compra" ? "Compra" : c.intakeType}</td>
                    <td>{c.bl || <i className="muted">Sin registrar</i>}</td>
                    <td>{c.manifest || <i className="muted">Sin registrar</i>}</td>
                    <td>
                      <button type="button" className="link-btn" onClick={() => openForm(c)}>
                        {form.iso === c.iso ? "Editando…" : "Registrar DAM →"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: "#2f9e44", fontWeight: 700 }}>✓ No hay unidades pendientes de nacionalizar.</p>
        )}

        {selected ? (
          <div className="panel dam-form">
            <h3 style={{ marginTop: 0 }}>Registrar nacionalización — {selected.iso}</h3>
            <div className="form-grid">
              <div><label>N° de BL *</label><input value={form.bl} placeholder="Ej. HLCUME3260429576" onChange={(e) => setForm({ ...form, bl: e.target.value })} /></div>
              <div><label>N° de Manifiesto *</label><input value={form.manifest} placeholder="Ej. MN-2026-004821" onChange={(e) => setForm({ ...form, manifest: e.target.value })} /></div>
              <div><label>N° de DAM *</label><input value={form.damNumber} placeholder="118-2026-40-81593" onChange={(e) => setForm({ ...form, damNumber: e.target.value })} /></div>
            </div>
            {form.damNumber && !damFormatOk(form.damNumber) ? (
              <p className="warn-inline">⚠ Formato esperado: 3 dígitos - 4 dígitos - 2 dígitos - 5 dígitos (ej. 118-2026-40-81593).</p>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="btn-ghost" onClick={() => setForm({ iso: "", bl: "", manifest: "", damNumber: "" })}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={submit}>✓ Confirmar nacionalización</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h3>Unidades ya nacionalizadas ({done.length})</h3>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>ISO</th><th>BL</th><th>Manifiesto</th><th>DAM</th><th>Fecha</th></tr></thead>
            <tbody>
              {done.map((c) => (
                <tr key={c.iso}>
                  <td>{c.iso}</td>
                  <td>{c.bl}</td>
                  <td>{c.manifest}</td>
                  <td><b>{c.damNumber}</b></td>
                  <td>{c.nationalizedAt ? new Date(c.nationalizedAt).toLocaleDateString("es-PE") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
