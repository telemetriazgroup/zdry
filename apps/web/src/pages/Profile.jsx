import { useState } from "react";
import { api, apiUpload, ApiError } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Profile() {
  const { user, refreshUser, avatarUrl } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const initials = (user?.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

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

  async function uploadPhoto(file) {
    if (!file) return;
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const u = await apiUpload("/auth/avatar", fd);
      await refreshUser(u);
      setMsg("Foto actualizada.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  async function removePhoto() {
    setError("");
    try {
      const u = await api("/auth/avatar", { method: "DELETE" });
      await refreshUser(u);
      setMsg("Foto quitada.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Mi perfil</h2>
      <p className="section-sub">Nombre, correo, clave y foto (opcional).</p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>Foto</h3>
        <div className="profile-photo-row">
          {avatarUrl ? (
            <img className="profile-avatar" src={avatarUrl} alt={user.name} />
          ) : (
            <span className="profile-avatar avatar-fallback">{initials}</span>
          )}
          <div>
            <p className="section-sub">JPG, PNG, WEBP o GIF. Máximo 4 MB.</p>
            <label className="btn-ghost" style={{ display: "inline-block", marginTop: 8 }}>
              {avatarUrl ? "Cambiar foto" : "Subir foto"}
              <input type="file" accept="image/*" hidden onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {avatarUrl ? (
              <button className="btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={removePhoto}>Quitar foto</button>
            ) : null}
          </div>
        </div>
      </div>

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
