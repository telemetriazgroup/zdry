import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, publicUrl } from "../api.js";
import { DEFAULT_CATALOG_COPY, STEP_ICONS, mergeCatalogCopy } from "../catalog-copy.js";
import SiteFooter from "./SiteFooter.jsx";

function Field({ label, hint, children }) {
  return (
    <div className="copy-field">
      <label>{label}</label>
      {hint ? <small>{hint}</small> : null}
      {children}
    </div>
  );
}

function ClientPreview({ copy }) {
  const [leadI, setLeadI] = useState(0);
  useEffect(() => {
    const leads = copy.heroLeads?.length ? copy.heroLeads : [" "];
    const t = setInterval(() => setLeadI((x) => (x + 1) % leads.length), 5000);
    return () => clearInterval(t);
  }, [copy.heroLeads]);
  const leads = copy.heroLeads?.length ? copy.heroLeads : [" "];

  return (
    <div className="copy-preview-frame">
      <div className="copy-preview-bar">Así lo ve el cliente</div>
      <div className="copy-preview-site">
        <header className="topbar">
          <div className="topbar-inner topbar-public">
            <span className="brand"><img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></span>
            <div className="topbar-tools">
              <span className="cart-pill">🛒 {copy.cartLabel} 0</span>
              <span className="navtab">{copy.loginLabel}</span>
            </div>
          </div>
        </header>
        <div className="hero">
          <div className="hero-inner">
            <p className="hero-kicker">{copy.heroKicker}</p>
            <h1>{copy.heroTitle}</h1>
            <p className="lead hero-lead on">{leads[leadI % leads.length]}</p>
            <ul className="hero-pills">
              {(copy.heroPills || []).map((p) => <li key={p}>{p}</li>)}
            </ul>
            <div className="quickfilter">
              <div className="qf-row">
                <div className="qf-field qf-search">
                  <label>{copy.searchLabel}</label>
                  <input readOnly placeholder={copy.searchPlaceholder} />
                </div>
                <div className="qf-field">
                  <label>{copy.typeLabel}</label>
                  <select disabled><option>{copy.typeAll}</option></select>
                </div>
                <div className="qf-field">
                  <label>{copy.conditionLabel}</label>
                  <select disabled><option>{copy.conditionAll}</option></select>
                </div>
                <div className="qf-field">
                  <label>{copy.depotLabel}</label>
                  <select disabled><option>{copy.depotAll}</option></select>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="catalog-wrap" style={{ paddingTop: 26 }}>
          <div className="stock-bar">
            <div className="stock-count">
              <span className="stock-n">1</span>
              <span className="stock-copy">
                <b>{copy.stockSingular}</b>
                <small>{copy.stockHint}</small>
              </span>
            </div>
            <label className="stock-sort">
              {copy.sortLabel}
              <select disabled><option>{copy.sortIso}</option></select>
            </label>
          </div>
          <div className="steps-block">
            <h3 className="steps-title">{copy.stepsTitle}</h3>
            <div className="value-row">
              {(copy.steps || []).map((s, i) => (
                <div className="value-card step-card" key={i}>
                  <div className="step-icon-wrap">
                    <img className="step-icon" src={publicUrl(STEP_ICONS[i] || STEP_ICONS[0])} alt="" />
                    <span className="step-n">{i + 1}</span>
                  </div>
                  <b>{s.title}</b>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
          <article className="card" style={{ maxWidth: 320 }}>
            <div className="card-media"><span className="muted">Foto de unidad</span></div>
            <div className="card-body">
              <div className="card-title">40&apos; Standard</div>
              <div className="card-iso">ZDRU0000000</div>
              <div className="card-footer">
                <div className="price-cta">{copy.requestPrice}</div>
                <span className="link-btn">{copy.requestQuote}</span>
              </div>
            </div>
          </article>
        </div>
        <SiteFooter copy={copy} forceCookie />
      </div>
    </div>
  );
}

export default function CatalogCopy() {
  const [copy, setCopy] = useState(DEFAULT_CATALOG_COPY);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/config/catalog-copy")
      .then((d) => setCopy(mergeCatalogCopy(d)))
      .catch((e) => setError(e.message));
  }, []);

  function set(key, value) {
    setCopy((c) => ({ ...c, [key]: value }));
  }

  function setStep(i, key, value) {
    setCopy((c) => ({
      ...c,
      steps: c.steps.map((s, j) => (j === i ? { ...s, [key]: value } : s)),
    }));
  }

  async function save() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const out = await api("/config/catalog-copy", { method: "PUT", body: copy });
      setCopy(mergeCatalogCopy(out));
      setMsg("Textos guardados. El catálogo público ya los muestra.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Textos del catálogo</h2>
      <p className="section-sub">
        Todo lo que lee el cliente en la portada: titular, carrusel, filtros, pasos, botones y pie.
        A la derecha ves la misma página, actualizada al escribir.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <div className="copy-editor">
        <div className="copy-form">
          <div className="panel">
            <h3>Hero</h3>
            <Field label="Antetítulo"><input value={copy.heroKicker} onChange={(e) => set("heroKicker", e.target.value)} /></Field>
            <Field label="Título"><input value={copy.heroTitle} onChange={(e) => set("heroTitle", e.target.value)} /></Field>
            <Field label="Frases del carrusel" hint="Una por línea. Cada una se muestra unos 5 segundos.">
              <textarea rows={5} value={(copy.heroLeads || []).join("\n")} onChange={(e) => set("heroLeads", e.target.value.split("\n"))} />
            </Field>
            <Field label="Pastillas" hint="Una por línea.">
              <textarea rows={4} value={(copy.heroPills || []).join("\n")} onChange={(e) => set("heroPills", e.target.value.split("\n"))} />
            </Field>
          </div>

          <div className="panel">
            <h3>Filtros y stock</h3>
            <div className="form-grid">
              <Field label="Buscar"><input value={copy.searchLabel} onChange={(e) => set("searchLabel", e.target.value)} /></Field>
              <Field label="Placeholder búsqueda"><input value={copy.searchPlaceholder} onChange={(e) => set("searchPlaceholder", e.target.value)} /></Field>
              <Field label="Tipo"><input value={copy.typeLabel} onChange={(e) => set("typeLabel", e.target.value)} /></Field>
              <Field label="Tipo — todos"><input value={copy.typeAll} onChange={(e) => set("typeAll", e.target.value)} /></Field>
              <Field label="Condición"><input value={copy.conditionLabel} onChange={(e) => set("conditionLabel", e.target.value)} /></Field>
              <Field label="Condición — todas"><input value={copy.conditionAll} onChange={(e) => set("conditionAll", e.target.value)} /></Field>
              <Field label="Depósito"><input value={copy.depotLabel} onChange={(e) => set("depotLabel", e.target.value)} /></Field>
              <Field label="Depósito — todos"><input value={copy.depotAll} onChange={(e) => set("depotAll", e.target.value)} /></Field>
              <Field label="Stock (1)"><input value={copy.stockSingular} onChange={(e) => set("stockSingular", e.target.value)} /></Field>
              <Field label="Stock (varios)"><input value={copy.stockPlural} onChange={(e) => set("stockPlural", e.target.value)} /></Field>
              <Field label="Ayuda bajo el número"><input value={copy.stockHint} onChange={(e) => set("stockHint", e.target.value)} /></Field>
              <Field label="Ordenar"><input value={copy.sortLabel} onChange={(e) => set("sortLabel", e.target.value)} /></Field>
            </div>
          </div>

          <div className="panel">
            <h3>3 pasos</h3>
            <Field label="Título de la sección"><input value={copy.stepsTitle} onChange={(e) => set("stepsTitle", e.target.value)} /></Field>
            {(copy.steps || []).map((s, i) => (
              <div key={i} className="copy-step">
                <Field label={`Paso ${i + 1} — título`}><input value={s.title} onChange={(e) => setStep(i, "title", e.target.value)} /></Field>
                <Field label={`Paso ${i + 1} — texto`}><textarea rows={3} value={s.body} onChange={(e) => setStep(i, "body", e.target.value)} /></Field>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>Botones y barra</h3>
            <div className="form-grid">
              <Field label="Solicitar precio"><input value={copy.requestPrice} onChange={(e) => set("requestPrice", e.target.value)} /></Field>
              <Field label="Solicitar cotización"><input value={copy.requestQuote} onChange={(e) => set("requestQuote", e.target.value)} /></Field>
              <Field label="Agregar"><input value={copy.addToQuote} onChange={(e) => set("addToQuote", e.target.value)} /></Field>
              <Field label="Ya en cotización"><input value={copy.inQuote} onChange={(e) => set("inQuote", e.target.value)} /></Field>
              <Field label="Carrito"><input value={copy.cartLabel} onChange={(e) => set("cartLabel", e.target.value)} /></Field>
              <Field label="Entrar"><input value={copy.loginLabel} onChange={(e) => set("loginLabel", e.target.value)} /></Field>
              <Field label="Salir"><input value={copy.logoutLabel} onChange={(e) => set("logoutLabel", e.target.value)} /></Field>
            </div>
            <Field label="Sin stock"><textarea rows={2} value={copy.emptyStock} onChange={(e) => set("emptyStock", e.target.value)} /></Field>
            <h3 style={{ marginTop: 16 }}>WhatsApp</h3>
            <p className="section-sub">Cotizar y pedir precio abren este chat. Número con código de país, solo dígitos (ej. 51987654321). Si lo dejas vacío se usa el teléfono del pie.</p>
            <div className="form-grid">
              <Field label="Número WhatsApp"><input value={copy.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="51987654321" /></Field>
              <Field label="Etiqueta del botón"><input value={copy.whatsappCta} onChange={(e) => set("whatsappCta", e.target.value)} /></Field>
            </div>
            <Field label="Mensaje al pedir una unidad" hint="Usa {iso} {type} {cat} {price}.">
              <textarea rows={3} value={copy.whatsappMessage} onChange={(e) => set("whatsappMessage", e.target.value)} />
            </Field>
            <Field label="Mensaje del carrito" hint="Usa {isos}.">
              <textarea rows={2} value={copy.whatsappCartMessage} onChange={(e) => set("whatsappCartMessage", e.target.value)} />
            </Field>
          </div>

          <div className="panel">
            <h3>Pie de página y cookies</h3>
            <div className="form-grid">
              <Field label="Empresa"><input value={copy.company} onChange={(e) => set("company", e.target.value)} /></Field>
              <Field label="Teléfono"><input value={copy.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label="Correo"><input value={copy.email} onChange={(e) => set("email", e.target.value)} /></Field>
            </div>
            <Field label="Dirección"><input value={copy.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Copyright"><input value={copy.copyright} onChange={(e) => set("copyright", e.target.value)} /></Field>
            <Field label="Crédito"><input value={copy.credit} onChange={(e) => set("credit", e.target.value)} /></Field>
            <Field label="URL del crédito"><input value={copy.creditUrl} onChange={(e) => set("creditUrl", e.target.value)} /></Field>
            <Field label="Facebook"><input value={copy.facebook} onChange={(e) => set("facebook", e.target.value)} /></Field>
            <Field label="Instagram"><input value={copy.instagram} onChange={(e) => set("instagram", e.target.value)} /></Field>
            <Field label="Aviso de cookies"><textarea rows={2} value={copy.cookieText} onChange={(e) => set("cookieText", e.target.value)} /></Field>
            <Field label="Botón cookies"><input value={copy.cookieAccept} onChange={(e) => set("cookieAccept", e.target.value)} /></Field>
          </div>

          <div className="panel">
            <h3>Páginas legales</h3>
            <p className="section-sub">Títulos de los enlaces del pie y el texto de cada página. Separa párrafos con una línea en blanco.</p>
            <Field label="Términos — título"><input value={copy.legalTerms} onChange={(e) => set("legalTerms", e.target.value)} /></Field>
            <Field label="Términos — texto"><textarea rows={5} value={copy.legalTermsBody} onChange={(e) => set("legalTermsBody", e.target.value)} /></Field>
            <Field label="Cookies — título"><input value={copy.legalCookies} onChange={(e) => set("legalCookies", e.target.value)} /></Field>
            <Field label="Cookies — texto"><textarea rows={4} value={copy.legalCookiesBody} onChange={(e) => set("legalCookiesBody", e.target.value)} /></Field>
            <Field label="Privacidad — título"><input value={copy.legalPrivacy} onChange={(e) => set("legalPrivacy", e.target.value)} /></Field>
            <Field label="Privacidad — texto"><textarea rows={4} value={copy.legalPrivacyBody} onChange={(e) => set("legalPrivacyBody", e.target.value)} /></Field>
            <Field label="Datos personales — título"><input value={copy.legalData} onChange={(e) => set("legalData", e.target.value)} /></Field>
            <Field label="Datos personales — texto"><textarea rows={4} value={copy.legalDataBody} onChange={(e) => set("legalDataBody", e.target.value)} /></Field>
          </div>

          <div className="action-row">
            <button className="btn-primary" type="button" disabled={busy} onClick={save}>Guardar y publicar</button>
            <Link className="btn-ghost" to="/" target="_blank" rel="noreferrer">Abrir catálogo real</Link>
          </div>
        </div>
        <aside className="copy-preview-col">
          <ClientPreview copy={copy} />
        </aside>
      </div>
    </>
  );
}
