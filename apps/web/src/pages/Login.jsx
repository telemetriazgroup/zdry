import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@zdry.pe");
  const [password, setPassword] = useState("");

  function submit(e) {
    e.preventDefault();
    sessionStorage.setItem("zdry-role", "admin");
    sessionStorage.setItem("zdry-email", email);
    nav("/app");
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="logo" src="/brand/LOGO_Z.png" alt="ZDRY" />
        <div className="tag">Venta y alquiler de contenedores</div>
        <label>Correo</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Sprint 0 — cualquier valor" />
        <button className="btn-primary" type="submit">Entrar al dashboard</button>
        <p className="hint">
          Sprint 0: el login visual ya usa el logo oficial. Auth real (JWT + roles) entra en el Sprint 1.
          El cierre de venta será comprobante + validación comercial, no pasarela ni SUNAT.
        </p>
      </form>
    </div>
  );
}
