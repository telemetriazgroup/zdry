import { useEffect, useState } from "react";
import { api } from "./api.js";

const SNOOZE_KEY = "zdry.odooLinkSnooze";
const SNOOZE_MS = 5 * 60 * 1000;

export function useOdooLink() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);

  async function reload() {
    const next = await api("/odoo-link/me");
    setStatus(next);
    return next;
  }

  useEffect(() => {
    let timer = 0;
    function due(st) {
      if (!st?.required || st.open) {
        setOpen(false);
        return;
      }
      const until = Number(sessionStorage.getItem(SNOOZE_KEY) || 0);
      setOpen(Date.now() >= until);
    }
    reload().then(due).catch(() => {});
    timer = window.setInterval(() => {
      reload().then(due).catch(() => {});
    }, 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  function snooze() {
    sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setOpen(false);
  }

  return { status, open, snooze, reload, setStatus };
}

export function OdooKeySteps() {
  return (
    <ol className="odoo-steps">
      <li>Entra a Odoo con tu usuario. El login tiene que ser el mismo correo de ZDRY.</li>
      <li>Arriba a la derecha, abre tu nombre y entra a <b>Preferencias</b>.</li>
      <li>Abre la pestaña <b>Seguridad de la cuenta</b>.</li>
      <li>En <b>Claves API</b>, pulsa <b>Nueva clave API</b>. Ponle un nombre, por ejemplo ZDRY, y confirma con tu contraseña de Odoo.</li>
      <li>Copia la clave en ese momento. Odoo no la vuelve a mostrar.</li>
      <li>Pégala aquí, junto con tu correo, y pulsa <b>Probar conexión</b>.</li>
    </ol>
  );
}

export function OdooLinkForm({ status, onDone, showSteps = true }) {
  const [email, setEmail] = useState(status?.email || "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status?.email) setEmail(status.email);
  }, [status?.email]);

  async function test(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api("/odoo-link/test", { method: "POST", body: { email, apiKey } });
      setApiKey("");
      onDone?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  return (
    <form onSubmit={test}>
      {showSteps ? (
        <>
          <p className="odoo-steps-title">Cómo sacar tu clave en Odoo</p>
          <OdooKeySteps />
        </>
      ) : null}
      <div className="form-grid">
        <div>
          <label>Correo (login de Odoo)</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label>Clave API</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" required />
        </div>
      </div>
      {status.cutoverPending ? (
        <p className="err">El superadmin cambió el Odoo activo. Crea la clave en ese Odoo y vuelve a probar.</p>
      ) : null}
      {status.status === "active" ? <p className="ok-msg">Conexión activa{status.odooName ? ` · ${status.odooName}` : ""}{status.companyName ? ` · ${status.companyName}` : ""}.</p> : null}
      {status.status === "exempt" ? <p className="ok-msg">El superadmin te eximió: tus cambios salen con la cuenta principal de Odoo.</p> : null}
      {error ? <div className="err">{error}</div> : null}
      {status.lastError && status.status === "failed" ? <div className="err">{status.lastError}</div> : null}
      <div className="action-row" style={{ marginTop: 10 }}>
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Probando…" : "Probar conexión"}</button>
      </div>
    </form>
  );
}

export function OdooLinkModal({ status, onClose, onDone }) {
  return (
    <div className="overlay open odoo-link-overlay" role="dialog" aria-modal="true" aria-labelledby="odoo-link-title">
      <div className="modal odoo-link-modal">
        <div className="modal-head">
          <h3 id="odoo-link-title">Conecta tu clave API de Odoo</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body single">
          <p className="section-sub">Sin esta clave no puedes ver ni cambiar lo que sale de Odoo. Si cierras el aviso, vuelve en 5 minutos.</p>
          <OdooLinkForm status={status} onDone={onDone} />
        </div>
      </div>
    </div>
  );
}

export function OdooNavStatus({ status }) {
  if (!status) return null;
  const mode = status.mode === "production" ? "Producción" : status.mode === "staging" ? "Staging" : "Sin modo";
  const conn = !status.required
    ? null
    : status.status === "active"
      ? "Conectado"
      : status.status === "exempt"
        ? "Exento"
        : status.status === "failed"
          ? "Falló"
          : "Sin vínculo";
  return (
    <span className={`odoo-nav odoo-nav-${status.mode || "none"}`} title={conn ? `Odoo ${mode}. Tu conexión: ${conn}` : `Odoo ${mode}`}>
      <b>Odoo {mode}</b>
      {conn ? <span>{conn}</span> : null}
    </span>
  );
}
