import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiBlob, apiUpload, apiUrl, formatWhen, publicUrl } from "../api.js";
import { hasRole, isSuperadmin, useAuth } from "../auth.jsx";
import { localPhone, PeruPhone } from "../peru-phone.jsx";
import { useLightbox } from "../media-lightbox.jsx";
import { downloadVisitPdf, statusLabel } from "../visit-ticket.js";

const STATUSES = [
  ["REGISTRADO", "REGISTRADO", "#2f9e44"],
  ["EN ATENCION", "EN ATENCIÓN", "#1c7ed6"],
  ["FINALIZADO", "FINALIZADO", "#e0a100"],
  ["CANCELADO", "CANCELADO", "#8d5524"],
  ["ANULADO", "ANULADO", "#5c6370"],
];

function pill(status) {
  const hit = STATUSES.find((item) => item[0] === status);
  return { label: hit ? hit[1] : statusLabel(status), color: hit ? hit[2] : "#5c6370" };
}

const STAGE_FLOW = [
  ["REGISTRADO", "Registrado"],
  ["EN ATENCION", "En atención"],
  ["FINALIZADO", "Finalizado"],
];

function StageTrack({ status, events }) {
  const stopped = status === "CANCELADO" || status === "ANULADO";
  const left = stopped
    ? [...(events || [])].reverse().find((event) => event.toStatus === status)?.fromStatus || "REGISTRADO"
    : status;
  const at = Math.max(0, STAGE_FLOW.findIndex(([key]) => key === left));
  const steps = stopped ? [...STAGE_FLOW.slice(0, at + 1), [status, statusLabel(status)]] : STAGE_FLOW;
  return (
    <ol className="drv-stage">
      {steps.map(([key, label], index) => {
        const current = index === (stopped ? steps.length - 1 : at);
        const mark = current ? (stopped ? "now stop" : "now") : index < at || stopped ? "done" : "";
        return <li key={`${key}-${index}`} className={mark}><i /><span>{label}</span></li>;
      })}
    </ol>
  );
}

function RegSection({ icon, title, children }) {
  return (
    <section className="reg-section">
      <h3>{icon}<span>{title}</span></h3>
      <div className="reg-grid">{children}</div>
    </section>
  );
}

function noteTitle(note) {
  if (note.kind === "ubicacion") return "Ubicación";
  if (note.kind === "confirmacion") return "Confirmación";
  if (note.kind === "registro") return "Aviso de registro";
  return "Mensaje de WhatsApp";
}

function isoNote(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  return /^[A-Z]{4}\d{7}$/.test(compact) ? "" : "No cumple la norma ISO. Se puede guardar igual.";
}

export default function Visitas() {
  const { user } = useAuth();
  const lb = useLightbox();
  const [params] = useSearchParams();
  const focusId = params.get("visita") || "";
  const manage = hasRole(user, "admin", "coordinador");
  const canRestorePhoto = hasRole(user, "admin");
  const superuser = isSuperadmin(user);
  const [view, setView] = useState("ingresos");
  const [menuTab, setMenuTab] = useState("sedes");
  const [status, setStatus] = useState("REGISTRADO");
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [masters, setMasters] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [sendConfirm, setSendConfirm] = useState(false);
  const [placeId, setPlaceId] = useState("");
  const [sure, setSure] = useState(null);
  const [noticeModal, setNoticeModal] = useState(null);
  const seenAlerts = useRef(new Set());
  const [moreNotices, setMoreNotices] = useState(false);
  const [openNote, setOpenNote] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editOptions, setEditOptions] = useState({ sites: [], motives: [] });
  const [edit, setEdit] = useState(null);
  const [savingForm, setSavingForm] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [motiveName, setMotiveName] = useState("");
  const [asksDetail, setAsksDetail] = useState(false);
  const [mailDraft, setMailDraft] = useState({});
  const [phoneDraft, setPhoneDraft] = useState({});
  const [editDest, setEditDest] = useState(null);
  const [warehouse, setWarehouse] = useState({ siteId: "", name: "", mapUrl: "" });
  const [reply, setReply] = useState({ siteId: "", phone: "" });
  const [confirmText, setConfirmText] = useState("");
  const [locationText, setLocationText] = useState("");
  const [query, setQuery] = useState("");
  const [report, setReport] = useState(null);
  const [importing, setImporting] = useState(false);
  const [testing, setTesting] = useState("");
  const [testReport, setTestReport] = useState(null);

  async function load(next = status) {
    const list = await api(`/gate-visits?status=${encodeURIComponent(next)}`);
    setRows(list);
    return list;
  }

  async function open(id) {
    const detail = await api(`/gate-visits/${id}`);
    setSelected(detail);
    setFormOpen(false);
    setSendConfirm(false);
    setMoreNotices(false);
    setOpenNote(null);
    return detail;
  }

  async function loadMasters() {
    const data = await api("/gate-visits/masters");
    setMasters(data);
    setConfirmText(data.confirmTemplate || "");
    setLocationText(data.locationTemplate || "");
    const first = data.sites?.[0]?.id || "";
    setWarehouse((current) => ({ ...current, siteId: current.siteId || first }));
    setReply((current) => {
      const siteId = current.siteId || first;
      const site = (data.sites || []).find((item) => item.id === siteId) || data.sites?.[0];
      return { siteId: site?.id || "", phone: localPhone(site?.replyPhone) };
    });
  }

  async function addMail(siteId) {
    const destination = String(mailDraft[siteId] || "").trim();
    setError("");
    try {
      await api("/gate-visits/recipients", { method: "POST", body: { siteId, kind: "correo", destination } });
      setMailDraft((current) => ({ ...current, [siteId]: "" }));
      setMsg("Correo agregado. Recibirá el aviso cuando un conductor se registre.");
      await loadMasters();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addPhone(siteId) {
    const local = localPhone(phoneDraft[siteId] || "");
    setError("");
    if (local.length !== 9) {
      setError("El WhatsApp son 9 dígitos después del 51.");
      return;
    }
    try {
      await api("/gate-visits/recipients", { method: "POST", body: { siteId, kind: "whatsapp", destination: `51${local}` } });
      setPhoneDraft((current) => ({ ...current, [siteId]: "" }));
      setMsg("WhatsApp agregado. Recibirá el aviso cuando un conductor se registre.");
      await loadMasters();
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveDest() {
    if (!editDest) return;
    setError("");
    const local = localPhone(editDest.value);
    if (editDest.kind === "whatsapp" && local.length !== 9) {
      setError("El WhatsApp son 9 dígitos después del 51.");
      return;
    }
    const destination = editDest.kind === "whatsapp" ? `51${local}` : String(editDest.value || "").trim();
    try {
      await api(`/gate-visits/recipients/${editDest.id}`, { method: "PATCH", body: { destination } });
      const kind = editDest.kind;
      setEditDest(null);
      setMsg(kind === "whatsapp" ? "WhatsApp actualizado." : "Correo actualizado.");
      await loadMasters();
    } catch (e) {
      setError(e.message);
    }
  }

  async function testSite(siteId) {
    setError("");
    setTesting(siteId);
    try {
      const result = await api(`/gate-visits/sites/${siteId}/test`, { method: "POST" });
      setTestReport({ siteId, ...result });
      setMsg(result.ok ? "La prueba quedó en cola." : "La prueba no salió completa. Revisa el detalle de la sede.");
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting("");
    }
  }

  function pickReplySite(siteId) {
    const site = (masters?.sites || []).find((item) => item.id === siteId);
    setReply({ siteId, phone: localPhone(site?.replyPhone) });
  }

  async function saveReply() {
    setError("");
    const local = localPhone(reply.phone);
    if (!reply.siteId) {
      setError("Selecciona la sede.");
      return;
    }
    if (local.length !== 9) {
      setError("El WhatsApp de respuesta son 9 dígitos después del 51.");
      return;
    }
    try {
      await api(`/gate-visits/sites/${reply.siteId}`, { method: "PATCH", body: { replyPhone: `51${local}` } });
      setMsg("Número de respuesta guardado.");
      await loadMasters();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeVisit() {
    if (!selected || !window.confirm(`¿Eliminar el ingreso de ${selected.driverName || selected.tractorPlate}?`)) return;
    setError("");
    try {
      await api(`/gate-visits/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setMsg("Ingreso eliminado.");
      await load(status);
    } catch (e) {
      setError(e.message);
    }
  }

  async function resetModule() {
    if (!window.confirm("Se borrarán todos los ingresos de conductores. Las sedes, motivos, correos y almacenes se mantienen.")) return;
    setError("");
    try {
      const result = await api("/gate-visits/reset", { method: "POST" });
      setSelected(null);
      setRows([]);
      setStatus("REGISTRADO");
      setView("ingresos");
      setMsg(`Módulo reiniciado. Se eliminaron ${result.removed} ingresos.`);
      await load("REGISTRADO");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load(focusId ? "" : "REGISTRADO").catch((e) => setError(e.message));
    if (focusId) {
      api("/gate-visits?filter=all").then(async (list) => {
        setRows(list);
        if (list.some((row) => row.id === focusId)) await open(focusId);
      }).catch((e) => setError(e.message));
    }
  }, [focusId]);

  useEffect(() => {
    if (view !== "ingresos" || !manage) return undefined;
    const tick = () => {
      api("/gate-visits/salida-sync", { method: "POST" }).then(async (result) => {
        const late = (result.alerts || []).find((item) => !seenAlerts.current.has(item.id));
        if (late) {
          seenAlerts.current.add(late.id);
          setNoticeModal({ title: "Mensaje no enviado", text: late.text });
        }
        setSelected((current) => {
          if (!current?.id) return current;
          api(`/gate-visits/${current.id}`).then((detail) => {
            setSelected(detail);
            const note = (detail.notices || []).find((item) => item.status === "sin_enviar" && !seenAlerts.current.has(item.id));
            if (note) {
              seenAlerts.current.add(note.id);
              setNoticeModal({ title: "Mensaje no enviado", text: note.detail || "No se llegó a enviar el mensaje." });
            }
          }).catch(() => {});
          return current;
        });
      }).catch(() => {});
    };
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [view, manage]);

  async function changeStatus(next, withConfirm = false) {
    if (!selected) return;
    setError("");
    try {
      const detail = await api(`/gate-visits/${selected.id}/status`, {
        method: "POST",
        body: { status: next, sendConfirm: next === "EN ATENCION" && withConfirm },
      });
      setSelected(detail);
      setMsg(next === "EN ATENCION" && withConfirm ? "Pasó a EN ATENCIÓN y la confirmación quedó en la cola." : "Estado actualizado.");
      await load(status);
    } catch (e) {
      setError(e.message);
      setNoticeModal({ title: "WhatsApp del conductor", text: e.message });
      api(`/gate-visits/${selected.id}`).then(setSelected).catch(() => {});
    }
  }

  function askStatus(next) {
    if (next === "EN ATENCION" && sendConfirm && selected?.status !== "EN ATENCION") {
      setSure({
        title: "Pasar a en atención",
        text: `¿Estás seguro de pasar a EN ATENCIÓN y enviar la confirmación a ${selected.driverName || "el transportista"}?`,
        run: () => changeStatus(next, true),
      });
      return;
    }
    changeStatus(next, false);
  }

  function askConfirm() {
    if (selected?.status !== "EN ATENCION") {
      setError("La confirmación se envía cuando el ingreso está en atención.");
      return;
    }
    setSure({
      title: "Enviar confirmación",
      text: `¿Estás seguro de enviar la confirmación a ${selected.driverName || "el transportista"}?`,
      run: () => sendDriver("confirmacion"),
    });
  }

  function askPlace() {
    if (selected?.status !== "EN ATENCION") {
      setError("La ubicación se envía cuando el ingreso está en atención.");
      return;
    }
    const place = (selected.warehouses || []).find((item) => item.id === placeId);
    if (!place) {
      setError("Elige el almacén al que irá el conductor.");
      return;
    }
    setSure({
      title: "Enviar ubicación",
      text: `¿Estás seguro de enviar la ubicación de ${place.siteName ? `${place.siteName} · ` : ""}${place.name} al transportista?`,
      run: () => sendDriver("ubicacion", place.id),
    });
  }

  async function openForm() {
    if (!selected) return;
    setError("");
    try {
      const options = await api("/gate-visits/public/options");
      const sites = options.sites || [];
      const motives = options.motives || [];
      const site = sites.find((item) => item.id === selected.siteId) || sites.find((item) => item.name === selected.siteName);
      const motive = motives.find((item) => item.name.toLowerCase() === String(selected.motive || "").toLowerCase());
      setEditOptions({ sites, motives });
      setEdit({
        siteId: site?.id || "",
        motiveId: motive?.id || "",
        motiveDetail: selected.motiveDetail || "",
        company: selected.company || "",
        ruc: selected.ruc || "",
        driverName: selected.driverName || "",
        license: selected.license || "",
        phone: localPhone(selected.phone),
        tractorPlate: selected.tractorPlate || "",
        trailerPlate: selected.trailerPlate || "",
        equipmentCode: selected.equipmentCode || "",
        observations: selected.observations || "",
      });
      setFormOpen(true);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!selected || !edit || !manage) return;
    setSavingForm(true);
    setError("");
    try {
      const motive = editOptions.motives.find((item) => item.id === edit.motiveId);
      const detail = await api(`/gate-visits/${selected.id}`, {
        method: "PATCH",
        body: {
          ...edit,
          motive: motive?.name || selected.motive,
          phone: localPhone(edit.phone),
          siteId: edit.siteId || undefined,
        },
      });
      setSelected(detail);
      setFormOpen(false);
      setMsg("Registro actualizado.");
      await load(status);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingForm(false);
    }
  }

  async function sendDriver(kind, warehouseId) {
    setError("");
    if (kind === "ubicacion" && !warehouseId) {
      setError("Elige el almacén al que irá el conductor.");
      return;
    }
    try {
      const detail = await api(`/gate-visits/${selected.id}/driver`, { method: "POST", body: { kind, warehouseId } });
      setSelected(detail);
      const last = (detail.notices || [])[0];
      if (last?.status === "ya_enviado") {
        const text = last.detail || "Ese envío ya salió.";
        setMsg(text);
        setNoticeModal({ title: "WhatsApp del conductor", text });
        return;
      }
      if (last?.status === "en_espera" || (last && last.status !== "en_cola")) {
        const text = last.detail || "Ese número todavía tiene un mensaje sin salir. No se cargó otro.";
        setError(text);
        setNoticeModal({ title: "WhatsApp del conductor", text });
        return;
      }
      const place = (detail.warehouses || []).find((item) => item.id === warehouseId);
      setMsg(kind === "ubicacion"
        ? `La ubicación de ${place?.name || "el almacén"} quedó en la cola. El transportista la recibe cuando WhatsApp la envía.`
        : "La confirmación quedó en la cola. El conductor la recibe cuando WhatsApp la envía.");
    } catch (e) {
      setError(e.message);
      setNoticeModal({ title: "WhatsApp del conductor", text: e.message });
    }
  }
    setError("");
    try {
      await api(`/gate-visits/${selected.id}/photo/archive`, { method: "POST" });
      setMsg("Foto archivada. El vigilante ya no la ve.");
      await open(selected.id);
    } catch (e) {
      setError(e.message);
    }
  }

  async function restorePhoto() {
    setError("");
    try {
      await api(`/gate-visits/${selected.id}/photo/restore`, { method: "POST" });
      setMsg("Foto visible de nuevo.");
      await open(selected.id);
    } catch (e) {
      setError(e.message);
    }
  }

  async function downloadTemplate() {
    setError("");
    try {
      const blob = await apiBlob("/gate-visits/template");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "plantilla-registro-conductores.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }

  async function uploadExcel(file) {
    if (!file) return;
    setError("");
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await apiUpload("/gate-visits/import", fd);
      setReport(result);
      setMsg(`Asimilación lista: ${result.created} nuevos, ${result.filled} completados, ${result.skipped?.length || 0} omitidos.`);
      await load(status);
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  const qr = `${window.location.origin}${publicUrl("/visita")}`;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((row) => [row.publicCode, row.driverName, row.tractorPlate, row.trailerPlate, row.company, row.siteName, row.motive]
      .some((value) => String(value || "").toLowerCase().includes(needle)))
    : rows;

  return (
    <div className="panel">
      <div className="visita-brand visitas-brand">
        <img src={publicUrl("/brand/zg_marca.png")} alt="ZGROUP" />
      </div>
      <h3>Registro de conductores</h3>
      <p className="section-sub">
        Formulario público: <a href={qr} target="_blank" rel="noreferrer">{qr}</a>
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <div className="drv-tabs" role="tablist">
        <button className={view === "ingresos" ? "on" : ""} type="button" onClick={() => setView("ingresos")}>Ingresos</button>
        {manage ? <button className={view === "asimilar" ? "on" : ""} type="button" onClick={() => setView("asimilar")}>Asimilar datos</button> : null}
        {manage ? <button className={view === "menu" ? "on" : ""} type="button" onClick={() => { if (view !== "menu") setMenuTab("sedes"); setView("menu"); loadMasters().catch((e) => setError(e.message)); }}>Menú</button> : null}
      </div>
      {view === "menu" ? (
        <div className="drv-subtabs" role="tablist">
          <button className={menuTab === "sedes" ? "on" : ""} type="button" onClick={() => setMenuTab("sedes")}>Sedes</button>
          <button className={menuTab === "motivos" ? "on" : ""} type="button" onClick={() => setMenuTab("motivos")}>Motivos</button>
          <button className={menuTab === "almacenes" ? "on" : ""} type="button" onClick={() => setMenuTab("almacenes")}>Almacén y mapa</button>
          <button className={menuTab === "plantillas" ? "on" : ""} type="button" onClick={() => setMenuTab("plantillas")}>Plantillas</button>
          {superuser ? <button className={menuTab === "registros" ? "on" : ""} type="button" onClick={() => setMenuTab("registros")}>Registros</button> : null}
        </div>
      ) : null}

      {view === "ingresos" ? (
        <>
          <div className="drv-filters">
            <span>Estado</span>
            {STATUSES.map(([key, label]) => (
              <button key={key} className={status === key ? "on" : ""} type="button" onClick={() => { setStatus(key); load(key).catch((e) => setError(e.message)); }}>{label}</button>
            ))}
          </div>
          <label className="drv-field">
            <span>Buscar conductor</span>
            <input className="drv-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre, placa, código o empresa" />
          </label>
          <div className="drv-split">
            <div>
              {visible.map((row) => {
                const mark = pill(row.status);
                return (
                  <button key={row.id} type="button" className={`drv-row ${selected?.id === row.id ? "on" : ""}`} onClick={() => open(row.id).catch((e) => setError(e.message))}>
                    <span className="drv-row-top">
                      <b>{row.driverName || "Sin conductor"}</b>
                      <span className="drv-pill" style={{ background: mark.color }}>{mark.label}</span>
                    </span>
                    <span className="drv-meta">{row.tractorPlate || "Sin placa"} · {row.siteName || "Sin sede"} · {row.motive || "Sin motivo"}</span>
                    <span className="drv-meta">{row.publicCode || "Sin código"} · {formatWhen(row.visitAt)}</span>
                  </button>
                );
              })}
              {!visible.length ? <p className="section-sub">{rows.length ? "Ningún ingreso coincide con la búsqueda." : manage ? "No hay ingresos en este estado. En Asimilar datos puedes descargar la plantilla e importar el Excel." : "No hay ingresos en este estado."}</p> : null}
            </div>
            {selected?.id ? (
              <div className="drv-card">
                <h4>{selected.driverName || selected.publicCode || selected.tractorPlate}</h4>
                <StageTrack status={selected.status} events={selected.statusEvents} />
                <ol className="drv-time">
                  <li>
                    <b>Registrado</b>
                    <span>{formatWhen(selected.visitAt || selected.createdAt)}</span>
                  </li>
                  {(selected.statusEvents || []).slice().reverse().map((event) => (
                    <li key={event.id}>
                      <b>{statusLabel(event.toStatus)}</b>
                      <span>{formatWhen(event.createdAt)}{event.byName ? ` · ${event.byName}` : ""}</span>
                    </li>
                  ))}
                </ol>
                <p>{selected.publicCode || "Sin código"} · {formatWhen(selected.visitAt)}</p>
                <p>{selected.siteName} · {selected.motive}{selected.motiveDetail ? ` — ${selected.motiveDetail}` : ""}</p>
                <p>{selected.driverName} · {selected.company} · RUC {selected.ruc}</p>
                <p>Tracto {selected.tractorPlate} · carreta {selected.trailerPlate} · {selected.phone}</p>
                <p>Brevete {selected.license || "—"} · {selected.observations || "Sin observaciones"}</p>
                <p>Código {selected.equipmentCode || "sin código"}{selected.isoWarning ? ` · ${selected.isoWarning}. Se guarda igual.` : selected.equipmentCode ? " · cumple la norma ISO." : ""}</p>
                <button className="btn-primary" type="button" onClick={openForm}>{manage ? "Ver y editar registro" : "Ver registro"}</button>
                {selected.hasPhoto ? (
                  <button type="button" className="visit-photo-btn" onClick={() => lb.open([{ src: apiUrl(`/gate-visits/${selected.id}/photo`), type: "image", label: "Foto de la unidad" }])}>
                    <img className="visit-photo-preview" src={apiUrl(`/gate-visits/${selected.id}/photo`)} alt="Foto de la unidad" />
                  </button>
                ) : <p className="section-sub">{selected.photoArchived ? "La foto está archivada." : "Sin foto."}</p>}
                {manage && selected.hasPhoto ? <button className="btn-ghost" type="button" onClick={archivePhoto}>Archivar foto</button> : null}
                {canRestorePhoto && selected.photoArchived ? <button className="btn-ghost" type="button" onClick={restorePhoto}>Volver a mostrar la foto</button> : null}
                <div className="action-row">
                  <button className="btn-primary" type="button" onClick={() => downloadVisitPdf(selected, selected.hasPhoto ? apiUrl(`/gate-visits/${selected.id}/photo`) : "").catch((e) => setError(e.message))}>Descargar PDF</button>
                  {superuser ? <button className="btn-ghost drv-danger" type="button" onClick={removeVisit}>Eliminar registro</button> : null}
                </div>
                {manage ? (
                  <>
                    <label className="check-line">
                      <input type="checkbox" checked={sendConfirm} onChange={(e) => setSendConfirm(e.target.checked)} />
                      Al pasar a EN ATENCIÓN, enviar la confirmación al conductor
                    </label>
                    <div className="recv-actions">
                      {STATUSES.filter(([key]) => key !== "ANULADO").map(([key, label, color]) => (
                        <button key={key} className="btn-ghost" type="button" style={{ borderColor: color, background: selected.status === key ? color : undefined, color: selected.status === key ? "#fff" : undefined }} onClick={() => askStatus(key)}>{label}</button>
                      ))}
                    </div>
                    <div className="action-row">
                      <button className="btn-primary" type="button" disabled={selected.status !== "EN ATENCION"} onClick={askConfirm}>Enviar confirmación</button>
                    </div>
                    <div className="drv-place">
                      <span>Ubicación del almacén</span>
                      <p className="section-sub">{selected.status === "EN ATENCION" ? `Elige el almacén y envía el mapa al WhatsApp del transportista${selected.phone ? ` +51 ${localPhone(selected.phone)}` : ""}.` : "La confirmación y la ubicación se habilitan cuando el ingreso está en atención."}</p>
                      {(selected.warehouses || []).length ? (
                        <div className="drv-add">
                          <label>
                            <span>Almacén</span>
                            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} disabled={selected.status !== "EN ATENCION"}>
                              <option value="">Elige un almacén</option>
                              {selected.warehouses.map((item) => (
                                <option key={item.id} value={item.id}>{item.siteName ? `${item.siteName} · ${item.name}` : item.name}</option>
                              ))}
                            </select>
                          </label>
                          <button className="btn-primary" type="button" disabled={selected.status !== "EN ATENCION" || !placeId || !selected.phone} onClick={askPlace}>Enviar ubicación</button>
                        </div>
                      ) : <p className="section-sub">No hay almacenes. Agrégalos en Menú, Almacén y mapa.</p>}
                      {!selected.phone ? <p className="section-sub">Este ingreso no tiene teléfono del conductor.</p> : null}
                    </div>
                    {(selected.notices || []).length ? (
                      <>
                        <ul className="drv-notes">
                          {(moreNotices ? selected.notices : selected.notices.slice(0, 3)).map((note) => (
                            <li key={note.id}>
                              <span>{note.channel} · {note.destination} · {note.status}{note.detail ? ` · ${note.detail}` : ""}</span>
                              <span className="drv-note-actions">
                                {note.channel === "whatsapp" ? (
                                  <button className="btn-ghost" type="button" onClick={() => setOpenNote(note)}>Ver mensaje</button>
                                ) : null}
                                {note.status !== "en_cola" && note.status !== "en_espera" && note.status !== "ya_enviado" && note.status !== "enviado" && note.channel !== "interno" ? (
                                  <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/${selected.id}/notices/${note.id}/retry`, { method: "POST" }).then(setSelected).catch((e) => setError(e.message))}>Reenviar</button>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {selected.notices.length > 3 ? (
                          <button className="btn-ghost" type="button" onClick={() => setMoreNotices((open) => !open)}>
                            {moreNotices ? "Ver menos" : `Ver más (${selected.notices.length - 3})`}
                          </button>
                        ) : null}
                        {moreNotices && selected.notices.length >= 40 ? <p className="section-sub">Se muestran los 40 más recientes.</p> : null}
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {view === "asimilar" ? (
        <section className="drv-card drv-assimilate">
          <h4>Asimilar registros</h4>
          <ol className="drv-steps">
            <li>Descarga la plantilla. La hoja REGISTROS entra como Lima y la hoja PIURA como Piura.</li>
            <li>Una fila por ingreso. Borra la fila de ejemplo. El Excel histórico REGISTRO DE CONDUCTORES también se puede subir tal cual.</li>
            <li>Importa el archivo. Si el id ya existe, solo se completan los datos vacíos. Esta carga no envía correo ni WhatsApp.</li>
          </ol>
          <div className="action-row">
            <button className="btn-primary" type="button" onClick={downloadTemplate}>Descargar plantilla</button>
            <label className="btn-ghost drv-file">
              {importing ? "Importando…" : "Importar Excel"}
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={importing} onChange={(e) => { uploadExcel(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
          {report ? (
            <div className="drv-report">
              <p><b>{report.created}</b> nuevos · <b>{report.filled}</b> completados · <b>{report.skipped?.length || 0}</b> omitidos</p>
              <p className="section-sub">Los registros históricos suelen quedar en FINALIZADO. Abre ese filtro en Ingresos para verlos.</p>
              <button className="btn-ghost" type="button" onClick={() => { setStatus("FINALIZADO"); setView("ingresos"); load("FINALIZADO").catch((e) => setError(e.message)); }}>Ver finalizados</button>
              {report.skipped?.length ? (
                <ul className="drv-notes">
                  {report.skipped.slice(0, 40).map((item, index) => <li key={`${item.id}-${index}`}>{item.id}: {item.reason}</li>)}
                </ul>
              ) : null}
              {report.skipped?.length > 40 ? <p className="section-sub">Se muestran 40 de {report.skipped.length} omitidos.</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {view === "menu" && !masters ? <p className="section-sub">Cargando el menú…</p> : null}
      {view === "menu" && masters ? (
        <div className="drv-menu">
          {menuTab === "sedes" ? <section>
            <h4>Sedes</h4>
            <div className="drv-add">
              <label>
                <span>Nueva sede</span>
                <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Nombre de la sede" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); api("/gate-visits/sites", { method: "POST", body: { name: siteName } }).then(() => { setSiteName(""); return loadMasters(); }).catch((err) => setError(err.message)); } }} />
              </label>
              <button className="btn-primary" type="button" onClick={() => api("/gate-visits/sites", { method: "POST", body: { name: siteName } }).then(() => { setSiteName(""); return loadMasters(); }).catch((e) => setError(e.message))}>Agregar</button>
            </div>
            {masters.sites.map((site) => (
              <div key={site.id} className="drv-block">
                <b>{site.name}</b>
                <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/sites/${site.id}`, { method: "PATCH", body: { active: !site.active } }).then(loadMasters).catch((e) => setError(e.message))}>{site.active ? "Ocultar del formulario" : "Publicar"}</button>
                <p className="section-sub">Correos que reciben el aviso</p>
                <ul className="drv-dest">
                  {(site.recipients || []).filter((item) => item.kind === "correo").map((item) => (
                    editDest?.id === item.id ? (
                      <li key={item.id}>
                        <input value={editDest.value} onChange={(e) => setEditDest({ ...editDest, value: e.target.value })} placeholder="correo@empresa.com" />
                        <button className="btn-primary" type="button" onClick={saveDest}>Guardar</button>
                        <button className="btn-ghost" type="button" onClick={() => setEditDest(null)}>Cancelar</button>
                      </li>
                    ) : (
                      <li key={item.id}>
                        <span>{item.destination}</span>
                        <button className="btn-ghost" type="button" onClick={() => setEditDest({ id: item.id, kind: "correo", value: item.destination })}>Editar</button>
                        <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/recipients/${item.id}`, { method: "DELETE" }).then(loadMasters).catch((e) => setError(e.message))}>Quitar</button>
                      </li>
                    )
                  ))}
                </ul>
                <div className="drv-add">
                  <label>
                    <span>Correo</span>
                    <input value={mailDraft[site.id] || ""} onChange={(e) => setMailDraft({ ...mailDraft, [site.id]: e.target.value })} placeholder="correo@empresa.com" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMail(site.id); } }} />
                  </label>
                  <button className="btn-primary" type="button" onClick={() => addMail(site.id)}>Agregar correo</button>
                </div>
                <p className="section-sub">WhatsApp que reciben el aviso</p>
                <ul className="drv-dest">
                  {(site.recipients || []).filter((item) => item.kind === "whatsapp").map((item) => (
                    editDest?.id === item.id ? (
                      <li key={item.id}>
                        <PeruPhone value={editDest.value} onChange={(phone) => setEditDest({ ...editDest, value: phone })} placeholder="9 dígitos" />
                        <button className="btn-primary" type="button" onClick={saveDest}>Guardar</button>
                        <button className="btn-ghost" type="button" onClick={() => setEditDest(null)}>Cancelar</button>
                      </li>
                    ) : (
                      <li key={item.id}>
                        <span>+51 {localPhone(item.destination)}</span>
                        <button className="btn-ghost" type="button" onClick={() => setEditDest({ id: item.id, kind: "whatsapp", value: localPhone(item.destination) })}>Editar</button>
                        <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/recipients/${item.id}`, { method: "DELETE" }).then(loadMasters).catch((e) => setError(e.message))}>Quitar</button>
                      </li>
                    )
                  ))}
                </ul>
                <div className="drv-add">
                  <label>
                    <span>WhatsApp</span>
                    <PeruPhone value={phoneDraft[site.id] || ""} onChange={(phone) => setPhoneDraft({ ...phoneDraft, [site.id]: phone })} placeholder="9 dígitos" />
                  </label>
                  <button className="btn-primary" type="button" onClick={() => addPhone(site.id)}>Agregar WhatsApp</button>
                </div>
                <p className="section-sub">WhatsApp de respuesta: {site.replyPhone ? `+51 ${localPhone(site.replyPhone)}` : "sin número"}</p>
                <button className="btn-ghost" type="button" disabled={testing === site.id} onClick={() => testSite(site.id)}>{testing === site.id ? "Enviando prueba…" : "Enviar prueba"}</button>
                {testReport?.siteId === site.id ? (
                  <ul className="drv-notes">
                    {(testReport.items || []).map((item, index) => (
                      <li key={`${item.channel}-${item.destination}-${index}`}>{item.channel} · {item.destination} · {item.status}{item.detail ? ` · ${item.detail}` : ""}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            <div className="drv-add">
              <label>
                <span>Sede del número de respuesta</span>
                <select value={reply.siteId} onChange={(e) => pickReplySite(e.target.value)}>
                  {masters.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </label>
              <label>
                <span>WhatsApp de respuesta, si contestan el aviso</span>
                <PeruPhone value={reply.phone} onChange={(phone) => setReply({ ...reply, phone })} placeholder="9 dígitos" />
              </label>
              <button className="btn-primary" type="button" onClick={saveReply}>Guardar número de respuesta</button>
            </div>
          </section> : null}
          {menuTab === "motivos" ? <section>
            <h4>Motivos</h4>
            <div className="drv-add">
              <label>
                <span>Nuevo motivo</span>
                <input value={motiveName} onChange={(e) => setMotiveName(e.target.value)} placeholder="Nombre del motivo" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); api("/gate-visits/motives", { method: "POST", body: { name: motiveName, asksDetail } }).then(() => { setMotiveName(""); return loadMasters(); }).catch((err) => setError(err.message)); } }} />
              </label>
              <label className="check-line"><input type="checkbox" checked={asksDetail} onChange={(e) => setAsksDetail(e.target.checked)} /> Pide detalle</label>
              <button className="btn-primary" type="button" onClick={() => api("/gate-visits/motives", { method: "POST", body: { name: motiveName, asksDetail } }).then(() => { setMotiveName(""); return loadMasters(); }).catch((e) => setError(e.message))}>Agregar</button>
            </div>
            <ul>
              {masters.motives.map((item) => (
                <li key={item.id}>{item.name} {item.asksDetail ? "(pide detalle)" : ""} <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/motives/${item.id}`, { method: "PATCH", body: { active: !item.active } }).then(loadMasters).catch((e) => setError(e.message))}>{item.active ? "Ocultar" : "Mostrar"}</button></li>
              ))}
            </ul>
          </section> : null}
          {menuTab === "almacenes" ? <section>
            <h4>Almacén y mapa</h4>
            <div className="form-grid">
              <div>
                <label>Sede</label>
                <select value={warehouse.siteId} onChange={(e) => setWarehouse({ ...warehouse, siteId: e.target.value })}>
                  {masters.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </div>
              <div><label>Nombre</label><input value={warehouse.name} onChange={(e) => setWarehouse({ ...warehouse, name: e.target.value })} placeholder="Gambeta 1" /></div>
              <div><label>Google Maps</label><input value={warehouse.mapUrl} onChange={(e) => setWarehouse({ ...warehouse, mapUrl: e.target.value })} placeholder="https://maps.app.goo.gl/..." /></div>
            </div>
            <button className="btn-primary" type="button" onClick={() => api("/gate-visits/warehouses", { method: "POST", body: warehouse }).then(() => { setWarehouse({ ...warehouse, name: "", mapUrl: "" }); return loadMasters(); }).catch((e) => setError(e.message))}>Agregar almacén</button>
            {masters.sites.map((site) => (
              <div key={site.id} className="drv-block">
                <b>{site.name}</b>
                <ul>
                  {(site.warehouses || []).length ? site.warehouses.map((item) => (
                    <li key={item.id}>{item.name} · {item.mapUrl}</li>
                  )) : <li>Sin almacenes.</li>}
                </ul>
              </div>
            ))}
          </section> : null}
          {menuTab === "plantillas" ? <section>
            <h4>Plantilla de confirmación</h4>
            <textarea value={confirmText} onChange={(e) => setConfirmText(e.target.value)} rows={6} />
            <button className="btn-ghost" type="button" onClick={() => api("/gate-visits/templates", { method: "POST", body: { key: "confirm", value: confirmText } }).then(() => setMsg("Plantilla de confirmación guardada.")).catch((e) => setError(e.message))}>Guardar confirmación</button>
            <h4>Plantilla de ubicación</h4>
            <textarea value={locationText} onChange={(e) => setLocationText(e.target.value)} rows={7} />
            <button className="btn-ghost" type="button" onClick={() => api("/gate-visits/templates", { method: "POST", body: { key: "location", value: locationText } }).then(() => setMsg("Plantilla de ubicación guardada.")).catch((e) => setError(e.message))}>Guardar ubicación</button>
          </section> : null}
          {menuTab === "registros" && superuser ? (
            <section>
              <h4>Registros</h4>
              <p className="section-sub">Elimina todos los ingresos de conductores. Las sedes, los motivos, los correos y los almacenes se quedan.</p>
              <button className="btn-ghost drv-danger" type="button" onClick={resetModule}>Reiniciar módulo</button>
            </section>
          ) : null}
        </div>
      ) : null}
      {openNote ? (
        <div className="overlay open" role="presentation" onClick={() => setOpenNote(null)}>
          <div className="modal drv-reg-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{noteTitle(openNote)}</h3>
              <button className="modal-close" type="button" onClick={() => setOpenNote(null)} aria-label="Cerrar">×</button>
            </div>
            <div className="modal-body single">
              <p className="section-sub">{openNote.destination} · {formatWhen(openNote.createdAt)}</p>
              <p className="drv-note-body">{openNote.message || "Este envío no guardó el texto."}</p>
              {openNote.message && openNote.messageSaved === false && openNote.kind !== "ubicacion" ? <p className="section-sub">Este envío no guardó el texto. Se muestra con los datos de ahora.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
      {noticeModal ? (
        <div className="overlay open" role="presentation">
          <div className="modal drv-reg-modal" role="dialog">
            <div className="modal-head">
              <h3>{noticeModal.title}</h3>
              <button className="modal-close" type="button" onClick={() => setNoticeModal(null)} aria-label="Cerrar">×</button>
            </div>
            <div className="modal-body single">
              <p>{noticeModal.text}</p>
              <div className="action-row">
                <button className="btn-primary" type="button" onClick={() => setNoticeModal(null)}>Entendido</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {sure ? (
        <div className="overlay open" role="presentation" onClick={() => setSure(null)}>
          <div className="modal drv-reg-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{sure.title}</h3>
              <button className="modal-close" type="button" onClick={() => setSure(null)} aria-label="Cerrar">×</button>
            </div>
            <div className="modal-body single">
              <p>{sure.text}</p>
              <div className="action-row">
                <button className="btn-primary" type="button" onClick={() => { const run = sure.run; setSure(null); run(); }}>Sí, enviar</button>
                <button className="btn-ghost" type="button" onClick={() => setSure(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {formOpen && edit ? (
        <div className="overlay open" role="presentation" onClick={() => setFormOpen(false)}>
          <form className="modal reg-card drv-reg-form" role="dialog" aria-labelledby="drv-reg-title" onClick={(event) => event.stopPropagation()} onSubmit={saveForm}>
            <header className="reg-banner">
              <span className="reg-banner-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 7h11v8H3V7zm11 2h4l3 3v3h-7V9zM7 18a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>
              </span>
              <div>
                <strong id="drv-reg-title">REGISTRO DE CONDUCTORES</strong>
                <small>Control de ingreso</small>
              </div>
              <button className="modal-close" type="button" onClick={() => setFormOpen(false)} aria-label="Cerrar">×</button>
            </header>
            <div className="reg-body">
              <RegSection icon={<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" /></svg>} title="SEDE DE REGISTRO">
                <label className="reg-field reg-span">
                  Sede<i>*</i>
                  <select value={edit.siteId} disabled={!manage} onChange={(e) => setEdit({ ...edit, siteId: e.target.value })}>
                    <option value="">{selected?.siteName || "Seleccione una sede"}</option>
                    {editOptions.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                  </select>
                  <small>Seleccione la sede de ZGROUP donde realizará el ingreso.</small>
                </label>
              </RegSection>
              <RegSection icon={<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z" /></svg>} title="DATOS DEL CONDUCTOR">
                <label className="reg-field">Empresa<i>*</i><input value={edit.company} disabled={!manage} onChange={(e) => setEdit({ ...edit, company: e.target.value })} placeholder="Ingrese la empresa" /></label>
                <label className="reg-field">RUC<i>*</i><input value={edit.ruc} disabled={!manage} inputMode="numeric" onChange={(e) => setEdit({ ...edit, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="Ingrese RUC de 11 dígitos" /></label>
                <label className="reg-field">Nombres y apellidos<i>*</i><input value={edit.driverName} disabled={!manage} onChange={(e) => setEdit({ ...edit, driverName: e.target.value })} placeholder="Ingrese nombres y apellidos" /></label>
                <label className="reg-field">N.º de brevete<i>*</i><input value={edit.license} disabled={!manage} onChange={(e) => setEdit({ ...edit, license: e.target.value })} placeholder="Ingrese n.º de brevete" /></label>
                <label className="reg-field">Teléfono<i>*</i><PeruPhone value={edit.phone} disabled={!manage} onChange={(phone) => setEdit({ ...edit, phone })} placeholder="Ingrese teléfono de 9 dígitos" /></label>
              </RegSection>
              <RegSection icon={<svg viewBox="0 0 24 24"><path d="M3 7h11v8H3V7zm11 2h4l3 3v3h-7V9zM7 18a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm10 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>} title="DATOS DEL VEHÍCULO">
                <label className="reg-field">Placa tracto<i>*</i><input value={edit.tractorPlate} disabled={!manage} onChange={(e) => setEdit({ ...edit, tractorPlate: e.target.value.toUpperCase() })} placeholder="Ingrese placa del tracto" /></label>
                <label className="reg-field">Placa carreta<i>*</i><input value={edit.trailerPlate} disabled={!manage} onChange={(e) => setEdit({ ...edit, trailerPlate: e.target.value.toUpperCase() })} placeholder="Ingrese placa de la carreta" /></label>
              </RegSection>
              <RegSection icon={<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM8 12h8v1.6H8zm0 3.4h8V17H8z" /></svg>} title="DATOS DE LA VISITA">
                <label className="reg-field">
                  Motivo de visita<i>*</i>
                  <select value={edit.motiveId} disabled={!manage} onChange={(e) => setEdit({ ...edit, motiveId: e.target.value })}>
                    <option value="">{selected?.motive || "Seleccione una opción"}</option>
                    {editOptions.motives.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="reg-field">
                  Código de equipo
                  <input value={edit.equipmentCode} disabled={!manage} onChange={(e) => setEdit({ ...edit, equipmentCode: e.target.value })} placeholder="Ingrese código de equipo" />
                  <small className={isoNote(edit.equipmentCode) ? "reg-iso" : "reg-iso ok"}>{isoNote(edit.equipmentCode) || (edit.equipmentCode ? "Cumple la norma ISO." : "Si lo dejas vacío, no se evalúa.")}</small>
                </label>
                {edit.motiveDetail || editOptions.motives.find((item) => item.id === edit.motiveId)?.asksDetail ? (
                  <label className="reg-field reg-span">Detalle del motivo<i>*</i><input value={edit.motiveDetail} disabled={!manage} onChange={(e) => setEdit({ ...edit, motiveDetail: e.target.value })} placeholder="Describe la visita" /></label>
                ) : null}
                <label className="reg-field reg-span">
                  Observaciones
                  <textarea value={edit.observations} disabled={!manage} rows={3} onChange={(e) => setEdit({ ...edit, observations: e.target.value })} placeholder="Ingrese observaciones si corresponde" />
                </label>
                <div className="reg-field reg-span">
                  Foto de la unidad
                  <span className="reg-file">
                    {selected?.hasPhoto ? <img src={apiUrl(`/gate-visits/${selected.id}/photo`)} alt="Foto de la unidad" /> : null}
                    <span>{selected?.hasPhoto ? "Foto cargada" : selected?.photoArchived ? "La foto está archivada." : "Sin foto"}</span>
                  </span>
                </div>
              </RegSection>
              {manage ? <button className="reg-submit" type="submit" disabled={savingForm}>{savingForm ? "GUARDANDO…" : "GUARDAR CAMBIOS"}</button> : null}
              <button className="reg-dismiss" type="button" onClick={() => setFormOpen(false)}>Cerrar</button>
            </div>
          </form>
        </div>
      ) : null}
      {lb.node}
    </div>
  );
}
