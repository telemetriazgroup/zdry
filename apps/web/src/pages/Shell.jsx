import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const TABS = [
  { id: "inv", label: "Inventario y costos" },
  { id: "pagos", label: "Pagos por validar" },
  { id: "neg", label: "Negociación de descuento" },
];

export default function Shell() {
  const nav = useNavigate();
  const [tab, setTab] = useState("pagos");
  const [health, setHealth] = useState(null);
  const [machine, setMachine] = useState(null);
  const email = sessionStorage.getItem("zdry-email") || "admin@zdry.pe";

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    fetch("/api/deal-close/machine").then((r) => r.json()).then(setMachine).catch(() => null);
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src="/brand/LOGO_Z.png" alt="ZDRY" />
          </div>
          <button className="navtab active" type="button">Dashboard interno</button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#c7cede" }}>{email}</span>
            <button className="btn-primary" type="button" onClick={() => { sessionStorage.clear(); nav("/login"); }}>
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="page">
        <h2 className="section-title">Dashboard interno — Sprint 0</h2>
        <p className="section-sub">
          Paleta y topbar del prototipo. El cierre comercial (comprobante → validación → asignación → despacho → Odoo) queda cableado en la API como máquina de estados.
        </p>

        <div className="tile-row" style={{ marginBottom: 18 }}>
          <div className="tile">
            <div className="v">{health?.ok ? "OK" : "…"}</div>
            <div className="l">API /health</div>
          </div>
          <div className="tile">
            <div className="v">{health?.odoo === "enabled" ? "Odoo" : "Noop"}</div>
            <div className="l">Conector contable</div>
          </div>
          <div className="tile">
            <div className="v">{machine?.statuses?.length || "—"}</div>
            <div className="l">Estados de cierre</div>
          </div>
        </div>

        <div className="subtab-row">
          {TABS.map((t) => (
            <button key={t.id} className={`subtab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)} type="button">
              {t.label}
            </button>
          ))}
        </div>

        {tab === "pagos" && (
          <div className="panel">
            <h3>Pagos por validar</h3>
            <p className="section-sub">El cliente sube el comprobante. El comercial confirma si el dinero está — el interbancario puede demorar. No se asigna el contenedor ni se mueve patio antes de eso.</p>
            <div className="locked-note">Bandeja vacía — Sprint 4 implementa upload, “en verificación”, rechazo y validación. Sprint 0 deja el contrato de estados en <code>GET /api/deal-close/machine</code>.</div>
          </div>
        )}

        {tab === "neg" && (
          <div className="panel">
            <h3>Negociación de descuento (antes del pago)</h3>
            <p className="section-sub">Durante la reserva el cliente puede hablar con un comercial para tentar un descuento. El hold de 48 h se pausa mientras el hilo está abierto. El piso de lista se respeta.</p>
            <div className="locked-note">Sin hilos todavía. El estado <code>en_negociacion</code> ya está en la máquina de cierre.</div>
          </div>
        )}

        {tab === "inv" && (
          <div className="panel">
            <h3>Inventario y costos</h3>
            <p className="section-sub">Se porta del prototipo a partir del Sprint 2–3. El vendedor nunca ve el costo real.</p>
          </div>
        )}
      </div>
    </>
  );
}
