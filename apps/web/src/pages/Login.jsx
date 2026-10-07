import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { homeFor, useAuth } from "../auth.jsx";
import { api, ApiError, publicUrl } from "../api.js";

const REMEMBER_KEY = "zdry_login_email";

function safeNext(raw, user) {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return homeFor(user);
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconEye({ off }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      {off ? <path d="M5 5l14 14" stroke="currentColor" strokeWidth="1.7" /> : null}
    </svg>
  );
}

export default function Login() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [accountsOn, setAccountsOn] = useState(false);
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const registering = mode === "register" && accountsOn;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      /* almacenamiento no disponible */
    }
  }, []);

  useEffect(() => {
    api("/catalog-shares/commerce")
      .then((c) => {
        const on = c?.accountsEnabled === true;
        setAccountsOn(on);
        if (on && params.get("intent") === "quote") setMode("register");
      })
      .catch(() => setAccountsOn(false));
  }, [params]);

  function keepEmail() {
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* almacenamiento no disponible */
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    try {
      const user = registering
        ? await register({ email, password, name, phone })
        : await login(email, password);
      keepEmail();
      nav(safeNext(params.get("next"), user));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setPending(false);
    }
  }

  async function forgot() {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Escribe tu correo para recuperar la contraseña.");
      return;
    }
    setPending(true);
    try {
      const res = await api("/auth/forgot-password", { method: "POST", body: { email } });
      setNotice(res?.message || "Si el correo existe, enviaremos instrucciones.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar la recuperación");
    } finally {
      setPending(false);
    }
  }

  function toggleRegister() {
    setError("");
    setNotice("");
    if (!accountsOn) {
      setNotice("La creación de cuentas está desactivada. El comercial te comparte un enlace y coordinan por WhatsApp.");
      return;
    }
    setMode(mode === "login" ? "register" : "login");
  }

  return (
    <div className="login-wrap">
      <div className="login-shell">
        <aside className="login-hero">
          <img
            src={publicUrl("/brand/login-hero.jpg")}
            alt="ZDRY. Espacio que impulsa tu negocio. Venta y alquiler de contenedores, calidad garantizada y almacén en el Callao."
          />
        </aside>
        <form className="login-card" onSubmit={submit}>
          <div className="login-locale" title="El sistema está en español">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M3 12h18M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            ES
          </div>
          <img className="login-mark" src={publicUrl("/brand/login-wordmark.png")} alt="ZDRY. Venta y alquiler de contenedores" />
          <h1>{registering ? "Crea tu cuenta" : "Bienvenido de nuevo"}</h1>
          <p className="login-lead">
            {registering
              ? "Para cotizar validaremos tu RUC en SUNAT. La cuenta solo pide contacto y correo."
              : "Ingresa tus credenciales para continuar"}
          </p>
          {registering ? (
            <>
              <label htmlFor="login-name">Persona de contacto</label>
              <div className="login-field">
                <input id="login-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
              <label htmlFor="login-phone">Teléfono</label>
              <div className="login-field">
                <input id="login-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" />
              </div>
            </>
          ) : null}
          <label htmlFor="login-email">Correo</label>
          <div className="login-field">
            <IconMail />
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ejemplo@zgroup.com"
              required
              autoComplete="username"
            />
          </div>
          <label htmlFor="login-password">Contraseña</label>
          <div className="login-field">
            <IconLock />
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={registering ? "new-password" : "current-password"}
            />
            <button
              type="button"
              className="login-eye"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              <IconEye off={showPassword} />
            </button>
          </div>
          {registering ? null : (
            <div className="login-row">
              <label className="login-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Recordar mi cuenta
              </label>
              <button type="button" className="login-forgot" onClick={forgot} disabled={pending}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}
          {error ? <div className="err">{error}</div> : null}
          {notice ? <div className="login-notice">{notice}</div> : null}
          <button className="login-submit" type="submit" disabled={pending}>
            {pending ? "…" : registering ? "Crear cuenta" : "Ingresar"}
          </button>
          <div className="login-or" aria-hidden="true">o</div>
          <p className="login-foot">
            {registering ? "¿Ya tienes una cuenta? " : "¿No tienes una cuenta? "}
            <button type="button" onClick={toggleRegister}>
              {registering ? "Ingresa aquí" : "Regístrate aquí"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
