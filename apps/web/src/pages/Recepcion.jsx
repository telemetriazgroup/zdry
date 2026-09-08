import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, apiUpload, apiUrl, formatWhen } from "../api.js";
import { useAuth } from "../auth.jsx";
import SearchCreate from "../search-create.jsx";
import { useLightbox } from "../media-lightbox.jsx";
import { parseIso6346 } from "../iso6346.js";

const ARCHIVE_PRESETS = ["Contenedor mal ingresado", "Información incorrecta"];
const PAGE_SIZE = 20;
const EMPTY_VISIT = {
  tractorPlate: "",
  company: "",
  ruc: "",
  driverName: "",
  visitAt: "",
  license: "",
  motive: "descargar",
  trailerPlate: "",
  phone: "",
  equipmentCode: "",
};

function visitToForm(v) {
  if (!v) return { ...EMPTY_VISIT };
  return {
    tractorPlate: v.tractorPlate || "",
    company: v.company || "",
    ruc: v.ruc || "",
    driverName: v.driverName || "",
    visitAt: toLocalInput(v.visitAt),
    license: v.license || "",
    motive: v.motive || "descargar",
    trailerPlate: v.trailerPlate || "",
    phone: v.phone || "",
    equipmentCode: v.equipmentCode || "",
  };
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function newDocRow() {
  return { key: `${Date.now()}-${Math.random()}`, concept: "Recibo de intercambio de equipo (EIR)", file: null };
}

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

function pendingSearchText(u) {
  return [u.iso, u.typeLabel, u.catLabel, u.depotName, u.intakeLabel, u.registeredByName, u.odooLocation, ...(u.missing || [])]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function ArchiveIconBtn({ onClick }) {
  return (
    <button
      type="button"
      className="icon-btn danger"
      title="Archivar"
      aria-label="Archivar"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="4" rx="1" />
        <path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
        <path d="M10 12h4" />
      </svg>
    </button>
  );
}

function whoLine(u) {
  return `Registró ${u.registeredByName || "—"} · ${formatWhen(u.createdAt)}`;
}

function OriginBadges({ u }) {
  return (
    <>
      {u.intakeOrigin === "odoo" ? <span className="badge-scope" style={{ background: "#12203a" }}>Origen Odoo</span> : null}
      {u.isoException ? <span className="badge-scope" style={{ background: "#c92a2a" }}>ISO a revisar</span> : null}
    </>
  );
}

export default function Recepcion() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canSeeOdoo = user.role === "admin";
  const isCoord = user.role === "coordinador";
  const canCoord = user.role === "admin" || user.role === "coordinador";
  const lb = useLightbox();
  const [meta, setMeta] = useState(null);
  const [pending, setPending] = useState([]);
  const [mode, setMode] = useState("bandeja");
  const [inspectIso, setInspectIso] = useState(null);
  const [unit, setUnit] = useState(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [yearErr, setYearErr] = useState("");
  const [activity, setActivity] = useState({ open: false, conceptKey: "", note: "" });
  const [pickedCap, setPickedCap] = useState(null);
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
  const [pendingQ, setPendingQ] = useState("");
  const [pendingPage, setPendingPage] = useState(1);
  const [odooPhotos, setOdooPhotos] = useState([]);
  const [pickedAtt, setPickedAtt] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [visits, setVisits] = useState([]);
  const [visitForm, setVisitForm] = useState(EMPTY_VISIT);
  const [visitMode, setVisitMode] = useState("pick");
  const [editingVisitId, setEditingVisitId] = useState("");
  const [pickVisitId, setPickVisitId] = useState("");
  const [docRows, setDocRows] = useState([newDocRow()]);
  const [capNote, setCapNote] = useState("");

  async function loadPending() {
    const rows = await api("/warehouse/pending");
    setPending(rows);
  }

  async function loadVisits() {
    if (!canCoord) return;
    const list = await api("/gate-visits?filter=all");
    setVisits(list);
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
    loadVisits().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!inspectIso) {
      setUnit(null);
      setOdooPhotos([]);
      setPickedAtt(null);
      return;
    }
    api(`/warehouse/units/${inspectIso}`)
      .then((u) => {
        setUnit(u);
        setDocRows([newDocRow()]);
        if (u.visit) {
          setVisitMode("saved");
          setEditingVisitId(u.visit.id);
          setPickVisitId(u.visit.id);
          setVisitForm(visitToForm(u.visit));
        } else {
          setVisitMode("pick");
          setEditingVisitId("");
          setPickVisitId("");
          setVisitForm(EMPTY_VISIT);
        }
      })
      .catch((e) => setError(e.message));
    loadVisits().catch(() => undefined);
  }, [inspectIso]);

  useEffect(() => {
    if (!canCoord || !(unit?.odooLotId || unit?.hasOdooChatter)) {
      setOdooPhotos([]);
      return;
    }
    api(`/warehouse/units/${unit.iso}/odoo-photos`)
      .then(setOdooPhotos)
      .catch(() => setOdooPhotos([]));
  }, [canCoord, unit?.iso, unit?.odooLotId, unit?.hasOdooChatter]);

  useEffect(() => {
    const raw = form.iso.trim();
    if (mode !== "nuevo") return;
    if (!raw) {
      setIsoHint({ kind: "idle" });
      return;
    }
    const local = parseIso6346(raw);
    if (local.incomplete) {
      setIsoHint({
        kind: "warn",
        text: `El último dígito para que coincida es ${local.expectedCheckDigit}. Código completo: ${local.suggested}.`,
      });
    } else if (local.valid && !local.checkOk) {
      setIsoHint({
        kind: "warn",
        text: `No cumple ISO 6346: el último dígito debería ser ${local.expectedCheckDigit} (escribiste ${local.checkDigit}). Código que lo complementa: ${local.suggested}. No bloquea el alta; se resaltará como ISO a revisar.`,
      });
    } else if (local.valid && local.checkOk) {
      setIsoHint({ kind: "ok", text: "Código ISO 6346 válido. Comprobando inventario…" });
    } else {
      setIsoHint({ kind: "warn", text: local.reason || "Formato incompleto. No bloquea el alta." });
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api(`/warehouse/iso?code=${encodeURIComponent(raw)}`)
        .then((d) => {
          if (cancelled) return;
          if (d.duplicate) {
            setIsoHint({
              kind: "err",
              text: `Ya existe un contenedor con este código (estado: ${d.existingStatus}) — cada ISO identifica una única unidad del inventario, no puede repetirse.`,
            });
          } else if (local.incomplete) {
            setIsoHint({
              kind: "warn",
              text: `El último dígito para que coincida es ${local.expectedCheckDigit}. Código completo: ${local.suggested}.`,
            });
          } else if (d.isoException || !d.checkOk) {
            const digit = d.expectedCheckDigit ?? local.expectedCheckDigit;
            const suggested = d.suggested || local.suggested;
            setIsoHint({
              kind: "warn",
              text: digit != null
                ? `No cumple ISO 6346: el último dígito debería ser ${digit}${local.checkDigit != null ? ` (escribiste ${local.checkDigit})` : ""}. Código que lo complementa: ${suggested}. No bloquea el alta; se resaltará como ISO a revisar.`
                : (d.isoExceptionReason || d.reason || local.reason),
            });
          } else {
            setIsoHint({ kind: "ok", text: "Código válido y disponible — no está registrado en el inventario, se puede continuar." });
          }
        })
        .catch((e) => {
          if (!cancelled && !local.incomplete && !(local.valid && !local.checkOk)) {
            setIsoHint({ kind: "err", text: e.message });
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.iso, mode]);

  const filteredPending = useMemo(() => {
    const raw = pendingQ.trim().toUpperCase();
    const compact = raw.replace(/[\s-]/g, "");
    if (!raw) return pending;
    return pending.filter((u) => {
      const hay = pendingSearchText(u);
      return hay.includes(raw) || hay.replace(/[\s-]/g, "").includes(compact);
    });
  }, [pending, pendingQ]);

  const pendingPages = Math.max(1, Math.ceil(filteredPending.length / PAGE_SIZE));
  const safePendingPage = Math.min(pendingPage, pendingPages);
  const pagePending = filteredPending.slice((safePendingPage - 1) * PAGE_SIZE, safePendingPage * PAGE_SIZE);

  useEffect(() => {
    setPendingPage(1);
  }, [pendingQ]);

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
          enableCampo: isCoord && form.category !== "almacenaje_cliente",
        },
      });
      setInspectIso(created.iso);
      setMode("inspect");
      setMsg(created.campoEnabledAt
        ? `✓ ${created.iso} registrado y enviado a campo.`
        : `✓ ${created.iso} registrado — completa la ficha o envía a campo.`);
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
      if (field === "year") setYearErr("");
    } catch (e) {
      if (field === "year") setYearErr(e.message);
      else setError(e.message);
    }
  }

  async function addOption(kind, value) {
    const m = await api("/warehouse/options", { method: "POST", body: { kind, value } });
    setMeta(m);
    return value;
  }

  async function enableCampo() {
    if (!inspectIso) return;
    try {
      const next = await api(`/warehouse/units/${inspectIso}/enable-campo`, { method: "POST" });
      setUnit(next);
      setMsg(`✓ ${next.iso} enviado a campo.`);
      await loadPending();
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveActivity() {
    if (!inspectIso || !activity.conceptKey) return;
    try {
      const next = await api(`/warehouse/units/${inspectIso}/activity`, {
        method: "POST",
        body: { conceptKey: activity.conceptKey, note: activity.note },
      });
      setUnit(next);
      setActivity({ open: false, conceptKey: "", note: "" });
      setMsg("Actividad registrada.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function uploadDoc(file, concept, note) {
    if (!file || !inspectIso) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("concept", concept);
    fd.append("note", note || "");
    try {
      const next = await apiUpload(`/warehouse/units/${inspectIso}/documents`, fd);
      setUnit(next);
      setMsg("Documento adjunto.");
      return next;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }

  async function saveDocRows() {
    const pending = docRows.filter((r) => r.file);
    if (!pending.length) {
      setError("Selecciona al menos un archivo. Puedes agregar tantas filas como necesites.");
      return;
    }
    setError("");
    try {
      for (const row of pending) {
        await uploadDoc(row.file, row.concept, "");
      }
      setDocRows([newDocRow()]);
      setMsg(`${pending.length} documento(s) guardados. Puedes agregar más o editar el concepto.`);
    } catch {
      /* uploadDoc already set error */
    }
  }

  async function patchDocument(id, concept) {
    if (!inspectIso) return;
    try {
      const next = await api(`/warehouse/units/${inspectIso}/documents/${id}`, { method: "PATCH", body: { concept } });
      setUnit(next);
      setMsg("Concepto del documento actualizado.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeDocument(id) {
    if (!inspectIso || !window.confirm("¿Quitar este documento?")) return;
    try {
      const next = await api(`/warehouse/units/${inspectIso}/documents/${id}`, { method: "DELETE" });
      setUnit(next);
      setMsg("Documento eliminado.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function uploadCoordCapture(file) {
    if (!file || !inspectIso) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("note", capNote);
    try {
      const next = await apiUpload(`/warehouse/units/${inspectIso}/captures`, fd);
      setUnit(next);
      setCapNote("");
      setMsg("Imagen o video del coordinador guardado. También puedes cargarlo en las casillas 1–9.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveVisitFields() {
    if (!inspectIso) return;
    setError("");
    try {
      if (visitMode === "create" || !editingVisitId) {
        const row = await api("/gate-visits", { method: "POST", body: { ...visitForm, iso: inspectIso } });
        setEditingVisitId(row.id);
        setVisitMode("saved");
        setMsg("Visita registrada y vinculada a esta unidad. Puedes editarla.");
      } else {
        await api(`/gate-visits/${editingVisitId}`, { method: "PATCH", body: visitForm });
        if (!unit?.visit) {
          await api(`/gate-visits/${editingVisitId}/link`, { method: "POST", body: { iso: inspectIso } });
        }
        setVisitMode("saved");
        setMsg("Datos de la visita actualizados.");
      }
      const next = await api(`/warehouse/units/${inspectIso}`);
      setUnit(next);
      if (next.visit) setVisitForm(visitToForm(next.visit));
      await loadVisits();
    } catch (e) {
      setError(e.message);
    }
  }

  async function linkPickedVisit() {
    if (!inspectIso || !pickVisitId) return;
    setError("");
    try {
      const picked = visits.find((v) => v.id === pickVisitId);
      if (picked) setVisitForm(visitToForm(picked));
      await api(`/gate-visits/${pickVisitId}/link`, { method: "POST", body: { iso: inspectIso } });
      const next = await api(`/warehouse/units/${inspectIso}`);
      setUnit(next);
      setVisitForm(visitToForm(next.visit || picked));
      setEditingVisitId(pickVisitId);
      setVisitMode("saved");
      setMsg("Visita vinculada a esta unidad.");
      await loadVisits();
    } catch (e) {
      setError(e.message);
    }
  }

  async function unlinkVisit() {
    const id = unit?.visit?.id || editingVisitId;
    if (!id) return;
    try {
      await api(`/gate-visits/${id}/unlink`, { method: "POST" });
      const next = await api(`/warehouse/units/${inspectIso}`);
      setUnit(next);
      setVisitMode("pick");
      setMsg("Visita desvinculada. Puedes enlazar otra o cargar los datos tú.");
      await loadVisits();
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteVisit() {
    const id = unit?.visit?.id || editingVisitId || pickVisitId;
    if (!id || !window.confirm("¿Eliminar esta visita?")) return;
    try {
      await api(`/gate-visits/${id}`, { method: "DELETE" });
      const next = inspectIso ? await api(`/warehouse/units/${inspectIso}`) : null;
      if (next) setUnit(next);
      setVisitForm(EMPTY_VISIT);
      setVisitMode("pick");
      setEditingVisitId("");
      setPickVisitId("");
      setMsg("Visita eliminada.");
      await loadVisits();
    } catch (e) {
      setError(e.message);
    }
  }

  async function reviewVisitPhoto(approve) {
    const id = unit?.visit?.id;
    if (!id) return;
    try {
      await api(`/gate-visits/${id}/photo/${approve ? "approve" : "reject"}`, { method: "POST" });
      const next = await api(`/warehouse/units/${inspectIso}`);
      setUnit(next);
      setBust(Date.now());
      setMsg(approve ? "Foto de visita aprobada. Patio ya puede contrastarla." : "Foto de visita rechazada.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function uploadVisitPhoto(file) {
    const id = unit?.visit?.id;
    if (!file || !id) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await apiUpload(`/gate-visits/${id}/photo`, fd);
      const next = await api(`/warehouse/units/${inspectIso}`);
      setUnit(next);
      setBust(Date.now());
      setMsg("Foto de unidad cargada. Apruébala para que patio la vea.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function assignCapture(id, slot) {
    if (!inspectIso) return;
    setAssigning(true);
    try {
      const next = await api(`/warehouse/units/${inspectIso}/captures/${id}/assign`, { method: "POST", body: { slot } });
      setUnit(next);
      setPickedCap(null);
      setBust(Date.now());
      setMsg(next.assignWarning || "Toma asignada a la casilla del catálogo.");
    } catch (e) {
      setError(e.message);
    } finally {
      setAssigning(false);
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

  async function assignOdoo(attId, slot) {
    if (!inspectIso || slot === "" || slot == null) return;
    setAssigning(true);
    setError("");
    try {
      const next = await api(`/warehouse/units/${inspectIso}/odoo-photos/${attId}/assign`, {
        method: "POST",
        body: { slot },
      });
      setUnit(next);
      setBust(Date.now());
      setPickedAtt(null);
      setMsg(`Foto de Odoo asignada a la casilla ${Number(slot) + 1}. Queda para el catálogo web.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setAssigning(false);
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
        <p className="section-sub">{isCoord ? "ISO, tipo y depósito bastan. Año y fotos no son requisito para enviar a campo. El ISO 6346 no bloquea el alta." : "Escribe el ISO de la placa. El dígito de control no bloquea el alta."}</p>
        {error ? <div className="err">{error}</div> : null}
        <div className="form-grid">
          <div>
            <label>Código ISO *</label>
            <input
              className={`recv-iso ${isoHint?.kind === "warn" ? "iso-review-input" : ""}`}
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
        <button className="btn-primary recv-submit" type="button" style={{ marginTop: 12 }} onClick={submitNuevo} disabled={isoHint?.kind === "err"}>
          {custody ? "Registrar e inspeccionar" : "Registrar y enviar a campo"}
        </button>
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
            <h3 className="recv-iso-title">
              {unit.iso}{" "}
              <span className="badge-scope" style={{ background: unit.intakeType === "compra" ? "#2f9e44" : unit.intakeType === "almacenaje_cliente" ? "#495057" : "#c9720b" }}>{unit.intakeLabel}</span>
              <OriginBadges u={unit} />
            </h3>
            <p className="recv-who">{whoLine(unit)}</p>
            {unit.isoException ? (
              <div className="iso-review-banner">
                <b>ISO 6346 a revisar.</b> El serial vino de Odoo y no cumple el dígito de control o el formato. No bloqueó el alta.
                {unit.isoExceptionReason ? <span> {unit.isoExceptionReason}</span> : null}
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
            <p className="section-sub">
              {unit.campoEnabledAt
                ? `En campo desde ${formatWhen(unit.campoEnabledAt)}${unit.campoEnabledByName ? ` · ${unit.campoEnabledByName}` : ""}.`
                : "Aún no está en la lista de patio. Envíala a campo cuando el ISO y el depósito estén listos."}
            </p>
            {canCoord ? (
              <div className="visit-bind">
                <b>Visita de puerta</b>
                {unit.visit ? (
                  <p className="ok-msg" style={{ marginTop: 6 }}>
                    Vinculada a {unit.visit.tractorPlate} · {unit.visit.driverName || "sin conductor"}.
                  </p>
                ) : (
                  <p className="section-sub">Vincula una visita pendiente o carga tú los datos del tracto.</p>
                )}
                {visitMode === "pick" && !unit.visit ? (
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <div>
                      <label>Visita disponible</label>
                      <select value={pickVisitId} onChange={(e) => setPickVisitId(e.target.value)}>
                        <option value="">Elegir visita…</option>
                        {visits.filter((v) => !v.locked || v.containerIso === unit.iso).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.tractorPlate} · {v.driverName || "sin conductor"} · {v.motive}
                            {v.containerIso ? ` · ${v.containerIso}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="action-row" style={{ alignItems: "end" }}>
                      <button className="btn-primary" type="button" onClick={linkPickedVisit} disabled={!pickVisitId}>Vincular a esta unidad</button>
                      <button className="btn-ghost" type="button" onClick={() => { setVisitMode("create"); setVisitForm(EMPTY_VISIT); setEditingVisitId(""); }}>Cargar datos yo</button>
                    </div>
                  </div>
                ) : null}
                {visitMode !== "pick" || unit.visit ? (
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <div><label>Placa tracto</label><input value={visitForm.tractorPlate || unit.visit?.tractorPlate || ""} onChange={(e) => setVisitForm({ ...visitForm, tractorPlate: e.target.value.toUpperCase() })} /></div>
                    <div><label>Empresa</label><input value={visitForm.company || unit.visit?.company || ""} onChange={(e) => setVisitForm({ ...visitForm, company: e.target.value })} /></div>
                    <div><label>RUC</label><input value={visitForm.ruc || unit.visit?.ruc || ""} onChange={(e) => setVisitForm({ ...visitForm, ruc: e.target.value })} /></div>
                    <div><label>Conductor</label><input value={visitForm.driverName || unit.visit?.driverName || ""} onChange={(e) => setVisitForm({ ...visitForm, driverName: e.target.value })} /></div>
                    <div><label>Hora</label><input type="datetime-local" value={visitForm.visitAt || toLocalInput(unit.visit?.visitAt) || ""} onChange={(e) => setVisitForm({ ...visitForm, visitAt: e.target.value })} /></div>
                    <div><label>Brevete</label><input value={visitForm.license || unit.visit?.license || ""} onChange={(e) => setVisitForm({ ...visitForm, license: e.target.value })} /></div>
                    <div>
                      <label>Motivo</label>
                      <select value={visitForm.motive} onChange={(e) => setVisitForm({ ...visitForm, motive: e.target.value })}>
                        <option value="descargar">Descargar</option>
                        <option value="cargar">Cargar</option>
                      </select>
                    </div>
                    <div><label>Placa carreta</label><input value={visitForm.trailerPlate || unit.visit?.trailerPlate || ""} onChange={(e) => setVisitForm({ ...visitForm, trailerPlate: e.target.value.toUpperCase() })} /></div>
                    <div><label>Teléfono</label><input value={visitForm.phone || unit.visit?.phone || ""} onChange={(e) => setVisitForm({ ...visitForm, phone: e.target.value })} /></div>
                  </div>
                ) : null}
                <div className="action-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                  {visitMode !== "pick" || unit.visit ? (
                    <button className="btn-primary" type="button" onClick={saveVisitFields}>
                      {unit.visit ? "Guardar cambios de visita" : "Registrar y vincular"}
                    </button>
                  ) : null}
                  {unit.visit ? <button className="btn-ghost" type="button" onClick={unlinkVisit}>Desvincular</button> : null}
                  {(unit.visit || editingVisitId || pickVisitId) ? <button className="btn-ghost" type="button" onClick={deleteVisit}>Eliminar visita</button> : null}
                  {unit.visit || visitMode !== "pick" ? (
                    <button className="btn-ghost" type="button" onClick={() => { setVisitMode("pick"); setVisitForm(EMPTY_VISIT); }}>Elegir otra visita</button>
                  ) : null}
                </div>
                {unit.visit ? (
                  <div style={{ marginTop: 12 }}>
                    <label>Foto de la unidad (portería)</label>
                    <p className="section-sub">
                      {unit.visit.photoStatus === "approved"
                        ? "Aprobada: el personal de patio ya puede contrastarla."
                        : unit.visit.photoStatus === "pending"
                          ? "Pendiente de tu aprobación."
                          : unit.visit.photoStatus === "rejected"
                            ? "Rechazada. Puedes cargar otra y aprobarla."
                            : "Opcional. Si el chofer no la subió, puedes cargarla aquí."}
                    </p>
                    {unit.visit.hasPhoto ? (
                      <button
                        type="button"
                        className="visit-photo-btn"
                        onClick={() => lb.open([{
                          src: `${apiUrl(`/gate-visits/${unit.visit.id}/photo`)}?t=${bust}`,
                          type: "image",
                          label: "Foto de portería",
                        }])}
                      >
                        <img className="visit-photo-preview" src={`${apiUrl(`/gate-visits/${unit.visit.id}/photo`)}?t=${bust}`} alt="Unidad en visita" />
                      </button>
                    ) : null}
                    <div className="action-row">
                      <label className="btn-ghost">
                        {unit.visit.hasPhoto ? "Reemplazar foto" : "Cargar foto"}
                        <input type="file" accept="image/*" hidden onChange={(e) => { uploadVisitPhoto(e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                      {unit.visit.photoStatus === "pending" || unit.visit.photoStatus === "rejected" ? (
                        <button className="btn-primary" type="button" onClick={() => reviewVisitPhoto(true)}>Aprobar para patio</button>
                      ) : null}
                      {unit.visit.photoStatus === "pending" || unit.visit.photoStatus === "approved" ? (
                        <button className="btn-ghost" type="button" onClick={() => reviewVisitPhoto(false)}>Rechazar</button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {canCoord && (unit.captures || []).length ? (
              <div className="campo-caps">
                <b>Tomas de campo</b>
                <p className="section-sub">Elige una toma y asígnala a una casilla del catálogo.</p>
                <div className="odoo-assign-thumbs">
                  {(unit.captures || []).map((c, idx) => (
                    <div
                      key={c.id}
                      className={`odoo-assign-thumb ${pickedCap === c.id ? "on" : ""}`}
                    >
                      <button
                        type="button"
                        className="thumb-zoom"
                        onClick={() => lb.open(
                          (unit.captures || []).map((x) => ({
                            src: apiUrl(`/warehouse/units/${unit.iso}/captures/${x.id}`),
                            type: x.kind === "video" ? "video" : "image",
                            label: x.note || x.originalName || (x.kind === "video" ? "Video de campo" : "Toma de campo"),
                          })),
                          idx,
                        )}
                      >
                        {c.kind === "video" ? <span>Video</span> : <img src={apiUrl(`/warehouse/units/${unit.iso}/captures/${c.id}`)} alt={c.originalName} />}
                      </button>
                      <button
                        type="button"
                        className="thumb-pick"
                        onClick={() => setPickedCap(pickedCap === c.id ? null : c.id)}
                      >
                        {c.assignedSlot == null ? "Sin casilla · Elegir" : c.assignedSlot === 9 ? "Video 360 · Elegir" : `Casilla ${c.assignedSlot + 1} · Elegir`}
                      </button>
                    </div>
                  ))}
                </div>
                {pickedCap ? (
                  <div className="odoo-assign-slots">
                    {labels.map((lab, i) => (
                      <button key={lab} type="button" className="btn-ghost" disabled={assigning} onClick={() => assignCapture(pickedCap, i < 9 ? i : "video")}>
                        {i < 9 ? `${i + 1}. ${lab}` : lab}{i < 9 && unit.photos[i] ? " (reemplazar)" : ""}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="section-sub">El personal de campo también sube tomas. Aquí puedes cargar las tuyas y asignarlas a las casillas 1–9.</p>
            )}
            {canCoord ? (
              <>
                <div style={{ margin: "10px 0" }}>
                  <label>Nota de tu toma (opcional)</label>
                  <input value={capNote} onChange={(e) => setCapNote(e.target.value)} placeholder="Ej. foto de placa o daño al llegar" />
                  <label className="btn-ghost" style={{ display: "inline-block", marginTop: 8 }}>
                    + Foto o video del coordinador
                    <input type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => { uploadCoordCapture(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
                <div className="checklist recv-checklist">
                  {labels.map((lab, i) => {
                    const done = i < 9 ? unit.photos[i] : unit.hasVideo;
                    const slotItems = labels.map((name, idx) => {
                      if (idx < 9 && unit.photos[idx]) {
                        return {
                          src: `${apiUrl(`/warehouse/units/${unit.iso}/photos/${idx}`)}?t=${bust}`,
                          type: "image",
                          label: `${idx + 1}. ${name}`,
                        };
                      }
                      if (idx >= 9 && unit.hasVideo) {
                        return {
                          src: `${apiUrl(`/warehouse/units/${unit.iso}/photos/video`)}?t=${bust}`,
                          type: "video",
                          label: name,
                        };
                      }
                      return null;
                    }).filter(Boolean);
                    const openIdx = slotItems.findIndex((x) => x.label.startsWith(i < 9 ? `${i + 1}.` : lab) || (i >= 9 && x.type === "video"));
                    const fileInput = (
                      <input
                        type="file"
                        accept={i < 9 ? "image/*" : "video/*"}
                        capture="environment"
                        style={{ display: "none" }}
                        onChange={(e) => { uploadSlot(i < 9 ? i : "video", e.target.files?.[0]); e.target.value = ""; }}
                      />
                    );
                    const copy = (
                      <>
                        <span className="n">{i < 9 ? i + 1 : "▶"}</span>
                        {lab}{done ? " ✓" : ""}
                        {done ? <small> · Cambiar</small> : null}
                      </>
                    );
                    if (done) {
                      return (
                        <div key={lab} className="check-item done">
                          <button
                            type="button"
                            className="check-open"
                            onClick={() => lb.open(slotItems, Math.max(0, openIdx))}
                          >
                            {i < 9 ? (
                              <img className="check-thumb" src={`${apiUrl(`/warehouse/units/${unit.iso}/photos/${i}`)}?t=${bust}`} alt={lab} />
                            ) : null}
                          </button>
                          <label className="check-copy">
                            {fileInput}
                            {copy}
                          </label>
                        </div>
                      );
                    }
                    return (
                      <label key={lab} className="check-item">
                        {fileInput}
                        <span className="check-copy">{copy}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : null}
            <div className="recv-services">
              <button className="btn-ghost" type="button" onClick={() => setActivity({ open: true, conceptKey: meta.costConcepts?.[0]?.key || "", note: "" })}>Registrar actividad</button>
            </div>
            {activity.open ? (
              <div className="archive-box" style={{ marginTop: 10 }}>
                <b>Registrar actividad de patio</b>
                <select value={activity.conceptKey} onChange={(e) => setActivity({ ...activity, conceptKey: e.target.value })}>
                  {(meta.costConcepts || []).map((c) => (
                    <option key={c.key} value={c.key}>{c.label}{c.amount != null ? ` — $${c.amount}` : ""}</option>
                  ))}
                </select>
                <textarea rows={2} placeholder="Observación (ej. lavado por salitre)" value={activity.note} onChange={(e) => setActivity({ ...activity, note: e.target.value })} />
                <div className="action-row">
                  <button className="btn-primary" type="button" onClick={saveActivity}>Guardar</button>
                  <button className="btn-ghost" type="button" onClick={() => setActivity({ open: false, conceptKey: "", note: "" })}>Cancelar</button>
                </div>
              </div>
            ) : null}
            {(unit.depotCosts || []).length ? (
              <ul className="cost-hist">
                {unit.depotCosts.map((c) => (
                  <li key={c.id}>
                    {c.conceptLabel}{c.auto ? " (auto)" : ""}{c.note ? ` — ${c.note}` : ""}
                    {c.amount != null ? ` · $${c.amount}` : ""}
                    <small> · {c.createdByName} · {formatWhen(c.createdAt)}</small>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="panel">
            <h3>Datos físicos de la unidad</h3>
            <p className="section-sub">
              {unit.intakeOrigin === "odoo"
                ? "Completa o corrige la ficha. Los ids de Odoo no se muestran aquí."
                : "Ficha recíproca a Odoo: tara, peso, color, DUA, procedencia, material, año y fabricante."}
            </p>
            {canSeeOdoo && (unit.odooSource || unit.odooLocation || unit.odooDua || unit.originCountry) ? (
              <div className="odoo-source">
                <b>Datos Odoo (solicitante)</b>
                <p className="section-sub">Originales de Odoo. No bloquean. Quedan pendientes si ZDRY aún no los tiene.</p>
                <dl>
                  {unit.odooSource?.serialRaw ? <><dt>Serial</dt><dd>{unit.odooSource.serialRaw}</dd></> : null}
                  {unit.odooSource?.productName || unit.odooSource?.productCode ? (
                    <><dt>Producto</dt><dd>{unit.odooSource.productCode ? `[${unit.odooSource.productCode}] ` : ""}{unit.odooSource.productName}</dd></>
                  ) : null}
                  <dt>Ubicación</dt><dd>{unit.odooSource?.locationName || unit.odooLocation || "—"}</dd>
                  <dt>Color</dt><dd>{unit.odooSource?.color || "—"}</dd>
                  <dt>Tara</dt><dd>{unit.odooSource?.tareKg ?? "—"}</dd>
                  <dt>Peso</dt><dd>{unit.odooSource?.mgwKg ?? "—"}</dd>
                  <dt>Año</dt><dd>{unit.odooSource?.year ?? "—"}</dd>
                  <dt>Fabricante</dt><dd>{unit.odooSource?.manufacturer || "—"}</dd>
                  <dt>DUA</dt><dd>{unit.odooSource?.dua || unit.odooDua || "—"}</dd>
                  <dt>Procedencia</dt><dd>{unit.odooSource?.originCountry || unit.originCountry || "—"}</dd>
                  {unit.odooSource?.material ? <><dt>Material</dt><dd>{unit.odooSource.material}</dd></> : null}
                </dl>
              </div>
            ) : null}
            <div className="form-grid">
              <div><label>Tara (kg)</label><input type="number" defaultValue={unit.tareKg} key={`tare-${unit.tareKg}`} onBlur={(e) => patchField("tareKg", e.target.value)} /></div>
              <div><label>Peso bruto máx. (kg)</label><input type="number" defaultValue={unit.mgwKg} key={`mgw-${unit.mgwKg}`} onBlur={(e) => patchField("mgwKg", e.target.value)} /></div>
              <div>
                <label>Color exterior</label>
                <SearchCreate
                  options={meta.colors}
                  value={!unit.color || unit.color === "—" ? "" : unit.color}
                  onChange={(v) => patchField("color", v)}
                  onCreate={(v) => addOption("color", v)}
                  placeholder="Buscar o crear color"
                />
              </div>
              <div>
                <label>Condición comercial</label>
                <select value={unit.cat} onChange={(e) => patchField("cat", e.target.value)}>
                  {meta.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label>Año ({meta.yearMin || 1980}–{meta.yearMax || new Date().getFullYear()})</label>
                <input
                  type="number"
                  min={meta.yearMin || 1980}
                  max={meta.yearMax || new Date().getFullYear()}
                  defaultValue={unit.year || ""}
                  key={`year-${unit.year || "x"}`}
                  onBlur={(e) => patchField("year", e.target.value === "" ? null : Number(e.target.value))}
                />
                {yearErr ? <div className="err" style={{ marginTop: 4 }}>{yearErr}</div> : null}
              </div>
              <div>
                <label>Fabricante</label>
                <SearchCreate
                  options={meta.manufacturers}
                  value={!unit.manufacturer || unit.manufacturer === "—" ? "" : unit.manufacturer}
                  onChange={(v) => patchField("manufacturer", v)}
                  onCreate={(v) => addOption("manufacturer", v)}
                  placeholder="Buscar o crear fabricante"
                />
              </div>
              <div><label>DUA</label><input defaultValue={unit.odooDua || ""} key={`dua-${unit.odooDua || ""}`} onBlur={(e) => patchField("odooDua", e.target.value)} /></div>
              <div><label>Procedencia</label><input defaultValue={unit.originCountry || ""} key={`orig-${unit.originCountry || ""}`} onBlur={(e) => patchField("originCountry", e.target.value)} /></div>
              <div><label>Material</label><input defaultValue={unit.material || ""} key={`mat-${unit.material || ""}`} onBlur={(e) => patchField("material", e.target.value)} /></div>
            </div>
            {missing.length ? (
              <p style={{ fontSize: 11, color: "#c9720b", marginTop: 6, fontWeight: 700 }}>
                ⚠ {missing.join(" · ")} — no bloquea el envío a campo.
              </p>
            ) : (
              <p style={{ fontSize: 11, color: "#2f9e44", marginTop: 6, fontWeight: 700 }}>✓ Ficha con año y fabricante</p>
            )}
            <div className="cost-line" style={{ marginTop: 12 }}><span>Depósito y posición actual</span><b>{unit.depotName} — {unit.posLabel}</b></div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase" }}>Notas</label>
              <textarea
                rows={3}
                style={{ width: "100%", marginTop: 6, padding: "9px 10px", border: "1px solid var(--line)", borderRadius: 7, fontFamily: "inherit" }}
                defaultValue={unit.inspectionNotes}
                key={`notes-${unit.iso}`}
                onBlur={(e) => patchField("inspectionNotes", e.target.value)}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <b>Documentos de la unidad</b>
              <p className="section-sub">Puedes adjuntar varios. El concepto es editable. No salen al catálogo público.</p>
              {(unit.documents || []).map((d) => (
                <div key={d.id} className="doc-saved">
                  <div>
                    <label>Concepto</label>
                    <input
                      defaultValue={d.conceptLabel}
                      key={`${d.id}-${d.conceptLabel}`}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value.trim() !== d.conceptLabel) {
                          patchDocument(d.id, e.target.value);
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label>Archivo</label>
                    <div className="file-field">
                      <a className="file-field-name" href={apiUrl(`/warehouse/units/${unit.iso}/documents/${d.id}`)} target="_blank" rel="noreferrer">{d.originalName}</a>
                      <button className="btn-ghost" type="button" onClick={() => removeDocument(d.id)}>Quitar</button>
                    </div>
                  </div>
                </div>
              ))}
              {docRows.map((row, idx) => (
                <div key={row.key} className="doc-card">
                  <div className="form-grid" style={{ marginBottom: 0 }}>
                    <div>
                      <label>Concepto</label>
                      <SearchCreate
                        options={meta.documentConceptLabels || (meta.documentConcepts || []).map((d) => d.label)}
                        value={row.concept}
                        onChange={(v) => setDocRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, concept: v } : r)))}
                        onCreate={async (v) => {
                          const m = await addOption("document", v);
                          setDocRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, concept: v } : r)));
                          return m;
                        }}
                        placeholder="Buscar o crear concepto"
                      />
                    </div>
                    <div>
                      <label>Archivo</label>
                      <div className="file-field">
                        <span className="file-field-name">{row.file?.name || "Ningún archivo seleccionado"}</span>
                        <label className="btn-ghost">
                          Elegir archivo
                          <input
                            type="file"
                            accept="application/pdf,image/*"
                            hidden
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              setDocRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, file } : r)));
                            }}
                          />
                        </label>
                        {docRows.length > 1 ? (
                          <button className="btn-ghost" type="button" onClick={() => setDocRows((rows) => rows.filter((_, i) => i !== idx))}>Quitar</button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="action-row" style={{ marginTop: 10 }}>
                <button className="btn-ghost" type="button" onClick={() => setDocRows((rows) => [...rows, newDocRow()])}>+ Otro documento</button>
                <button className="btn-primary" type="button" onClick={saveDocRows}>Guardar documentos</button>
              </div>
            </div>
          </div>
        </div>
        {canCoord && (unit.intakeOrigin === "odoo" || unit.hasOdooChatter) ? (
          <div className="panel odoo-web-photos">
            <h3>Fotos de Odoo (catálogo web)</h3>
            <p className="section-sub">
              Elige una foto y asígnala a una casilla, o toma otra con la cámara. Estas imágenes quedan para la venta en la web.
            </p>
            {!odooPhotos.length ? (
              <p className="section-sub">Este lote no trajo fotos de Odoo, o el chatter no las devolvió.</p>
            ) : (
              <>
                <div className="odoo-assign-thumbs">
                  {odooPhotos.map((p, idx) => (
                    <div
                      key={p.id}
                      className={`odoo-assign-thumb ${pickedAtt === p.id ? "on" : ""}`}
                    >
                      <button
                        type="button"
                        className="thumb-zoom"
                        onClick={() => lb.open(
                          odooPhotos.map((x) => ({
                            src: apiUrl(`/warehouse/units/${unit.iso}/odoo-photos/${x.id}`),
                            type: "image",
                            label: x.name,
                          })),
                          idx,
                        )}
                      >
                        <img src={apiUrl(`/warehouse/units/${unit.iso}/odoo-photos/${p.id}`)} alt={p.name} />
                      </button>
                      <button
                        type="button"
                        className="thumb-pick"
                        onClick={() => setPickedAtt(pickedAtt === p.id ? null : p.id)}
                      >
                        {p.name} · Elegir
                      </button>
                    </div>
                  ))}
                </div>
                {pickedAtt ? (
                  <div className="odoo-assign-slots">
                    <b>Asignar a casilla</b>
                    {labels.slice(0, 9).map((lab, i) => (
                      <button
                        key={lab}
                        type="button"
                        className="btn-ghost"
                        disabled={assigning}
                        onClick={() => assignOdoo(pickedAtt, i)}
                      >
                        {i + 1}. {lab}{unit.photos[i] ? " (reemplazar)" : ""}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="section-sub">Toca la imagen para verla en detalle. Pulsa «Elegir» y luego la casilla donde debe quedar.</p>
                )}
              </>
            )}
          </div>
        ) : null}
        <div className="recv-confirm-bar">
          {!unit.campoEnabledAt ? (
            <button className="btn-primary" type="button" onClick={enableCampo}>Enviar a campo</button>
          ) : (
            <p className="recv-confirm-hint">Ya está en la lista de Patio — campo. La posición en layout es opcional.</p>
          )}
          {user.role === "admin" ? (
            <button className="btn-ghost" type="button" style={{ marginTop: 8 }} onClick={confirm}>Confirmar recepción → Patio</button>
          ) : null}
          <p className="recv-confirm-hint">Año, fabricante y fotos no son requisito para habilitar campo.</p>
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
        {lb.node}
      </>
    );
  }

  const intakeColor = (t) => (t === "compra" ? "#2f9e44" : t === "almacenaje_cliente" ? "#495057" : "#c9720b");

  return (
    <div className="panel recv-page">
      <h3>Recepción e inspección</h3>
      <p className="section-sub">
        {canSeeOdoo
          ? <>Elige un pendiente, registra una reentrega o envía a campo un asimilado Odoo.{" "}
            <Link to="/app/almacen/odoo" style={{ color: "var(--orange)", fontWeight: 700 }}>Bandeja Odoo</Link></>
          : <>Alta mínima, ficha, visitas de puerta, documentos e imágenes. También en{" "}
            <Link to="/app/almacen/visitas" style={{ color: "var(--orange)", fontWeight: 700 }}>Visitas</Link>.</>}
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <div className="recv-actions">
        <button className="btn-ghost" type="button" onClick={() => { setForm({ ...form, category: "pendiente_factura", iso: "" }); setMode("nuevo"); setError(""); }}>
          <span className="recv-full">+ Nuevo ingreso — compra sin factura (reentrega)</span>
          <span className="recv-short">+ Compra sin factura</span>
        </button>
        {canSeeOdoo ? (
          <>
        <button className="btn-ghost" type="button" onClick={() => { setForm({ ...form, category: "almacenaje_cliente", iso: "" }); setMode("nuevo"); setError(""); }}>
          <span className="recv-full">+ Nuevo ingreso — almacenaje de cliente tercero</span>
          <span className="recv-short">+ Almacenaje de cliente</span>
        </button>
        <button className="btn-ghost" type="button" onClick={() => setMode("devolucion")}>
          <span className="recv-full">↩ Registrar devolución de alquiler</span>
          <span className="recv-short">↩ Devolución alquiler</span>
        </button>
          </>
        ) : null}
      </div>
      {pending.length ? (
        <>
          <h3 style={{ marginTop: 0 }}>
            Pendientes ({filteredPending.length}{pendingQ.trim() ? ` de ${pending.length}` : ""})
          </h3>
          <p className="section-sub">Toca una unidad para continuar la inspección. Se listan de {PAGE_SIZE} en {PAGE_SIZE}.</p>
          <div className="odoo-toolbar">
            <input
              className="odoo-search"
              type="search"
              value={pendingQ}
              onChange={(e) => setPendingQ(e.target.value)}
              placeholder="Buscar ISO, tipo, depósito, origen o quien registró…"
              aria-label="Buscar pendientes"
            />
          </div>
          {pagePending.length ? (
            <>
          <div className="tablewrap recv-table">
            <table className="data">
              <thead>
                <tr><th>ISO</th><th>Tipo</th><th>Condición</th><th>Depósito</th><th>Origen</th><th>Registró</th><th>Motivo pendiente</th></tr>
              </thead>
              <tbody>
                {pagePending.map((u) => (
                  <tr key={u.iso} className={`expandable ${u.isoException ? "iso-review-row" : ""}`} onClick={() => { if (archiving !== u.iso) { setInspectIso(u.iso); setMode("inspect"); setError(""); } }}>
                    <td onClick={(e) => { if (archiving === u.iso) e.stopPropagation(); }}>
                      <div className="recv-iso-cell">
                        <div className="recv-iso-row">
                          <b>{u.iso}</b>
                          <ArchiveIconBtn onClick={() => setArchiving((cur) => (cur === u.iso ? null : u.iso))} />
                          <OriginBadges u={u} />
                        </div>
                        {archiving === u.iso ? (
                          <ArchiveForm
                            iso={u.iso}
                            onDone={(iso) => { setArchiving(null); setMsg(`${iso} archivado.`); loadPending(); }}
                            onCancel={() => setArchiving(null)}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td>{u.typeLabel}</td>
                    <td style={{ color: u.catColor }}>{u.catLabel}</td>
                    <td>{u.depotName}</td>
                    <td><span className="badge-scope" style={{ background: intakeColor(u.intakeType) }}>{u.intakeLabel}</span></td>
                    <td className="recv-who">{u.registeredByName || "—"}<br />{formatWhen(u.createdAt)}</td>
                    <td>{u.missing.map((r) => <span key={r} className="badge-scope" style={{ background: "#c9720b", marginRight: 4 }}>{r}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="recv-cards">
            {pagePending.map((u) => (
              <div key={u.iso} className={`recv-card ${u.isoException ? "iso-review-row" : ""}`}>
                <div className="recv-card-top">
                  <span className="recv-iso-row">
                    <button
                      type="button"
                      className="recv-card-open"
                      onClick={() => { setInspectIso(u.iso); setMode("inspect"); setError(""); }}
                    >
                      <b className="card-iso">{u.iso}</b>
                    </button>
                    <ArchiveIconBtn onClick={() => setArchiving((cur) => (cur === u.iso ? null : u.iso))} />
                  </span>
                  <span className="badge-scope" style={{ background: intakeColor(u.intakeType) }}>{u.intakeLabel}</span>
                  <OriginBadges u={u} />
                </div>
                <button
                  type="button"
                  className="recv-card-open"
                  onClick={() => { setInspectIso(u.iso); setMode("inspect"); setError(""); }}
                >
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
                ) : null}
              </div>
            ))}
          </div>
          {pendingPages > 1 ? (
            <div className="odoo-pager">
              <button className="btn-ghost" type="button" disabled={safePendingPage <= 1} onClick={() => setPendingPage(safePendingPage - 1)}>Anterior</button>
              <span>Página {safePendingPage} / {pendingPages}</span>
              <button className="btn-ghost" type="button" disabled={safePendingPage >= pendingPages} onClick={() => setPendingPage(safePendingPage + 1)}>Siguiente</button>
            </div>
          ) : null}
            </>
          ) : (
            <p className="section-sub">Ningún pendiente coincide con la búsqueda.</p>
          )}
        </>
      ) : (
        <p style={{ color: "#2f9e44", fontWeight: 700 }}>✓ No hay contenedores pendientes de inspección física ni con datos faltantes.</p>
      )}
      {lb.node}
    </div>
  );
}
