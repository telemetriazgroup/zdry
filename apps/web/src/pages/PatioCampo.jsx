import { useEffect, useMemo, useState } from "react";
import { api, apiUpload, apiUrl, formatWhen } from "../api.js";

const PAGE_SIZE = 20;
const GRADES = [
  { value: "", label: "—" },
  { value: "bueno", label: "Bueno" },
  { value: "regular", label: "Regular" },
  { value: "malo", label: "Malo" },
];

function statusOf(row) {
  if (row.mediaStatus === "aprobado") return { key: "publicado", label: "Publicado", color: "#2f9e44" };
  if (row.fieldRegularizedAt) return { key: "regularizado", label: "En evaluación", color: "#c9720b" };
  return { key: "pendiente", label: "Pendiente de campo", color: "#495057" };
}

export default function PatioCampo() {
  const [meta, setMeta] = useState({ photoLabels: [], categories: [] });
  const [rows, setRows] = useState([]);
  const [daily, setDaily] = useState({ date: "", regularized: [], published: [] });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("pendiente");
  const [page, setPage] = useState(1);
  const [iso, setIso] = useState("");
  const [unit, setUnit] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [bust, setBust] = useState(0);
  const [busy, setBusy] = useState(false);

  async function loadList(search = q) {
    const [list, day] = await Promise.all([
      api(`/warehouse/campo?q=${encodeURIComponent(search.trim())}`),
      api("/warehouse/daily"),
    ]);
    setRows(list);
    setDaily(day);
  }

  useEffect(() => {
    api("/warehouse/meta").then(setMeta).catch((e) => setError(e.message));
    loadList("").catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!iso) {
      setUnit(null);
      return;
    }
    api(`/warehouse/units/${iso}`)
      .then((u) => {
        setUnit(u);
        setBust(Date.now());
      })
      .catch((e) => setError(e.message));
  }, [iso]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const s = statusOf(r).key;
      if (filter === "pendiente") return s === "pendiente";
      if (filter === "regularizado") return s === "regularizado";
      if (filter === "publicado") return s === "publicado";
      return true;
    });
  }, [rows, filter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function uploadSlot(slot, file) {
    if (!file || !iso) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("slot", String(slot));
    try {
      const next = await apiUpload(`/warehouse/units/${iso}/photos`, fd);
      setUnit(next);
      setBust(Date.now());
      setMsg("Foto de campo guardada. Quien publica la evalúa.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveNotes(value) {
    try {
      const next = await api(`/warehouse/units/${iso}`, { method: "PATCH", body: { inspectionNotes: value } });
      setUnit(next);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveCat(value) {
    try {
      const next = await api(`/warehouse/units/${iso}`, { method: "PATCH", body: { cat: value } });
      setUnit(next);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveGrade(key, value) {
    try {
      const next = await api(`/warehouse/units/${iso}`, { method: "PATCH", body: { [key]: value || null } });
      setUnit(next);
    } catch (e) {
      setError(e.message);
    }
  }

  async function regularize() {
    setBusy(true);
    setError("");
    try {
      const next = await api(`/warehouse/units/${iso}/regularize`, { method: "POST" });
      setUnit(next);
      setMsg(`${iso} enviado a evaluación. Quien publica decide si sale a la web.`);
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (unit) {
    const labels = [...(meta.photoLabels || []), "Video corto"];
    return (
      <>
        <div className="unit-picker recv-inspect-bar">
          <button
            className="btn-ghost recv-back"
            type="button"
            onClick={() => {
              setIso("");
              setUnit(null);
              setMsg("");
              loadList().catch((e) => setError(e.message));
            }}
          >
            ← Cola de campo
          </button>
        </div>
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="ok-msg">{msg}</div> : null}
        <div className="dash-grid recv-inspect">
          <div className="panel">
            <h3 className="recv-iso-title">
              {unit.iso}{" "}
              <span className="badge-scope" style={{ background: statusOf(unit).color }}>{statusOf(unit).label}</span>
              {unit.isoException ? <span className="badge-scope" style={{ background: "#c92a2a" }}>ISO a revisar</span> : null}
            </h3>
            <p className="section-sub">
              Patio de campo: sube fotos o notas para evaluación. No ves fotos de Odoo ni puedes cambiar tara, peso, color, DUA o procedencia.
            </p>
            {unit.isoException ? (
              <div className="iso-review-banner">
                <b>ISO a revisar en placa.</b>
                <div className="action-row">
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => api(`/warehouse/units/${unit.iso}/iso-review`, { method: "POST", body: { note: "Revisado en campo" } }).then(setUnit).catch((e) => setError(e.message))}
                  >
                    Marcar ISO revisado
                  </button>
                </div>
              </div>
            ) : null}
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
          </div>
          <div className="panel">
            <h3>Información de campo</h3>
            <p className="section-sub">Condición y notas para quien publique la ficha. No sustituyen los datos de Odoo.</p>
            <div className="form-grid">
              <div>
                <label>Condición comercial</label>
                <select value={unit.cat} onChange={(e) => saveCat(e.target.value)}>
                  {(meta.categories || []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              {[
                ["conditionFloor", "Piso"],
                ["conditionRoof", "Techo"],
                ["conditionDoors", "Puertas"],
                ["conditionPaint", "Pintura"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label>{label}</label>
                  <select value={unit[key] || ""} onChange={(e) => saveGrade(key, e.target.value)}>
                    {GRADES.map((g) => <option key={g.value || "empty"} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="cost-line" style={{ marginTop: 12 }}><span>Depósito</span><b>{unit.depotName} — {unit.posLabel}</b></div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase" }}>Notas para evaluación</label>
              <textarea
                rows={4}
                style={{ width: "100%", marginTop: 6, padding: "9px 10px", border: "1px solid var(--line)", borderRadius: 7, fontFamily: "inherit" }}
                defaultValue={unit.inspectionNotes}
                key={`notes-${unit.iso}-${unit.fieldRegularizedAt || ""}`}
                onBlur={(e) => saveNotes(e.target.value)}
              />
            </div>
            {unit.fieldRegularizedAt ? (
              <p className="section-sub" style={{ marginTop: 10 }}>
                Enviado a evaluación {formatWhen(unit.fieldRegularizedAt)}
                {unit.fieldRegularizedByName ? ` · ${unit.fieldRegularizedByName}` : ""}.
              </p>
            ) : null}
          </div>
        </div>
        <div className="recv-confirm-bar">
          <button className="btn-primary" type="button" disabled={busy} onClick={regularize}>
            {unit.fieldRegularizedAt ? "Volver a enviar a evaluación" : "Enviar a evaluación"}
          </button>
          <p className="recv-confirm-hint">Quien publica en Ficha catálogo decide si la unidad sale a la web.</p>
        </div>
      </>
    );
  }

  return (
    <div className="panel recv-page">
      <h3>Patio — campo</h3>
      <p className="section-sub">
        Fotos e información de campo para evaluación. No se ven ni se editan datos de Odoo. El recuento del día es en hora de Lima.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <div className="tile-row campo-daily">
        <div className="tile">
          <div className="v">{daily.regularized?.length || 0}</div>
          <div className="l">Regularizados hoy</div>
        </div>
        <div className="tile">
          <div className="v">{daily.published?.length || 0}</div>
          <div className="l">Publicados hoy</div>
        </div>
        <div className="tile">
          <div className="v">{daily.date || "—"}</div>
          <div className="l">Fecha Lima</div>
        </div>
      </div>
      {(daily.regularized?.length || daily.published?.length) ? (
        <div className="campo-day-lists">
          {daily.regularized?.length ? (
            <div>
              <b>Regularizados</b>
              <ul>
                {daily.regularized.map((r) => (
                  <li key={`r-${r.iso}`}>
                    <button type="button" className="odoo-open" onClick={() => setIso(r.iso)}>{r.iso}</button>
                    <span> · {r.depotName} · {r.by || "—"} · {formatWhen(r.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {daily.published?.length ? (
            <div>
              <b>Publicados</b>
              <ul>
                {daily.published.map((r) => (
                  <li key={`p-${r.iso}`}>
                    <button type="button" className="odoo-open" onClick={() => setIso(r.iso)}>{r.iso}</button>
                    <span> · {r.depotName} · {formatWhen(r.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="odoo-toolbar">
        <input
          className="odoo-search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          onKeyDown={(e) => { if (e.key === "Enter") loadList().catch((err) => setError(err.message)); }}
          placeholder="Buscar ISO…"
        />
        <button className="btn-ghost" type="button" onClick={() => loadList().catch((e) => setError(e.message))}>Buscar</button>
        <label className="odoo-filter">
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="pendiente">Pendientes de campo</option>
            <option value="regularizado">En evaluación</option>
            <option value="publicado">Publicados</option>
            <option value="todos">Todos</option>
          </select>
        </label>
      </div>
      <div className="recv-cards">
        {pageRows.map((r) => {
          const st = statusOf(r);
          return (
            <button key={r.iso} type="button" className="recv-card" onClick={() => { setIso(r.iso); setError(""); setMsg(""); }}>
              <div className="recv-card-top">
                <b>{r.iso}</b>
                <span className="badge-scope" style={{ background: st.color }}>{st.label}</span>
              </div>
              <div className="recv-card-meta">{r.depotName} · {r.typeLabel} · {r.catLabel}</div>
              <div className="recv-card-missing">
                <span className="badge-scope" style={{ background: "#12203a" }}>{r.photoCount}/9 fotos</span>
                {r.isoException ? <span className="badge-scope" style={{ background: "#c92a2a" }}>ISO a revisar</span> : null}
              </div>
            </button>
          );
        })}
      </div>
      {!filtered.length ? <p className="section-sub">No hay unidades en este filtro.</p> : null}
      {filtered.length > PAGE_SIZE ? (
        <div className="odoo-pager">
          <button className="btn-ghost" type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Anterior</button>
          <span>Página {safePage} / {pages}</span>
          <button className="btn-ghost" type="button" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Siguiente</button>
        </div>
      ) : null}
    </div>
  );
}
