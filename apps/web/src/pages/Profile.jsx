import { useState } from "react";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function save(e) {
    e.preventDefault();
    setError("");
    try {
      const u = await api("/auth/profile", { method: "PUT", body: { name, email } });
      await refreshUser(u);
      setMsg("Datos guardados.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/auth/password", { method: "POST", body: { currentPassword, newPassword } });
      setCurrentPassword("");
      setNewPassword("");
      setMsg("Clave actualizada.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Mi perfil</h2>
      <p className="section-sub">Actualiza tu nombre, correo y clave. Nadie más ve tu clave.</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Datos</h3>
        <form className="form-grid" onSubmit={save}>
          <div><label>Nombre</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><label>Correo</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <button className="btn-primary" type="submit">Guardar</button>
        </form>
      </div>

      <div className="panel">
        <h3>Cambiar clave</h3>
        {user?.impersonator ? (
          <p className="section-sub">En una sesión asistida no se cambia la clave de este usuario. Restablécela en Personas o pide que lo haga él.</p>
        ) : (
          <form className="form-grid" onSubmit={savePassword}>
            <div><label>Clave actual</label><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></div>
            <div><label>Nueva clave (mín. 8)</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></div>
            <button className="btn-primary" type="submit">Cambiar clave</button>
          </form>
        )}
      </div>
    </>
  );
}
