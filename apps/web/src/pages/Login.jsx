import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { homeFor, useAuth } from "../auth.jsx";
import { ApiError, publicUrl } from "../api.js";

function safeNext(raw, user) {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return homeFor(user);
}

export default function Login() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get("intent") === "quote" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [rucDni, setRucDni] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const user = mode === "register"
        ? await register({ email, password, name, companyName, rucDni, phone })
        : await login(email, password);
      nav(safeNext(params.get("next"), user));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <Link to="/"><img className="logo" src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></Link>
        {mode === "register" ? (
          <>
            <p className="section-sub" style={{ textAlign: "left" }}>
              El catálogo es público. Para reservar, negociar o pagar necesitas empresa + persona de contacto.
            </p>
            <label>Empresa / razón social</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
            <label>RUC / DNI</label>
            <input value={rucDni} onChange={(e) => setRucDni(e.target.value)} required />
            <label>Persona de contacto</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
            <label>Teléfono</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </>
        ) : null}
        <label>Correo</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <label>Contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        {error ? <div className="err">{error}</div> : null}
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? "…" : mode === "register" ? "Crear cuenta" : "Entrar"}
        </button>
        <button className="link-btn" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "Ya tengo cuenta"}
        </button>
      </form>
    </div>
  );
}
