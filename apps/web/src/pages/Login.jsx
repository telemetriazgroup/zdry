import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ApiError } from "../api.js";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@zdry.pe");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await login(email, password);
      nav("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="logo" src="/brand/LOGO_Z.png" alt="ZDRY" />
        <div className="tag">Venta y alquiler de contenedores</div>
        <label>Correo</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <label>Contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Zdry123!" />
        {error ? <div className="err">{error}</div> : null}
        <button className="btn-primary" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar al dashboard"}</button>
        <div className="demo-users">
          Usuarios seed (clave <b>Zdry123!</b>):<br />
          admin@zdry.pe · gerente@zdry.pe · vendedor@zdry.pe · compras@zdry.pe · almacen@zdry.pe
        </div>
      </form>
    </div>
  );
}
