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
      <p className="section-sub">Sesión real. El menú de la izquierda es el de tu cuenta; no hay cambio de rol con un clic.</p>
      <div className="tile-row">
        <div className="tile"><div className="v">{user.name.split(" ")[0]}</div><div className="l">{user.email}</div></div>
        <div className="tile"><div className="v">{health?.ok ? "OK" : "…"}</div><div className="l">API</div></div>
        <div className="tile"><div className="v">{health?.odoo === "enabled" ? "Odoo" : "Noop"}</div><div className="l">Conector contable</div></div>
      </div>
      <p className="section-sub" style={{ marginTop: 16 }}>
        El catálogo público está en <a href="/" style={{ color: "var(--orange)", fontWeight: 700 }}>/</a>.
        {user.role === "vendedor" ? " Usa Bandeja → Negociación → Pagos → Seguimiento para el cierre por comprobante." : ""}
        {user.role === "superadmin" ? " Desde el menú configuras Odoo, buscas DRY a la mano, editas los textos del catálogo y gestionas los respaldos internos." : ""}
        {user.role === "admin" ? " Regulariza DRY de Odoo en Odoo — regularizar y asigna fotos del chatter a las casillas del catálogo en Recepción." : ""}
        {user.role === "almacen" ? " Si ves un DRY habilitado, abre Patio — campo: sube fotos o notas. No ves ni editas Odoo. Quien publica evalúa." : ""}
        {user.role === "coordinador" ? " En Recepción das de alta la reentrega y la envías a campo. Completas la ficha, asignas tomas y registras actividades sin ver tarifas." : ""}
      </p>
    </>
  );
}
