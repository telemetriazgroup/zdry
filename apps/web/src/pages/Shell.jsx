import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ROLE_DESC, ROLE_LABELS, useAuth } from "../auth.jsx";
import Home from "./Home.jsx";
import Inventory from "./Inventory.jsx";
import Masters from "./Masters.jsx";
import People from "./People.jsx";
import ConfigPage from "./ConfigPage.jsx";
import AuditPage from "./AuditPage.jsx";
import ComingSoon from "./ComingSoon.jsx";
import Compras from "./Compras.jsx";

function allowed(nav, pathname, role) {
  if ((role === "admin" || role === "compras") && pathname.startsWith("/app/compras")) return true;
  return nav.some((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/")));
}

export default function Shell() {
  const { user, nav, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src="/brand/LOGO_Z.png" alt="ZDRY" />
          </div>
          <nav className="navtabs">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `navtab ${isActive ? "active-link" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="badge-role">{ROLE_LABELS[user.role]}</span>
            <span style={{ fontSize: 12, color: "#c7cede" }}>{user.name}</span>
            <button className="btn-primary" type="button" onClick={onLogout}>Salir</button>
          </div>
        </div>
      </header>

      <div className="page">
        <div className="role-desc">{ROLE_DESC[user.role]}</div>
        <Routes>
          <Route index element={<Home />} />
          <Route path="inventario" element={<Gate nav={nav} role={user.role} path="/app/inventario"><Inventory /></Gate>} />
          <Route path="personas" element={<Gate nav={nav} role={user.role} path="/app/personas"><People /></Gate>} />
          <Route path="maestros" element={<Gate nav={nav} role={user.role} path="/app/maestros"><Masters /></Gate>} />
          <Route path="configuracion" element={<Gate nav={nav} role={user.role} path="/app/configuracion"><ConfigPage /></Gate>} />
          <Route path="auditoria" element={<Gate nav={nav} role={user.role} path="/app/auditoria"><AuditPage /></Gate>} />
          <Route path="precios" element={<Gate nav={nav} role={user.role} path="/app/precios"><ComingSoon title="Reglas de precio" sprint="4 y 9" /></Gate>} />
          <Route path="equipo" element={<Gate nav={nav} role={user.role} path="/app/equipo"><ComingSoon title="Desempeño del equipo" sprint="9" /></Gate>} />
          <Route path="bandeja" element={<Gate nav={nav} role={user.role} path="/app/bandeja"><ComingSoon title="Bandeja de cotizaciones" sprint="4" /></Gate>} />
          <Route path="negociacion" element={<Gate nav={nav} role={user.role} path="/app/negociacion"><ComingSoon title="Negociación de descuento" sprint="4" /></Gate>} />
          <Route path="pagos" element={<Gate nav={nav} role={user.role} path="/app/pagos"><ComingSoon title="Pagos por validar" sprint="4" /></Gate>} />
          <Route path="seguimiento" element={<Gate nav={nav} role={user.role} path="/app/seguimiento"><ComingSoon title="Seguimiento de cotizaciones" sprint="4" /></Gate>} />
          <Route path="alquileres" element={<Gate nav={nav} role={user.role} path="/app/alquileres"><ComingSoon title="Contratos de alquiler" sprint="5" /></Gate>} />
          <Route path="compras/facturas" element={<Gate nav={nav} role={user.role} path="/app/compras/facturas"><Compras /></Gate>} />
          <Route path="compras/extras" element={<Gate nav={nav} role={user.role} path="/app/compras/extras"><Compras /></Gate>} />
          <Route path="compras/dam" element={<Gate nav={nav} role={user.role} path="/app/compras/dam"><Compras /></Gate>} />
          <Route path="almacen/recepcion" element={<Gate nav={nav} role={user.role} path="/app/almacen/recepcion"><ComingSoon title="Recepción e inspección" sprint="3" /></Gate>} />
          <Route path="almacen/patio" element={<Gate nav={nav} role={user.role} path="/app/almacen/patio"><ComingSoon title="Layout de patio" sprint="3" /></Gate>} />
          <Route path="almacen/despachos" element={<Gate nav={nav} role={user.role} path="/app/almacen/despachos"><ComingSoon title="Despachos" sprint="6" /></Gate>} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </div>
    </>
  );
}

function Gate({ nav, role, path, children }) {
  if (!allowed(nav, path, role)) {
    return (
      <div className="panel">
        <h3>403 — Sin acceso</h3>
        <p className="section-sub">Esta pantalla no corresponde a tu rol. El API también responde 403 si se llama por fuera.</p>
      </div>
    );
  }
  return children;
}
