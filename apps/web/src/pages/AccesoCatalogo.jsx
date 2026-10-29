import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, publicUrl } from "../api.js";
import { whatsappDigits } from "../catalog-copy.js";
import { salidaNotice } from "../salida-notice.js";
import { useNotice } from "../notice.jsx";

const emptyPerson = {
  dni: "",
  firstName: "",
  lastName: "",
  phonePrefix: "51",
  phoneLocal: "",
  clientEmail: "",
};

function waHref(phone) {
  const digits = whatsappDigits(phone);
  if (digits.length < 8) return "";
  const text = "Hola, ya tengo un catálogo vigente y quiero ver los equipos.";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function TakenCard({ vendorName, vendorWhatsapp }) {
  const href = waHref(vendorWhatsapp);
  return (
    <div className="acceso-company">
      <p>Ya tienes un enlace de catálogo. Sigue vigente.</p>
      <p>{vendorName ? `Si no lo encuentras, escríbele a ${vendorName} por WhatsApp.` : "Si no lo encuentras, escríbele a tu comercial por WhatsApp."}</p>
      {href ? (
        <a className="btn-whatsapp" href={href} target="_blank" rel="noreferrer">Escribir por WhatsApp</a>
      ) : (
        <p>Ese comercial no tiene WhatsApp cargado. Pide ayuda en portería.</p>
      )}
    </div>
  );
}

export default function AccesoCatalogo() {
  const nav = useNavigate();
  const [mode, setMode] = useState("");
  const [ruc, setRuc] = useState("");
  const [company, setCompany] = useState(null);
  const [taken, setTaken] = useState(null);
  const [person, setPerson] = useState(emptyPerson);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const { notify, toastNode } = useNotice();
  const avisoTold = useRef("");

  useEffect(() => {
    const token = created?.token;
    if (!token || !created?.avisoPending || created?.aviso) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const aviso = await api(`/catalog-shares/public/aviso/${token}`);
        if (stop || !aviso?.done || avisoTold.current === token) return;
        avisoTold.current = token;
        stop = true;
        if (aviso.text) notify(aviso.text, aviso.ok ? "ok" : "err");
        setCreated((cur) => (cur && cur.token === token ? { ...cur, aviso } : cur));
      } catch {
        /* el siguiente intento vuelve a preguntar */
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    const giveUp = setTimeout(() => { stop = true; clearInterval(timer); }, 70000);
    return () => { stop = true; clearInterval(timer); clearTimeout(giveUp); };
  }, [created?.token, created?.avisoPending, created?.aviso]);

  function pick(next) {
    setMode(next);
    setCompany(null);
    setTaken(null);
    setError("");
    setRuc("");
    setPerson(emptyPerson);
  }

  async function lookupRuc(e) {
    e.preventDefault();
    setError("");
    setCompany(null);
    setLooking(true);
    try {
      const found = await api("/catalog-shares/public/ruc", { method: "POST", body: { ruc } });
      setCompany(found);
    } catch (err) {
      setError(err.message);
    } finally {
      setLooking(false);
    }
  }

  async function register(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const row = await api("/catalog-shares/public/register", {
        method: "POST",
        body: {
          docKind: mode === "ruc" ? "ruc" : "dni",
          ruc: mode === "ruc" ? ruc : "",
          ...person,
          dni: mode === "ruc" ? "" : person.dni,
        },
      });
      if (row.renewed && !row.accessCode) setCompany(row);
      else setCreated(row);
    } catch (err) {
      if (err.data?.busy) {
        setTaken({ vendorName: err.data.vendorName || "", vendorWhatsapp: err.data.vendorWhatsapp || "" });
        setError("");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function openCatalog(row = created) {
    if (!row?.token || !row?.accessCode) return;
    window.sessionStorage.setItem(`zdry-share-prefill:${row.token}`, row.accessCode);
    nav(row.path);
  }

  if (created) {
    return (
      <>
      {toastNode}
      <div className="panel visita-public visita-welcome acceso-card">
        <div className="visita-brand"><img src={publicUrl("/brand/zg_marca.png")} alt="ZGROUP" /></div>
        <h2 className="section-title">{created.renewed ? "Tu enlace sigue abierto" : "Tu catálogo está listo"}</h2>
        <p className="acceso-greeting">{created.greeting}</p>
        <p>El enlace de <b>{created.clientCompany}</b> quedó abierto para <b>{created.contactName}</b>.</p>
        <p>Clave de acceso</p>
        <p className="share-created-key">{created.accessCode}</p>
        <p>{created.minutes ? `Vigente ${created.minutes} minutos.` : `Vigente ${created.hours} ${created.hours === 1 ? "hora" : "horas"}.`}</p>
        <p>{created.vendorName ? `Te atiende ${created.vendorName}.` : "Un comercial quedó asignado para hacerte seguimiento."}</p>
        {created.avisoPending && !created.aviso ? <p>Los WhatsApp y los correos se envían solos. El aviso queda abajo cuando salen.</p> : null}
        {salidaNotice(created.salida) ? <p>{salidaNotice(created.salida)}</p> : null}
        <div className="share-created-actions" style={{ justifyContent: "center" }}>
          <button className="btn-primary" type="button" onClick={() => openCatalog()}>Ver catálogo</button>
        </div>
      </div>
      </>
    );
  }

  const personReady = !taken && !company?.renewed && (mode === "dni" || (company && !company.busy));

  return (
    <>
    {toastNode}
    <div className="panel visita-public acceso-card">
      <div className="visita-brand"><img src={publicUrl("/brand/zg_marca.png")} alt="ZGROUP" /></div>
      <h2 className="section-title">Acceso al catálogo</h2>
      <p>Si llegaste a nuestras instalaciones, registra tus datos y te abrimos el catálogo de equipos.</p>
      {error ? <div className="err">{error}</div> : null}
      <div className="doc-kind-switch" role="group" aria-label="Documento">
        <button type="button" className={mode === "ruc" ? "on" : ""} onClick={() => pick("ruc")}>Tengo RUC</button>
        <button type="button" className={mode === "dni" ? "on" : ""} onClick={() => pick("dni")}>Solo tengo DNI</button>
      </div>
      {!mode ? <p className="field-hint">Con RUC el catálogo dura 3 horas. Solo con DNI, 1 hora. El nombre, el celular de WhatsApp y el correo son necesarios.</p> : null}

      {mode === "ruc" ? (
        <form className="form-grid" onSubmit={lookupRuc}>
          <div>
            <label>RUC</label>
            <input value={ruc} onChange={(e) => { setRuc(e.target.value.replace(/\D/g, "").slice(0, 11)); setCompany(null); }} required placeholder="11 dígitos" inputMode="numeric" />
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button className="btn-primary" type="submit" disabled={looking}>{looking ? "Validando…" : "Validar RUC"}</button>
          </div>
        </form>
      ) : null}

      {company && !company.renewed ? (
        <div className="acceso-company">
          <p className="acceso-greeting">{company.greeting}</p>
          <b>{company.companyName || company.clientCompany}</b>
          <p>{[company.street, company.district, company.province, company.department].filter(Boolean).join(" · ") || "Sin domicilio en la consulta."}</p>
          {company.busy ? null : <p>El catálogo queda abierto 3 horas. Completa los datos de quien lo va a ver.</p>}
        </div>
      ) : null}

      {company?.renewed ? (
        <div className="acceso-company">
          <p className="acceso-greeting">{company.greeting}</p>
          {company.clientCompany || company.companyName ? <b>{company.clientCompany || company.companyName}</b> : null}
          <p>{company.message || "Ya tenías un enlace. Había vencido y te abrimos 30 minutos más."}</p>
          <p>{company.vendorName ? `Te atiende ${company.vendorName}. Ya se le avisó que estás buscando información.` : "Ya se avisó al comercial que estás buscando información."}</p>
          {salidaNotice(company.salida) ? <p>{salidaNotice(company.salida)}</p> : null}
          {waHref(company.vendorWhatsapp) ? (
            <a className="btn-whatsapp" href={waHref(company.vendorWhatsapp)} target="_blank" rel="noreferrer">Escribir al comercial</a>
          ) : null}
          {company.accessCode ? (
            <>
              <p>Clave de acceso</p>
              <p className="share-created-key">{company.accessCode}</p>
              <p>Vigente {company.minutes || 30} minutos.</p>
              <button className="btn-primary" type="button" onClick={() => openCatalog(company)}>Ver catálogo</button>
            </>
          ) : null}
        </div>
      ) : null}

      {company?.busy ? <TakenCard vendorName={company.vendorName} vendorWhatsapp={company.vendorWhatsapp} /> : null}
      {taken && !company?.busy && !company?.renewed ? <TakenCard vendorName={taken.vendorName} vendorWhatsapp={taken.vendorWhatsapp} /> : null}

      {mode === "dni" && !taken && !company?.renewed ? <p>Puedes registrarte solo con tu DNI. El catálogo queda abierto 1 hora.</p> : null}

      {personReady ? (
        <form className="form-grid" onSubmit={register}>
          {mode === "dni" ? (
            <div>
              <label>DNI</label>
              <input value={person.dni} onChange={(e) => setPerson({ ...person, dni: e.target.value.replace(/\D/g, "").slice(0, 8) })} required placeholder="8 dígitos" inputMode="numeric" />
            </div>
          ) : null}
          <div>
            <label>Nombres</label>
            <input value={person.firstName} onChange={(e) => setPerson({ ...person, firstName: e.target.value })} required />
          </div>
          <div>
            <label>Apellidos</label>
            <input value={person.lastName} onChange={(e) => setPerson({ ...person, lastName: e.target.value })} required />
          </div>
          <div className="phone-pair">
            <div>
              <label>Prefijo</label>
              <input value={person.phonePrefix} onChange={(e) => setPerson({ ...person, phonePrefix: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" aria-label="Prefijo del celular" required />
            </div>
            <div>
              <label>Celular de WhatsApp</label>
              <input value={person.phoneLocal} onChange={(e) => setPerson({ ...person, phoneLocal: e.target.value })} inputMode="tel" required placeholder="999 111 222" />
            </div>
            <p className="field-hint">51 es Perú. Cámbialo si el celular es de otro país.</p>
          </div>
          <div>
            <label>Correo electrónico</label>
            <input type="email" value={person.clientEmail} onChange={(e) => setPerson({ ...person, clientEmail: e.target.value })} required />
          </div>
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Generando…" : "Obtener mi catálogo"}</button>
        </form>
      ) : null}
    </div>
    </>
  );
}
