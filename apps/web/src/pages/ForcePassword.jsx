import { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function ForcePassword() {
  const { refreshUser, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Las dos claves no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const out = await api("/auth/password", { method: "POST", body: { newPassword: password } });
      await refreshUser(out.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel" onSubmit={submit} style={{ width: "min(440px, 100%)" }}>
        <h2 className="section-title">Actualiza tu clave</h2>
        <p className="section-sub">
          Tu clave fue restablecida. Para usar ZDRY elige una propia. Te sugerimos la misma que usas en Odoo, así no tienes dos contraseñas.
        </p>
        {error ? <div className="err">{error}</div> : null}
        <div>
          <label htmlFor="force-password">Nueva clave</label>
          <input id="force-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </div>
        <div style={{ marginTop: 10 }}>
          <label htmlFor="force-confirm">Confirmar clave</label>
          <input id="force-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
        </div>
        <p className="field-hint">Mínimo 8 caracteres. No puede ser la clave temporal.</p>
        <div className="action-row">
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Actualizar clave"}</button>
          <button className="btn-ghost" type="button" onClick={() => logout()}>Salir</button>
        </div>
      </form>
    </div>
  );
}
