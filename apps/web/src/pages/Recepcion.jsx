import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiUpload, apiUrl, formatWhen } from "../api.js";
import { parseIso6346 } from "../iso6346.js";

const ARCHIVE_PRESETS = ["Contenedor mal ingresado", "Información incorrecta"];

function ArchiveForm({ iso, onDone, onCancel }) {
  const [preset, setPreset] = useState(ARCHIVE_PRESETS[0]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    const reason = preset === "otro" ? other.trim() : preset;
    if (reason.length < 4) {
      setErr("Indica el motivo (mínimo 4 caracteres).");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api(`/warehouse/units/${iso}/archive`, { method: "POST", body: { reason } });
      onDone(iso, reason);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="archive-box" onClick={(e) => e.stopPropagation()}>
      <b>Archivar {iso}</b>
      <p className="section-sub">Sale de recepción, patio y catálogo. El ISO queda reservado.</p>
      <select value={preset} onChange={(e) => setPreset(e.target.value)}>
        {ARCHIVE_PRESETS.map((r) => <option key={r} value={r}>{r}</option>)}
        <option value="otro">Otro motivo…</option>
      </select>
      {preset === "otro" ? (
        <textarea
          rows={2}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Describe el motivo"
        />
      ) : null}
      {err ? <div className="err">{err}</div> : null}
      <div className="action-row">
        <button className="btn-primary" type="button" disabled={busy} onClick={submit}>Archivar</button>
        <button className="btn-ghost" type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

function whoLine(u) {
  return `Registró ${u.registeredByName || "—"} · ${formatWhen(u.createdAt)}`;
}

export default function Recepcion() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [pending, setPending] = useState([]);
  const [mode, setMode] = useState("bandeja");
  const [inspectIso, setInspectIso] = useState(null);
  const [unit, setUnit] = useState(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    category: "pendiente_factura",
    iso: "",
    type: "20GP",
    cat: "CW",
    depotId: "",
    customerId: "",
    discount: 0,
  });
  const [isoHint, setIsoHint] = useState(null);
  const [bust, setBust] = useState(0);
  const [archiving, setArchiving] = useState(null);

  async function loadPending() {
    const rows = await api("/warehouse/pending");
    setPending(rows);
  }

  useEffect(() => {
    api("/warehouse/meta")
      .then((m) => {
        setMeta(m);
        setForm((f) => ({
          ...f,
          depotId: f.depotId || m.depots[0]?.id || "",
          customerId: f.customerId || m.customers[0]?.id || "",
          type: f.type || m.types[0]?.code || "20GP",
          cat: f.cat || m.categories[0]?.code || "CW",
        }));
      })
      .catch((e) => setError(e.message));
    loadPending().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!inspectIso) {
      setUnit(null);
      return;
    }
    api(`/warehouse/units/${inspectIso}`)
      .then(setUnit)
      .catch((e) => setError(e.message));
  }, [inspectIso]);

  useEffect(() => {
    const raw = form.iso.trim();
    if (mode !== "nuevo") return;
    if (!raw) {
      setIsoHint({ kind: "idle" });
      return;
    }
    const check = parseIso6346(raw);
    if (!check.valid) {
      setIsoHint({ kind: "err", text: check.reason });
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api(`/warehouse/iso?code=${encodeURIComponent(check.code)}`)
        .then((d) => {
          if (cancelled) return;
          if (d.duplicate) {
            setIsoHint({
              kind: "err",
              text: `Ya existe un contenedor con este código (estado: ${d.existingStatus}) — cada ISO identifica una única unidad del inventario, no puede repetirse.`,
            });
          } else if (!d.checkOk) {
            setIsoHint({
              kind: "warn",
              text: `"${d.code}" no pasa el dígito de control ISO 6346 (esperado ${d.expectedCheckDigit} → sugerido ${d.suggested}). Verifica el código en la placa del contenedor.`,
            });
          } else {
            setIsoHint({ kind: "ok", text: "Código válido y disponible — no está registrado en el inventario, se puede continuar." });
          }
        })
        .catch((e) => {
          if (!cancelled) setIsoHint({ kind: "err", text: e.message });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.iso, mode]);

  async function submitNuevo() {
    setError("");
    setMsg("");
    try {
      const created = await api("/warehouse/intake", {
        method: "POST",
        body: {
          category: form.category,
          iso: form.iso,
          type: form.type,
          cat: form.cat,
          depotId: form.depotId,
          customerId: form.customerId,
          discount: form.discount,
        },
      });
      setInspectIso(created.iso);
      setMode("inspect");
      setMsg(`✓ ${created.iso} registrado — completa la inspección física a continuación.`);
      await loadPending();
    } catch (e) {
      setError(e.message);
    }
  }

  async function patchField(field, value) {
    if (!inspectIso) return;
    try {
      const next = await api(`/warehouse/units/${inspectIso}`, { method: "PATCH", body: { [field]: value } });
      setUnit(next);
    } catch (e) {
      setError(e.message);
    }
  }

  async function uploadSlot(slot, file) {
    if (!file || !inspectIso) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("slot", String(slot));
    try {
      const next = await apiUpload(`/warehouse/units/${inspectIso}/photos`, fd);
      setUnit(next);
      setBust(Date.now());
    } catch (e) {
      setError(e.message);
    }
  }

  async function confirm() {
    try {
      const out = await api(`/warehouse/units/${inspectIso}/confirm`, { method: "POST" });
      navigate(`/app/almacen/patio?depotId=${encodeURIComponent(out.depotId)}`);
    } catch (e) {
      setError(e.message);
    }
  }

  if (!meta) {
    return (
      <>
        <h2 className="section-title">Recepción e inspección</h2>
        {error ? <div className="err">{error}</div> : <p className="section-sub">Cargando…</p>}
      </>
    );
  }

  if (mode === "devolucion") {
    return (
      <div className="panel">
        <button className="btn-ghost" type="button" onClick={() => { setMode("bandeja"); setError(""); }}>← Volver</button>
        <h3 style={{ marginTop: 10 }}>Devolución de alquiler</h3>
        <p className="section-sub">No hay alquileres activos pendientes de devolución (Sprint 5).</p>
      </div>
    );
  }

  if (mode === "nuevo") {
    const custody = form.category === "almacenaje_cliente";
    return (
      <div className="panel recv-page">
        <button className="btn-ghost recv-back" type="button" onClick={() => { setMode("bandeja"); setError(""); setMsg(""); }}>← Volver</button>
        <h3 style={{ marginTop: 10 }}>Nuevo ingreso — {custody ? "almacenaje de cliente tercero" : "compra sin factura (reentrega)"}</h3>
        <p className="section-sub">Escribe el ISO de la placa. Luego sigue la inspección con fotos.</p>
        {error ? <div className="err">{error}</div> : null}
        <div className="form-grid">
          <div>
            <label>Código ISO *</label>
            <input
              className="recv-iso"
              value={form.iso}
              placeholder="Ej. ZDRU1234565"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              onChange={(e) => setForm({ ...form, iso: e.target.value.toUpperCase() })}
            />
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {!form.iso.trim() ? (
                <span style={{ color: "var(--text-3)" }}>Escribe el código ISO 6346 — el sistema valida el formato y el dígito de control mientras escribes, y comprueba que no esté ya en el inventario.</span>
              ) : isoHint?.kind === "err" ? (
                <span style={{ color: "#c92a2a" }}>✗ {isoHint.text}</span>
              ) : isoHint?.kind === "warn" ? (
                <span style={{ color: "#c9720b" }}>⚠ {isoHint.text}</span>
              ) : isoHint?.kind === "ok" ? (
                <span style={{ color: "#2f9e44" }}>✓ {isoHint.text}</span>
              ) : null}
            </div>
          </div>
          <div>
            <label>Tipo *</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {meta.types.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
            </select>
          </div>
          <div>
            <label>Condición *</label>
            <select value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })}>
              {meta.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label>Depósito *</label>
            <select value={form.depotId} onChange={(e) => setForm({ ...form, depotId: e.target.value })}>
              {meta.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        {custody ? (
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div>
              <label>Cliente (dueño)</label>
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                {meta.customers.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
            <div>
              <label>Descuento de estadía para este cliente (%)</label>
              <input type="number" min={0} max={100} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
            </div>
          </div>
        ) : null}
        <button className="btn-primary recv-submit" type="button" style={{ marginTop: 12 }} onClick={submitNuevo}>Registrar e inspeccionar</button>
      </div>
    );
  }

  if (mode === "inspect" && unit) {
    const labels = [...meta.photoLabels, "Video 360°"];
    const missing = unit.dataMissing || [];
    return (
      <>
        <div className="unit-picker recv-inspect-bar">
          <button className="btn-ghost recv-back" type="button" onClick={() => { setInspectIso(null); setMode("bandeja"); loadPending(); }}>← Bandeja</button>
          <span className="badge-scope recv-hint" style={{ background: "var(--navy)" }}>Toca una casilla para usar la cámara</span>
        </div>
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="ok-msg">{msg}</div> : null}
        <div className="dash-grid recv-inspect">
          <div className="panel">
            <h3 className="recv-iso-title">{unit.iso} <span className="badge-scope" style={{ background: unit.intakeType === "compra" ? "#2f9e44" : unit.intakeType === "almacenaje_cliente" ? "#495057" : "#c9720b" }}>{unit.intakeLabel}</span></h3>
            <p className="recv-who">{whoLine(unit)}</p>
            <p className="section-sub">Toca cada casilla: en el celular abre la cámara trasera.</p>
            <div className="checklist recv-checklist">
              {labels.map((lab, i) => {
                const done = i < 9 ? unit.photos[i] : unit.hasVideo;
                return (
                  <label key={lab} className={`check-item ${done ? "done" : ""}`}>
                    {done && i < 9 ? (
                      <img className="check-thumb" src={`${apiUrl(`/warehouse/units/${unit.iso}/photos/${i}`)}?t=${bust}`} alt={lab} />
                    ) : null}
                    <input
                      type="file"
                      accept={i < 9 ? "image/*" : "video/*"}
                      capture="environment"
                      style={{ display: "none" }}
                      onChange={(e) => { uploadSlot(i < 9 ? i : "video", e.target.files?.[0]); e.target.value = ""; }}
                    />
                    <span className="check-copy">
                      <span className="n">{i < 9 ? i + 1 : "▶"}</span>
                      {lab}{done ? " ✓" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="gateflow">
              <button className={`gate-btn ${unit.gateIn ? "on" : ""}`} type="button" onClick={() => api(`/warehouse/units/${unit.iso}/gate`, { method: "POST", body: { field: "gateIn" } }).then(setUnit).catch((e) => setError(e.message))}>
                Gate-In (ingreso)
                <small>{unit.gateIn ? `Registrado — $${meta.serviceRates.gate_in} aplicado` : `Registrar entrada al patio ($${meta.serviceRates.gate_in})`}</small>
              </button>
              <button className={`gate-btn ${unit.gateOut ? "on" : ""}`} type="button" onClick={() => api(`/warehouse/units/${unit.iso}/gate`, { method: "POST", body: { field: "gateOut" } }).then(setUnit).catch((e) => setError(e.message))}>
                Gate-Out (despacho)
                <small>{unit.gateOut ? `Registrado — $${meta.serviceRates.gate_out} aplicado` : `Registrar salida del patio ($${meta.serviceRates.gate_out})`}</small>
              </button>
            </div>
            <div className="recv-services">
              <button className="btn-ghost" type="button" onClick={() => api(`/warehouse/units/${unit.iso}/service`, { method: "POST", body: { key: "reparacion" } }).then(setUnit).catch((e) => setError(e.message))}>+ Reparación (${meta.serviceRates.reparacion})</button>
              <button className="btn-ghost" type="button" onClick={() => api(`/warehouse/units/${unit.iso}/service`, { method: "POST", body: { key: "lavado" } }).then(setUnit).catch((e) => setError(e.message))}>+ Lavado (${meta.serviceRates.lavado})</button>
            </div>
          </div>
          <div className="panel">
            <h3>Datos físicos de la unidad</h3>
            <p className="section-sub">Estos datos no vienen en la factura del proveedor — los registra Almacén al recibir la unidad.</p>
            <div className="form-grid">
              <div><label>Tara (kg)</label><input type="number" defaultValue={unit.tareKg} key={`tare-${unit.tareKg}`} onBlur={(e) => patchField("tareKg", e.target.value)} /></div>
              <div><label>Peso bruto máx. (kg)</label><input type="number" defaultValue={unit.mgwKg} key={`mgw-${unit.mgwKg}`} onBlur={(e) => patchField("mgwKg", e.target.value)} /></div>
              <div>
                <label>Color exterior</label>
                <select value={!unit.color || unit.color === "—" ? "" : unit.color} onChange={(e) => patchField("color", e.target.value)}>
                  <option value="">Selecciona…</option>
                  {meta.colors.map((cl) => <option key={cl} value={cl}>{cl}</option>)}
                </select>
              </div>
              <div>
                <label>Condición comercial</label>
                <select value={unit.cat} onChange={(e) => patchField("cat", e.target.value)}>
                  {meta.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label>Año *</label>
                <select value={unit.year || ""} onChange={(e) => patchField("year", e.target.value ? parseInt(e.target.value, 10) : null)}>
                  <option value="">Selecciona…</option>
                  {meta.years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label>Fabricante *</label>
                <select value={!unit.manufacturer || unit.manufacturer === "—" ? "" : unit.manufacturer} onChange={(e) => patchField("manufacturer", e.target.value || "—")}>
                  <option value="">—</option>
                  {meta.manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            {missing.length ? (
              <p style={{ fontSize: 11, color: "#c9720b", marginTop: 6, fontWeight: 700 }}>⚠ {missing.join(" · ")}</p>
            ) : (
              <p style={{ fontSize: 11, color: "#2f9e44", marginTop: 6, fontWeight: 700 }}>✓ Datos completos — listo para confirmar</p>
            )}
            <div className="cost-line" style={{ marginTop: 12 }}><span>Depósito y posición actual</span><b>{unit.depotName} — {unit.posLabel}</b></div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase" }}>Notas de inspección</label>
              <textarea
                rows={3}
                style={{ width: "100%", marginTop: 6, padding: "9px 10px", border: "1px solid var(--line)", borderRadius: 7, fontFamily: "inherit" }}
                defaultValue={unit.inspectionNotes}
                key={`notes-${unit.iso}`}
                onBlur={(e) => patchField("inspectionNotes", e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="recv-confirm-bar">
          <button className="btn-primary" type="button" disabled={missing.length > 0} onClick={confirm}>✓ Confirmar recepción → Patio</button>
          {missing.length ? <p className="recv-confirm-hint">Completa año y fabricante para habilitar.</p> : null}
          {archiving === unit.iso ? (
            <ArchiveForm
              iso={unit.iso}
              onDone={(iso) => { setArchiving(null); setInspectIso(null); setMode("bandeja"); setMsg(`${iso} archivado.`); loadPending(); }}
              onCancel={() => setArchiving(null)}
            />
          ) : (
            <button className="btn-ghost recv-archive-btn" type="button" onClick={() => setArchiving(unit.iso)}>Archivar esta unidad</button>
          )}
        </div>
      </>
    );
  }

  const intakeColor = (t) => (t === "compra" ? "#2f9e44" : t === "almacenaje_cliente" ? "#495057" : "#c9720b");

  return (
    <div className="panel recv-page">
      <h3>Recepción e inspección</h3>
      <p className="section-sub">Elige un pendiente o registra un ingreso nuevo. En el celular las fotos se toman con la cámara.</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <div className="recv-actions">
        <button className="btn-ghost" type="button" onClick={() => { setForm({ ...form, category: "pendiente_factura", iso: "" }); setMode("nuevo"); setError(""); }}>
          <span className="recv-full">+ Nuevo ingreso — compra sin factura (reentrega)</span>
          <span className="recv-short">+ Compra sin factura</span>
        </button>
        <button className="btn-ghost" type="button" onClick={() => { setForm({ ...form, category: "almacenaje_cliente", iso: "" }); setMode("nuevo"); setError(""); }}>
          <span className="recv-full">+ Nuevo ingreso — almacenaje de cliente tercero</span>
          <span className="recv-short">+ Almacenaje de cliente</span>
        </button>
        <button className="btn-ghost" type="button" onClick={() => setMode("devolucion")}>
          <span className="recv-full">↩ Registrar devolución de alquiler</span>
          <span className="recv-short">↩ Devolución alquiler</span>
        </button>
      </div>
      {pending.length ? (
        <>
          <h3 style={{ marginTop: 0 }}>Pendientes ({pending.length})</h3>
          <p className="section-sub">Toca una unidad para continuar la inspección.</p>
          <div className="tablewrap recv-table">
            <table className="data">
              <thead>
                <tr><th>ISO</th><th>Tipo</th><th>Condición</th><th>Depósito</th><th>Origen</th><th>Registró</th><th>Motivo pendiente</th><th></th></tr>
              </thead>
              <tbody>
                {pending.map((u) => (
                  <tr key={u.iso} className="expandable" onClick={() => { if (archiving !== u.iso) { setInspectIso(u.iso); setMode("inspect"); setError(""); } }}>
                    <td><b>{u.iso}</b></td>
                    <td>{u.typeLabel}</td>
                    <td style={{ color: u.catColor }}>{u.catLabel}</td>
                    <td>{u.depotName}</td>
                    <td><span className="badge-scope" style={{ background: intakeColor(u.intakeType) }}>{u.intakeLabel}</span></td>
                    <td className="recv-who">{u.registeredByName || "—"}<br />{formatWhen(u.createdAt)}</td>
                    <td>{u.missing.map((r) => <span key={r} className="badge-scope" style={{ background: "#c9720b", marginRight: 4 }}>{r}</span>)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {archiving === u.iso ? (
                        <ArchiveForm
                          iso={u.iso}
                          onDone={(iso) => { setArchiving(null); setMsg(`${iso} archivado.`); loadPending(); }}
                          onCancel={() => setArchiving(null)}
                        />
                      ) : (
                        <button className="btn-ghost recv-archive-btn" type="button" onClick={() => setArchiving(u.iso)}>Archivar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="recv-cards">
            {pending.map((u) => (
              <div key={u.iso} className="recv-card">
                <button
                  type="button"
                  className="recv-card-open"
                  onClick={() => { setInspectIso(u.iso); setMode("inspect"); setError(""); }}
                >
                  <div className="recv-card-top">
                    <b className="card-iso">{u.iso}</b>
                    <span className="badge-scope" style={{ background: intakeColor(u.intakeType) }}>{u.intakeLabel}</span>
                  </div>
                  <div className="recv-card-meta">{u.typeLabel} · <span style={{ color: u.catColor }}>{u.catLabel}</span></div>
                  <div className="recv-card-meta">{u.depotName}</div>
                  <div className="recv-who">{whoLine(u)}</div>
                  <div className="recv-card-missing">
                    {u.missing.map((r) => <span key={r} className="badge-scope" style={{ background: "#c9720b" }}>{r}</span>)}
                  </div>
                </button>
                {archiving === u.iso ? (
                  <ArchiveForm
                    iso={u.iso}
                    onDone={(iso) => { setArchiving(null); setMsg(`${iso} archivado.`); loadPending(); }}
                    onCancel={() => setArchiving(null)}
                  />
                ) : (
                  <button className="btn-ghost recv-archive-btn" type="button" onClick={() => setArchiving(u.iso)}>Archivar</button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p style={{ color: "#2f9e44", fontWeight: 700 }}>✓ No hay contenedores pendientes de inspección física ni con datos faltantes.</p>
      )}
    </div>
  );
}
