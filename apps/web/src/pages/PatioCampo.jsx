import { useEffect, useMemo, useState } from "react";
import { api, apiUpload, apiUrl, formatWhen } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useLightbox } from "../media-lightbox.jsx";

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

function photoLabel(status) {
  if (status === "approved") return "Foto aprobada";
  if (status === "pending") return "Foto por aprobar";
  if (status === "rejected") return "Foto rechazada";
  return "Sin foto";
}

function VisitItem({ visit, onClick, showPendingPhoto, extra }) {
  const showPhoto = visit.photoStatus === "approved" || (showPendingPhoto && visit.hasPhoto);
  return (
    <button type="button" className={`campo-item ${visit.containerIso ? "linked" : "pending-dry"}`} onClick={onClick}>
      <span className="campo-item-accent" />
      <span className="campo-item-thumb">
        {showPhoto ? (
          <img src={apiUrl(`/gate-visits/${visit.id}/photo`)} alt="" />
        ) : (
          <span>{photoLabel(visit.photoStatus)}</span>
        )}
      </span>
      <span className="campo-item-body">
        <span className="campo-item-top">
          <b>{visit.tractorPlate}</b>
          <span className="badge-scope" style={{ background: visit.containerIso ? "#2f9e44" : "#c9720b" }}>
            {visit.containerIso ? `DRY ${visit.containerIso}` : "Sin DRY"}
          </span>
        </span>
        <span className="campo-item-meta">
          {visit.driverName || "sin conductor"} · {visit.motive}
          {visit.company ? ` · ${visit.company}` : ""}
        </span>
        {extra ? <span className="campo-item-meta">{extra}</span> : null}
      </span>
    </button>
  );
}

export default function PatioCampo() {
  const { user } = useAuth();
  const canReview = user.role === "admin" || user.role === "coordinador";
  const lb = useLightbox();
  const [meta, setMeta] = useState({ photoLabels: [], categories: [], depots: [] });
  const [rows, setRows] = useState([]);
  const [arrivals, setArrivals] = useState([]);
  const [capNote, setCapNote] = useState("");
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
  const [lookup, setLookup] = useState(null);
  const [looked, setLooked] = useState(false);
  const [emergency, setEmergency] = useState({ open: false, iso: "", note: "", depotId: "" });

  async function loadList(search = q) {
    const [list, day, visits] = await Promise.all([
      api(`/warehouse/campo?q=${encodeURIComponent(search.trim())}`),
      api("/warehouse/daily"),
      api("/gate-visits/arrivals").catch(() => []),
    ]);
    setRows(list);
    setDaily(day);
    setArrivals(visits);
  }

  useEffect(() => {
    api("/warehouse/meta")
      .then((m) => {
        setMeta(m);
        setEmergency((e) => ({ ...e, depotId: e.depotId || m.depots?.[0]?.id || "" }));
      })
      .catch((e) => setError(e.message));
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

  async function uploadCapture(file) {
    if (!file || !iso) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("note", capNote);
    try {
      const next = await apiUpload(`/warehouse/units/${iso}/captures`, fd);
      setUnit(next);
      setBust(Date.now());
      setCapNote("");
      setMsg("Toma guardada en la bandeja. El coordinador la asigna a la casilla del catálogo.");
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

  async function saveGrade(key, value) {
    try {
      const body = key === "roofHole" ? { roofHole: value } : { [key]: value || null };
      const next = await api(`/warehouse/units/${iso}`, { method: "PATCH", body });
      setUnit(next);
    } catch (e) {
      setError(e.message);
    }
  }

  async function searchVisits() {
    const term = q.trim();
    setError("");
    setLooked(true);
    if (term.length < 3) {
      setLookup(null);
      await loadList(term);
      return;
    }
    try {
      const [found, list] = await Promise.all([
        api(`/gate-visits/lookup?q=${encodeURIComponent(term)}`),
        api(`/warehouse/campo?q=${encodeURIComponent(term)}`).catch(() => []),
      ]);
      setLookup(found);
      setRows(list);
      if (!found.found && !list.length) {
        setEmergency((e) => ({ ...e, open: true, iso: term.toUpperCase() }));
        setMsg("No encontramos ese DRY ni esa visita. Usa registro de emergencia para no perder fotos ni video.");
      } else {
        setMsg("");
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function openUnit(nextIso, campoEnabledAt) {
    setError("");
    setMsg("");
    if (!campoEnabledAt) {
      try {
        await api("/warehouse/emergency", { method: "POST", body: { iso: nextIso } });
        setMsg(`${nextIso} habilitada por emergencia para no perder las tomas.`);
      } catch (e) {
        setError(e.message);
        return;
      }
    }
    setIso(nextIso);
  }

  function openArrival(v) {
    setError("");
    setMsg("");
    if (v.containerIso) {
      setIso(v.containerIso);
      return;
    }
    setQ(v.tractorPlate);
    setLookup({ found: true, visits: [v], units: [] });
    setLooked(true);
    setMsg(`${v.tractorPlate} aún no tiene DRY vinculado. Si el contenedor no está en la lista, usa registro de emergencia.`);
    setEmergency((e) => ({ ...e, open: true, iso: "" }));
  }

  async function submitEmergency() {
    const code = emergency.iso.trim().toUpperCase();
    if (code.length < 4) {
      setError("Indica el código del contenedor (mínimo 4 caracteres).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await api("/warehouse/emergency", {
        method: "POST",
        body: { iso: code, depotId: emergency.depotId || undefined, note: emergency.note },
      });
      setIso(next.iso);
      setMsg(`Registro de emergencia ${next.iso}. Sube ahora las fotos y videos para no perder la información.`);
      setEmergency((e) => ({ ...e, open: false, iso: "", note: "" }));
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reviewVisitPhoto(id, approve) {
    try {
      await api(`/gate-visits/${id}/photo/${approve ? "approve" : "reject"}`, { method: "POST" });
      if (iso) {
        const next = await api(`/warehouse/units/${iso}`);
        setUnit(next);
      }
      await loadList();
      setMsg(approve ? "Foto de visita aprobada. El personal de patio ya puede contrastarla." : "Foto de visita rechazada.");
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

  const visitPhoto = unit?.visit;
  const showContrast = visitPhoto && (visitPhoto.photoStatus === "approved" || (canReview && visitPhoto.hasPhoto));

  if (unit) {
    return (
      <div className="campo-page">
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
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="ok-msg">{msg}</div> : null}
        <div className="dash-grid recv-inspect">
          <div className="campo-section">
            <h3 className="recv-iso-title">
              {unit.iso}{" "}
              <span className="badge-scope" style={{ background: statusOf(unit).color }}>{statusOf(unit).label}</span>
              {unit.isoException ? <span className="badge-scope" style={{ background: "#c92a2a" }}>ISO a revisar</span> : null}
            </h3>
            {unit.visit ? (
              <p className="section-sub" style={{ marginBottom: 8 }}>
                Conductor: {unit.visit.driverName || "—"} · tracto {unit.visit.tractorPlate} · {unit.visit.motive}
                {unit.visit.company ? ` · ${unit.visit.company}` : ""}
              </p>
            ) : (
              <p className="section-sub">Esta unidad no tiene visita de tracto vinculada.</p>
            )}
            {showContrast ? (
              <div className="campo-contrast">
                <div>
                  <label>Foto de la visita {unit.visit.photoStatus === "approved" ? "(aprobada)" : "(pendiente)"}</label>
                  <button
                    type="button"
                    className="visit-photo-btn"
                    style={{ width: "100%" }}
                    onClick={() => lb.open([{
                      src: `${apiUrl(`/gate-visits/${unit.visit.id}/photo`)}?t=${bust}`,
                      type: "image",
                      label: "Foto de portería",
                    }])}
                  >
                    <img src={`${apiUrl(`/gate-visits/${unit.visit.id}/photo`)}?t=${bust}`} alt="Unidad en portería" />
                  </button>
                  {canReview && unit.visit.photoStatus === "pending" ? (
                    <div className="action-row">
                      <button className="btn-primary" type="button" onClick={() => reviewVisitPhoto(unit.visit.id, true)}>Aprobar para patio</button>
                      <button className="btn-ghost" type="button" onClick={() => reviewVisitPhoto(unit.visit.id, false)}>Rechazar</button>
                    </div>
                  ) : null}
                </div>
                <div>
                  <p className="section-sub" style={{ marginBottom: 8 }}>
                    Contrasta esta toma de portería con la unidad que estás evaluando. Sube tus fotos de campo a la derecha.
                  </p>
                  <label>Nota de esta toma (opcional)</label>
                  <input value={capNote} onChange={(e) => setCapNote(e.target.value)} placeholder="Ej. óxido en esquina derecha" />
                  <label className="btn-ghost" style={{ display: "inline-block", marginTop: 8 }}>
                    + Foto o video de campo
                    <input type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { uploadCapture(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
              </div>
            ) : (
              <>
                {unit.intakeOrigin === "emergencia" ? (
                  <p className="ok-msg">Registro de emergencia. Completa fotos y videos ahora.</p>
                ) : null}
                <p className="section-sub">Sube fotos o video a la bandeja, con una nota si hace falta. No eliges casilla de catálogo.</p>
                <label>Nota de esta toma (opcional)</label>
                <input value={capNote} onChange={(e) => setCapNote(e.target.value)} placeholder="Ej. óxido en esquina derecha" />
                <label className="btn-ghost" style={{ display: "inline-block", marginTop: 8 }}>
                  + Foto o video
                  <input type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { uploadCapture(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              </>
            )}
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
            <div className="odoo-assign-thumbs" style={{ marginTop: 12 }}>
              {(unit.captures || []).map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  className="odoo-assign-thumb"
                  onClick={() => lb.open(
                    (unit.captures || []).map((x) => ({
                      src: `${apiUrl(`/warehouse/units/${unit.iso}/captures/${x.id}`)}?t=${bust}`,
                      type: x.kind === "video" ? "video" : "image",
                      label: x.note || x.originalName || (x.kind === "video" ? "Video de campo" : "Toma de campo"),
                    })),
                    idx,
                  )}
                >
                  {c.kind === "video" ? <span>Video</span> : <img src={`${apiUrl(`/warehouse/units/${unit.iso}/captures/${c.id}`)}?t=${bust}`} alt="" />}
                  <span>{c.note || c.originalName || "Ver detalle"}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="campo-section">
            <h3>Información de campo</h3>
            <p className="section-sub">Condición y notas para quien publique la ficha. No sustituyen los datos de Odoo.</p>
            <div className="form-grid">
              {[
                ["conditionFloor", "Piso"],
                ["conditionRoof", "Techo"],
                ["conditionWalls", "Paredes"],
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
              <div>
                <label>Hueco en techo</label>
                <select value={unit.roofHole == null ? "" : unit.roofHole ? "si" : "no"} onChange={(e) => saveGrade("roofHole", e.target.value === "" ? null : e.target.value === "si")}>
                  <option value="">—</option>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </div>
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
        {lb.node}
      </div>
    );
  }

  return (
    <div className="campo-page">
      <div>
        <h2 className="section-title">Patio — campo</h2>
        <p className="section-sub">
          Elige una visita o un DRY para subir fotos y evaluar. La foto de portería solo aparece aquí cuando el coordinador la aprueba.
        </p>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      {arrivals.length ? (
        <section className="campo-section">
          <h3>Equipos registrados en visita</h3>
          <p className="section-sub">Toca una fila. Si ya tiene DRY, entras a la evaluación. Si no, busca el contenedor o abre emergencia.</p>
          <div className="campo-stack">
            {arrivals.map((v) => (
              <VisitItem key={v.id} visit={v} showPendingPhoto={canReview} onClick={() => openArrival(v)} />
            ))}
          </div>
        </section>
      ) : null}

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

      <section className="campo-section">
        <div className="campo-toolbar">
          <input
            className="odoo-search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); setLooked(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") searchVisits(); }}
            placeholder="Buscar placa, conductor o ISO…"
          />
          <button className="btn-ghost" type="button" onClick={searchVisits}>Buscar</button>
          <button className="btn-primary" type="button" onClick={() => setEmergency((e) => ({ ...e, open: true, iso: q.trim().toUpperCase() }))}>
            Registro emergencia
          </button>
          <label className="odoo-filter">
            <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
              <option value="pendiente">Pendientes de campo</option>
              <option value="regularizado">En evaluación</option>
              <option value="publicado">Publicados</option>
              <option value="todos">Todos</option>
            </select>
          </label>
        </div>

        {lookup?.visits?.length ? (
          <div style={{ marginTop: 14 }}>
            <b>Visitas encontradas</b>
            <div className="campo-stack">
              {lookup.visits.map((v) => (
                <VisitItem key={v.id} visit={v} showPendingPhoto={canReview} onClick={() => openArrival(v)} />
              ))}
            </div>
          </div>
        ) : null}

        {lookup?.units?.length ? (
          <div style={{ marginTop: 14 }}>
            <b>Contenedores DRY</b>
            <div className="campo-stack">
              {lookup.units.map((u) => (
                <button
                  key={u.iso}
                  type="button"
                  className={`campo-item ${u.visit ? "linked" : "pending-dry"}`}
                  onClick={() => openUnit(u.iso, u.campoEnabledAt)}
                >
                  <span className="campo-item-accent" />
                  <span className="campo-item-thumb">
                    {u.visit?.photoStatus === "approved" || (canReview && u.visit?.photoStatus && u.visit.photoStatus !== "none") ? (
                      <img src={apiUrl(`/gate-visits/${u.visit.id}/photo`)} alt="" />
                    ) : (
                      <span>{u.visit ? photoLabel(u.visit.photoStatus) : "DRY"}</span>
                    )}
                  </span>
                  <span className="campo-item-body">
                    <span className="campo-item-top">
                      <b>{u.iso}</b>
                      <span className="badge-scope" style={{ background: u.campoEnabledAt ? "#2f9e44" : "#c9720b" }}>
                        {u.campoEnabledAt ? "En campo" : "Sin habilitar"}
                      </span>
                    </span>
                    <span className="campo-item-meta">
                      {u.depotName}
                      {u.visit ? ` · ${u.visit.driverName || "—"} · ${u.visit.tractorPlate}` : " · sin conductor vinculado"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {looked && lookup && !lookup.found && !filtered.length ? (
          <p className="section-sub" style={{ marginTop: 12 }}>Sin coincidencias. Abre registro de emergencia para guardar el código y las tomas.</p>
        ) : null}

        {emergency.open ? (
          <div className="campo-callout" style={{ marginTop: 14 }}>
            <b>Registro de emergencia</b>
            <p className="section-sub">Si el DRY no está en el sistema, coloca el código ahora y sube fotos o videos para no perder la información.</p>
            <div className="form-grid">
              <div>
                <label>Código del contenedor *</label>
                <input value={emergency.iso} onChange={(e) => setEmergency({ ...emergency, iso: e.target.value.toUpperCase() })} placeholder="Ej. DMOU0000107" />
              </div>
              <div>
                <label>Depósito</label>
                <select value={emergency.depotId} onChange={(e) => setEmergency({ ...emergency, depotId: e.target.value })}>
                  {(meta.depots || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label>Nota</label>
                <input value={emergency.note} onChange={(e) => setEmergency({ ...emergency, note: e.target.value })} placeholder="Ej. llegó sin aviso del coordinador" />
              </div>
            </div>
            <div className="action-row">
              <button className="btn-primary" type="button" disabled={busy} onClick={submitEmergency}>Crear y subir tomas</button>
              <button className="btn-ghost" type="button" onClick={() => setEmergency((e) => ({ ...e, open: false }))}>Cancelar</button>
            </div>
          </div>
        ) : null}

        <div className="campo-stack" style={{ marginTop: 14 }}>
          {pageRows.map((r) => {
            const st = statusOf(r);
            const showPhoto = r.visit?.photoStatus === "approved" || (canReview && r.visit?.photoStatus && r.visit.photoStatus !== "none");
            return (
              <button key={r.iso} type="button" className="campo-item linked" onClick={() => { setIso(r.iso); setError(""); setMsg(""); }}>
                <span className="campo-item-accent" />
                <span className="campo-item-thumb">
                  {showPhoto ? <img src={apiUrl(`/gate-visits/${r.visit.id}/photo`)} alt="" /> : <span>{r.photoCount}/9</span>}
                </span>
                <span className="campo-item-body">
                  <span className="campo-item-top">
                    <b>{r.iso}</b>
                    <span className="badge-scope" style={{ background: st.color }}>{st.label}</span>
                  </span>
                  <span className="campo-item-meta">
                    {r.depotName} · {r.typeLabel} · {r.catLabel}
                    {r.visit ? ` · ${r.visit.tractorPlate} · ${r.visit.driverName || "sin conductor"}` : ""}
                  </span>
                  <span className="campo-item-tags">
                    <span className="badge-scope" style={{ background: "#12203a" }}>{r.photoCount}/9 fotos</span>
                    {r.isoException ? <span className="badge-scope" style={{ background: "#c92a2a" }}>ISO a revisar</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {!filtered.length ? <p className="section-sub" style={{ marginTop: 12 }}>No hay unidades en este filtro.</p> : null}
        {filtered.length > PAGE_SIZE ? (
          <div className="odoo-pager">
            <button className="btn-ghost" type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Anterior</button>
            <span>Página {safePage} / {pages}</span>
            <button className="btn-ghost" type="button" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Siguiente</button>
          </div>
        ) : null}
      </section>
      {lb.node}
    </div>
  );
}
