import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ROLE_DESC, ROLE_LABELS, useAuth } from "../auth.jsx";
import { publicUrl } from "../api.js";
import Home from "./Home.jsx";
import Inventory from "./Inventory.jsx";
import Masters from "./Masters.jsx";
import People from "./People.jsx";
import ConfigPage from "./ConfigPage.jsx";
import AuditPage from "./AuditPage.jsx";
import ComingSoon from "./ComingSoon.jsx";
import Compras from "./Compras.jsx";
import Recepcion from "./Recepcion.jsx";
import Patio from "./Patio.jsx";
import QuotesHub from "./QuotesHub.jsx";
import CatalogMedia from "./CatalogMedia.jsx";
import Profile from "./Profile.jsx";

function allowed(nav, pathname, role) {
  if ((role === "admin" || role === "compras") && pathname.startsWith("/app/compras")) return true;
  if ((role === "admin" || role === "almacen") && (pathname.startsWith("/app/almacen/recepcion") || pathname.startsWith("/app/almacen/patio"))) return true;
  return nav.some((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/")));
}

export default function Shell() {
  const { user, nav, logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    document.body.classList.toggle("nav-locked", menuOpen);
    return () => document.body.classList.remove("nav-locked");
  }, [menuOpen]);

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  const links = (
    <>
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
      <NavLink to="/app/perfil" className={({ isActive }) => `navtab ${isActive ? "active-link" : ""}`}>Mi perfil</NavLink>
    </>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" />
          </div>
          <nav className="navtabs navtabs-desktop">{links}</nav>
          <div className="topbar-tools">
            <span className="badge-role">{ROLE_LABELS[user.role]}</span>
            <span className="topbar-user">{user.name}</span>
            <button className="btn-primary btn-salir" type="button" onClick={onLogout}>Salir</button>
            <button
              type="button"
              className={`menu-toggle ${menuOpen ? "open" : ""}`}
              aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
        {menuOpen ? (
          <>
            <button type="button" className="nav-backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />
            <nav className="nav-drawer open">
              <div className="nav-drawer-head">
                <b>{user.name}</b>
                <span className="badge-role">{ROLE_LABELS[user.role]}</span>
              </div>
              {links}
              <button className="btn-primary" type="button" onClick={onLogout}>Salir</button>
            </nav>
          </>
        ) : null}
      </header>

      <div className="page">
        <div className="role-desc">{ROLE_DESC[user.role]}</div>
        <Routes>
          <Route index element={<Home />} />
          <Route path="perfil" element={<Profile />} />
          <Route path="inventario" element={<Gate nav={nav} role={user.role} path="/app/inventario"><Inventory /></Gate>} />
          <Route path="personas" element={<Gate nav={nav} role={user.role} path="/app/personas"><People /></Gate>} />
          <Route path="maestros" element={<Gate nav={nav} role={user.role} path="/app/maestros"><Masters /></Gate>} />
          <Route path="configuracion" element={<Gate nav={nav} role={user.role} path="/app/configuracion"><ConfigPage /></Gate>} />
          <Route path="auditoria" element={<Gate nav={nav} role={user.role} path="/app/auditoria"><AuditPage /></Gate>} />
          <Route path="precios" element={<Gate nav={nav} role={user.role} path="/app/precios"><ConfigPage /></Gate>} />
          <Route path="equipo" element={<Gate nav={nav} role={user.role} path="/app/equipo"><ComingSoon title="Desempeño del equipo" sprint="9" /></Gate>} />
          <Route path="bandeja" element={<Gate nav={nav} role={user.role} path="/app/bandeja"><QuotesHub /></Gate>} />
          <Route path="negociacion" element={<Gate nav={nav} role={user.role} path="/app/negociacion"><QuotesHub /></Gate>} />
          <Route path="pagos" element={<Gate nav={nav} role={user.role} path="/app/pagos"><QuotesHub /></Gate>} />
          <Route path="seguimiento" element={<Gate nav={nav} role={user.role} path="/app/seguimiento"><QuotesHub /></Gate>} />
          <Route path="alquileres" element={<Gate nav={nav} role={user.role} path="/app/alquileres"><ComingSoon title="Contratos de alquiler" sprint="5" /></Gate>} />
          <Route path="compras/facturas" element={<Gate nav={nav} role={user.role} path="/app/compras/facturas"><Compras /></Gate>} />
          <Route path="compras/extras" element={<Gate nav={nav} role={user.role} path="/app/compras/extras"><Compras /></Gate>} />
          <Route path="compras/dam" element={<Gate nav={nav} role={user.role} path="/app/compras/dam"><Compras /></Gate>} />
          <Route path="almacen/recepcion" element={<Gate nav={nav} role={user.role} path="/app/almacen/recepcion"><Recepcion /></Gate>} />
          <Route path="almacen/patio" element={<Gate nav={nav} role={user.role} path="/app/almacen/patio"><Patio /></Gate>} />
          <Route path="almacen/despachos" element={<Gate nav={nav} role={user.role} path="/app/almacen/despachos"><ComingSoon title="Despachos" sprint="6" /></Gate>} />
          <Route path="catalogo-media" element={<Gate nav={nav} role={user.role} path="/app/catalogo-media"><CatalogMedia /></Gate>} />
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
