import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiUpload, apiUrl } from "../api.js";
import { parseIso6346 } from "../iso6346.js";

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
      <div className="panel">
        <button className="btn-ghost" type="button" onClick={() => { setMode("bandeja"); setError(""); setMsg(""); }}>← Volver</button>
        <h3 style={{ marginTop: 10 }}>Nuevo ingreso — {custody ? "almacenaje de cliente tercero" : "compra sin factura (reentrega)"}</h3>
        <p className="section-sub">Esta unidad no tiene ningún registro previo en el sistema, así que se identifica con su código ISO — guiado y validado en vivo, no como un dato libre. Año, fabricante, fotos, tara/peso y posición de patio se completan justo después, en la inspección física que continúa automáticamente al registrar.</p>
        {error ? <div className="err">{error}</div> : null}
        <div className="form-grid">
          <div>
            <label>Código ISO *</label>
            <input
              value={form.iso}
              placeholder="Ej. ZDRU1234565"
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
        <button className="btn-primary" type="button" style={{ marginTop: 12 }} onClick={submitNuevo}>Registrar → continuar con la inspección física</button>
      </div>
    );
  }

  if (mode === "inspect" && unit) {
    const labels = [...meta.photoLabels, "Video 360°"];
    const missing = unit.dataMissing || [];
    return (
      <>
        <div className="unit-picker">
          <button className="btn-ghost" type="button" onClick={() => { setInspectIso(null); setMode("bandeja"); loadPending(); }}>← Volver a la bandeja de pendientes</button>
          <span className="badge-scope" style={{ background: "var(--navy)" }}>📱 Toma la foto con tu celular o cárgala desde el escritorio</span>
        </div>
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="ok-msg">{msg}</div> : null}
        <div className="dash-grid">
          <div className="panel">
            <h3>Inspección multimedia — {unit.iso} <span className="badge-scope" style={{ background: unit.intakeType === "compra" ? "#2f9e44" : unit.intakeType === "almacenaje_cliente" ? "#495057" : "#c9720b" }}>{unit.intakeLabel}</span></h3>
            <p className="section-sub">Toca cada casilla para adjuntar la foto o el video correspondiente.</p>
            <div className="checklist">
              {labels.map((lab, i) => {
                const done = i < 9 ? unit.photos[i] : unit.hasVideo;
                const bg = done && i < 9 ? { backgroundImage: `url(${apiUrl(`/warehouse/units/${unit.iso}/photos/${i}`)})`, backgroundSize: "cover", backgroundPosition: "center", color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,.7)" } : undefined;
                return (
                  <label key={lab} className={`check-item ${done ? "done" : ""}`} style={bg}>
                    <input
                      type="file"
                      accept={i < 9 ? "image/*" : "video/*"}
                      capture="environment"
                      style={{ display: "none" }}
                      onChange={(e) => uploadSlot(i < 9 ? i : "video", e.target.files?.[0])}
                    />
                    <span className="n">{i < 9 ? i + 1 : "▶"}</span>
                    {lab}{done ? " ✓" : ""}
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
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn-ghost" type="button" onClick={() => api(`/warehouse/units/${unit.iso}/service`, { method: "POST", body: { key: "reparacion" } }).then(setUnit).catch((e) => setError(e.message))}>+ Registrar reparación (${meta.serviceRates.reparacion})</button>
              <button className="btn-ghost" type="button" onClick={() => api(`/warehouse/units/${unit.iso}/service`, { method: "POST", body: { key: "lavado" } }).then(setUnit).catch((e) => setError(e.message))}>+ Registrar lavado (${meta.serviceRates.lavado})</button>
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
            <button className="btn-primary" type="button" style={{ width: "100%", marginTop: 14 }} disabled={missing.length > 0} onClick={confirm}>✓ Confirmar recepción e inspección → Layout</button>
            {missing.length ? <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>Completa año y fabricante para habilitar el botón.</p> : null}
          </div>
        </div>
      </>
    );
  }

  const intakeColor = (t) => (t === "compra" ? "#2f9e44" : t === "almacenaje_cliente" ? "#495057" : "#c9720b");

  return (
    <div className="panel">
      <h3>Recepción e inspección</h3>
      <p className="section-sub">Un solo flujo: una recepción genera de inmediato su inspección física, sin pasos separados. El número de contenedor no se escribe libremente sin control — si ya existe un registro pendiente (factura de compra emitida, o un alquiler que se devuelve) lo eliges de una lista, y así el ISO siempre permite la gestión del inventario. Solo cuando la unidad no tiene ningún registro previo en el sistema (compra por reentregar sin factura aún, o almacenaje de un cliente tercero) se identifica con su código ISO, validado en vivo mientras se escribe.</p>
      {error ? <div className="err">{error}</div> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button className="btn-ghost" type="button" onClick={() => { setForm({ ...form, category: "pendiente_factura", iso: "" }); setMode("nuevo"); setError(""); }}>
          + Nuevo ingreso — compra sin factura (reentrega)
        </button>
        <button className="btn-ghost" type="button" onClick={() => { setForm({ ...form, category: "almacenaje_cliente", iso: "" }); setMode("nuevo"); setError(""); }}>
          + Nuevo ingreso — almacenaje de cliente tercero
        </button>
        <button className="btn-ghost" type="button" onClick={() => setMode("devolucion")}>↩ Registrar devolución de alquiler</button>
      </div>
      {pending.length ? (
        <>
          <h3 style={{ marginTop: 0 }}>Pendientes de inspección física ({pending.length})</h3>
          <p className="section-sub">Contenedores con registro ya en el sistema (por factura de compra, o recién identificados aquí) que faltan pasar su inspección física — fotos, datos y confirmación. Toca uno para continuar.</p>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr><th>ISO</th><th>Tipo</th><th>Condición</th><th>Depósito</th><th>Origen del ingreso</th><th>Motivo pendiente</th></tr>
              </thead>
              <tbody>
                {pending.map((u) => (
                  <tr key={u.iso} className="expandable" onClick={() => { setInspectIso(u.iso); setMode("inspect"); setError(""); }}>
                    <td><b>{u.iso}</b></td>
                    <td>{u.typeLabel}</td>
                    <td style={{ color: u.catColor }}>{u.catLabel}</td>
                    <td>{u.depotName}</td>
                    <td><span className="badge-scope" style={{ background: intakeColor(u.intakeType) }}>{u.intakeLabel}</span></td>
                    <td>{u.missing.map((r) => <span key={r} className="badge-scope" style={{ background: "#c9720b", marginRight: 4 }}>{r}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ color: "#2f9e44", fontWeight: 700 }}>✓ No hay contenedores pendientes de inspección física ni con datos faltantes.</p>
      )}
    </div>
  );
}
