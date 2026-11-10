import { useEffect, useState } from "react";
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
  const [code, setCode] = useState("");
  const [siteName, setSiteName] = useState("");
  const [motiveName, setMotiveName] = useState("");
  const [asksDetail, setAsksDetail] = useState(false);
  const [recipient, setRecipient] = useState({ siteId: "", kind: "correo", destination: "" });
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
    setCode(detail.equipmentCode || "");
    setSendConfirm(false);
    return detail;
  }

  async function loadMasters() {
    const data = await api("/gate-visits/masters");
    setMasters(data);
    setConfirmText(data.confirmTemplate || "");
    setLocationText(data.locationTemplate || "");
    const first = data.sites?.[0]?.id || "";
    setRecipient((current) => ({ ...current, siteId: current.siteId || first }));
    setWarehouse((current) => ({ ...current, siteId: current.siteId || first }));
    setReply((current) => {
      const siteId = current.siteId || first;
      const site = (data.sites || []).find((item) => item.id === siteId) || data.sites?.[0];
      return { siteId: site?.id || "", phone: localPhone(site?.replyPhone) };
    });
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

  async function changeStatus(next) {
    if (!selected) return;
    setError("");
    try {
      const detail = await api(`/gate-visits/${selected.id}/status`, {
        method: "POST",
        body: { status: next, sendConfirm: next === "EN ATENCION" && sendConfirm },
      });
      setSelected(detail);
      setMsg(next === "EN ATENCION" && sendConfirm ? "Estado actualizado y confirmación enviada al conductor." : "Estado actualizado.");
      await load(status);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveCode() {
    setError("");
    try {
      await api(`/gate-visits/${selected.id}`, { method: "PATCH", body: { equipmentCode: code } });
      setMsg("Código de equipo actualizado.");
      await open(selected.id);
      await load(status);
    } catch (e) {
      setError(e.message);
    }
  }

  async function sendDriver(kind, warehouseId) {
    setError("");
    try {
      const detail = await api(`/gate-visits/${selected.id}/driver`, { method: "POST", body: { kind, warehouseId } });
      setSelected(detail);
      setMsg(kind === "ubicacion" ? "Ubicación enviada al conductor." : "Confirmación enviada al conductor.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function archivePhoto() {
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
          <input className="drv-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar conductor, placa, código o empresa" />
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
                <p>{selected.publicCode || "Sin código"} · {formatWhen(selected.visitAt)}</p>
                <p>{selected.siteName} · {selected.motive}{selected.motiveDetail ? ` — ${selected.motiveDetail}` : ""}</p>
                <p>{selected.driverName} · {selected.company} · RUC {selected.ruc}</p>
                <p>Tracto {selected.tractorPlate} · carreta {selected.trailerPlate} · {selected.phone}</p>
                <p>Brevete {selected.license || "—"} · {selected.observations || "Sin observaciones"}</p>
                {selected.isoWarning ? <p className="err">{selected.isoWarning}</p> : null}
                {manage ? (
                  <div className="action-row">
                    <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de equipo" />
                    <button className="btn-ghost" type="button" onClick={saveCode}>Guardar código</button>
                  </div>
                ) : null}
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
                        <button key={key} className="btn-ghost" type="button" style={{ borderColor: color }} onClick={() => changeStatus(key)}>{label}</button>
                      ))}
                    </div>
                    <div className="action-row">
                      <button className="btn-primary" type="button" onClick={() => sendDriver("confirmacion")}>Enviar confirmación</button>
                      {(selected.warehouses || []).map((item) => (
                        <button key={item.id} className="btn-ghost" type="button" onClick={() => sendDriver("ubicacion", item.id)}>{item.name}</button>
                      ))}
                    </div>
                    {(selected.notices || []).length ? (
                      <ul className="drv-notes">
                        {selected.notices.map((note) => (
                          <li key={note.id}>
                            {note.channel} · {note.destination} · {note.status} {note.detail ? `· ${note.detail}` : ""}
                            {note.status !== "en_cola" && note.channel !== "interno" ? (
                              <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/${selected.id}/notices/${note.id}/retry`, { method: "POST" }).then(setSelected).catch((e) => setError(e.message))}>Reenviar</button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
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
            <div className="action-row">
              <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Nueva sede" />
              <button className="btn-primary" type="button" onClick={() => api("/gate-visits/sites", { method: "POST", body: { name: siteName } }).then(() => { setSiteName(""); return loadMasters(); }).catch((e) => setError(e.message))}>Agregar</button>
            </div>
            {masters.sites.map((site) => (
              <div key={site.id} className="drv-block">
                <b>{site.name}</b>
                <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/sites/${site.id}`, { method: "PATCH", body: { active: !site.active } }).then(loadMasters).catch((e) => setError(e.message))}>{site.active ? "Ocultar del formulario" : "Publicar"}</button>
                <p className="section-sub">Correos y WhatsApp</p>
                <ul>
                  {(site.recipients || []).map((item) => (
                    <li key={item.id}>{item.kind}: {item.destination} <button className="btn-ghost" type="button" onClick={() => api(`/gate-visits/recipients/${item.id}`, { method: "DELETE" }).then(loadMasters).catch((e) => setError(e.message))}>Quitar</button></li>
                  ))}
                </ul>
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
            <div className="form-grid">
              <div>
                <label>Agregar destino</label>
                <select value={recipient.siteId} onChange={(e) => setRecipient({ ...recipient, siteId: e.target.value })}>
                  {masters.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </div>
              <div>
                <label>Canal</label>
                <select value={recipient.kind} onChange={(e) => setRecipient({ ...recipient, kind: e.target.value })}>
                  <option value="correo">Correo</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>
              <div>
                <label>Destino</label>
                <input value={recipient.destination} onChange={(e) => setRecipient({ ...recipient, destination: e.target.value })} placeholder="correo o número" />
              </div>
            </div>
            <button className="btn-primary" type="button" onClick={() => api("/gate-visits/recipients", { method: "POST", body: recipient }).then(() => { setRecipient({ ...recipient, destination: "" }); return loadMasters(); }).catch((e) => setError(e.message))}>Agregar destino</button>
            <div className="form-grid">
              <div>
                <label>Sede del número de respuesta</label>
                <select value={reply.siteId} onChange={(e) => pickReplySite(e.target.value)}>
                  {masters.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </div>
              <div>
                <label>WhatsApp de respuesta</label>
                <PeruPhone value={reply.phone} onChange={(phone) => setReply({ ...reply, phone })} placeholder="9 dígitos" />
              </div>
            </div>
            <button className="btn-primary" type="button" onClick={saveReply}>Guardar número de respuesta</button>
          </section> : null}
          {menuTab === "motivos" ? <section>
            <h4>Motivos</h4>
            <div className="action-row">
              <input value={motiveName} onChange={(e) => setMotiveName(e.target.value)} placeholder="Nuevo motivo" />
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
      {lb.node}
    </div>
  );
}
