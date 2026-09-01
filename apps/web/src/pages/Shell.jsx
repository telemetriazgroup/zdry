import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ROLE_DESC, ROLE_LABELS, useAuth } from "../auth.jsx";
import { publicUrl } from "../api.js";
import { NavIcon, iconFor } from "../nav-icons.jsx";
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
import CatalogCopy from "./CatalogCopy.jsx";
import Profile from "./Profile.jsx";

const SIDEBAR_KEY = "zdry.sidebarCollapsed";

function allowed(nav, pathname, role) {
  if ((role === "admin" || role === "compras") && pathname.startsWith("/app/compras")) return true;
  if ((role === "admin" || role === "almacen") && (pathname.startsWith("/app/almacen/recepcion") || pathname.startsWith("/app/almacen/patio"))) return true;
  return nav.some((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/")));
}

export default function Shell() {
  const { user, nav, logout, avatarUrl } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    document.body.classList.toggle("nav-locked", mobileOpen);
    return () => document.body.classList.remove("nav-locked");
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function onLogout() {
    await logout();
    navigate("/login");
  }

  const items = nav.map((item) => ({ ...item, icon: iconFor(item.to) }));
  const initials = (user.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const links = items.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      title={item.label}
      className={({ isActive }) => `side-link ${isActive ? "active-link" : ""}`}
    >
      <NavIcon name={item.icon} />
      <span className="nav-label">{item.label}</span>
    </NavLink>
  ));

  return (
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""} ${mobileOpen ? "sidebar-open" : ""}`}>
      {mobileOpen ? (
        <button type="button" className="nav-backdrop" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />
      ) : null}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" />
        </div>
        <nav className="sidebar-nav">{links}</nav>
        <div className="sidebar-foot">
          <button
            type="button"
            className="sidebar-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Extender menú" : "Ocultar menú"}
            title={collapsed ? "Extender menú" : "Ocultar menú"}
          >
            {collapsed ? "»" : "« Ocultar"}
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar topbar-staff">
          <div className="topbar-inner">
            <button
              type="button"
              className={`menu-toggle ${mobileOpen ? "open" : ""}`}
              aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              <span /><span /><span />
            </button>
            <div className="brand brand-mobile">
              <img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" />
            </div>
            <div className="topbar-tools account-bar">
              <NavLink to="/app/perfil" className="account-chip" title="Mi perfil">
                {avatarUrl ? (
                  <img className="avatar" src={avatarUrl} alt="" />
                ) : (
                  <span className="avatar avatar-fallback" aria-hidden>{initials}</span>
                )}
                <span className="account-meta">
                  <b className="topbar-user">{user.name}</b>
                  <span className="badge-role">{ROLE_LABELS[user.role]}</span>
                </span>
              </NavLink>
              <button className="btn-primary btn-salir" type="button" onClick={onLogout}>Salir</button>
            </div>
          </div>
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
            <Route path="almacen/despachos" element={<Gate nav={nav} role={user.role} path="/app/almacen/despachos"><Restricted title="Despachos" /></Gate>} />
            <Route path="catalogo-textos" element={<Gate nav={nav} role={user.role} path="/app/catalogo-textos"><CatalogCopy /></Gate>} />
            <Route path="catalogo-media" element={<Gate nav={nav} role={user.role} path="/app/catalogo-media"><CatalogMedia /></Gate>} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function Restricted({ title }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <p className="section-sub">Restringido</p>
    </div>
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
