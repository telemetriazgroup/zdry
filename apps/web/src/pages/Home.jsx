import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ROLE_LABELS, useAuth } from "../auth.jsx";

export default function Home() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api("/health").then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  return (
    <>
      <h2 className="section-title">Inicio — {ROLE_LABELS[user.role]}</h2>
      <p className="section-sub">Sesión real. El menú de arriba es el de tu cuenta; no hay cambio de rol con un clic.</p>
      <div className="tile-row">
        <div className="tile"><div className="v">{user.name.split(" ")[0]}</div><div className="l">{user.email}</div></div>
        <div className="tile"><div className="v">{health?.ok ? "OK" : "…"}</div><div className="l">API</div></div>
        <div className="tile"><div className="v">{health?.odoo === "enabled" ? "Odoo" : "Noop"}</div><div className="l">Conector contable</div></div>
      </div>
    </>
  );
}
