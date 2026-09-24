import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, apiUrl } from "./api.js";

const AuthContext = createContext(null);

export const ROLE_LABELS = {
  superadmin: "Superadmin",
  admin: "Administrador Total",
  gerente: "Gerente de Ventas",
  vendedor: "Vendedor / Comercial",
  compras: "Compras / Costos",
  coordinador: "Coordinador de despacho",
  almacen: "Almacén / Operador de campo",
  cliente: "Cliente",
};

export function isSuperadmin(user) {
  return user?.role === "superadmin";
}

/** Superadmin puede todo. El resto solo si su rol está en la lista. */
export function hasRole(user, ...roles) {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  return roles.includes(user.role);
}

export const ROLE_DESC = {
  superadmin: "Acceso total. Único que puede entrar como otro usuario. También integra Odoo, textos, demo, auditoría y respaldos.",
  admin: "Ve inventario con costo real, personas, maestros, configuración, regularización Odoo y publicación del catálogo.",
  gerente: "Define reglas de precio y visibilidad. No ve FOB ni C_T.",
  vendedor: "Cotiza, valida comprobantes y confirma asignación. Nunca ve el costo real.",
  compras: "Facturas de compra, conciliar reentrega con OC/IN, deuda Odoo, extras y DAM. Ve costos de adquisición.",
  coordinador: "Alta de reentrega, visitas de puerta, ficha, imágenes y conciliación del ingreso de Odoo con la unidad de patio. No publica el catálogo ni ve tarifas.",
  almacen: "Patio de campo: lista de visitas y DRY, fotos, video, diagnóstico y registro de emergencia si el contenedor no está. No ve Odoo ni precios.",
  cliente: "Reserva, negocia descuento con tu comercial y sube el comprobante de pago.",
};

export const ROLE_NAV = {
  superadmin: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/integraciones", label: "Integración Odoo" },
    { to: "/app/estadistica-dry", label: "Estadística DRY" },
    { to: "/app/almacen/odoo", label: "Odoo — regularizar" },
    { to: "/app/catalogo-textos", label: "Textos del catálogo" },
    { to: "/app/configuracion", label: "Configuración" },
    { to: "/app/auditoria", label: "Auditoría" },
    { to: "/app/respaldo", label: "Respaldo y recuperación" },
  ],
  admin: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/inventario", label: "Inventario y costos" },
    { to: "/app/personas", label: "Personas" },
    { to: "/app/maestros", label: "Maestros" },
    { to: "/app/configuracion", label: "Configuración" },
    { to: "/app/compras/facturas", label: "Compras" },
    { to: "/app/almacen/recepcion", label: "Recepción" },
    { to: "/app/almacen/odoo", label: "Odoo — regularizar" },
    { to: "/app/almacen/campo", label: "Patio — campo" },
    { to: "/app/almacen/patio", label: "Patio" },
    { to: "/app/catalogo-media", label: "Ficha catálogo" },
  ],
  gerente: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/precios", label: "Reglas de precio" },
    { to: "/app/equipo", label: "Equipo" },
    { to: "/app/configuracion", label: "Configuración" },
    { to: "/app/catalogo-media", label: "Ficha catálogo" },
  ],
  vendedor: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/inventario", label: "Inventario" },
    { to: "/app/bandeja", label: "Bandeja" },
    { to: "/app/negociacion", label: "Negociación" },
    { to: "/app/pagos", label: "Pagos por validar" },
    { to: "/app/seguimiento", label: "Seguimiento" },
    { to: "/app/enlaces-catalogo", label: "Enlaces catálogo" },
    { to: "/app/alquileres", label: "Alquileres" },
  ],
  compras: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/compras/facturas", label: "Facturas de compra" },
    { to: "/app/compras/conciliar", label: "Conciliar reentrega" },
    { to: "/app/compras/odoo", label: "Deuda Odoo" },
    { to: "/app/compras/extras", label: "Costos adicionales" },
    { to: "/app/compras/dam", label: "Nacionalización (DAM)" },
    { to: "/app/catalogo-media", label: "Ficha catálogo" },
  ],
  coordinador: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/compras/conciliar", label: "Conciliar ingresos" },
    { to: "/app/almacen/recepcion", label: "Recepción" },
    { to: "/app/almacen/visitas", label: "Visitas" },
    { to: "/app/almacen/campo", label: "Patio — campo" },
    { to: "/app/almacen/patio", label: "Patio" },
  ],
  almacen: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/almacen/campo", label: "Patio — campo" },
    { to: "/app/almacen/patio", label: "Patio" },
    { to: "/app/almacen/despachos", label: "Despachos" },
  ],
  cliente: [],
};

function uniqueNav(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const item of list || []) {
      if (seen.has(item.to)) continue;
      seen.add(item.to);
      out.push(item);
    }
  }
  return out;
}

ROLE_NAV.superadmin = uniqueNav([
  ROLE_NAV.superadmin,
  ROLE_NAV.admin,
  ROLE_NAV.gerente,
  ROLE_NAV.vendedor,
  ROLE_NAV.compras,
  ROLE_NAV.coordinador,
  ROLE_NAV.almacen,
]);

export function homeFor(user) {
  if (!user) return "/";
  if (user.role === "cliente") return "/mi-cuenta";
  return "/app";
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [avatarRev, setAvatarRev] = useState(0);

  useEffect(() => {
    api("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      avatarRev,
      avatarUrl: user?.hasAvatar ? `${apiUrl("/auth/avatar")}?t=${avatarRev || user.id}` : null,
      nav: user ? ROLE_NAV[user.role] || [] : [],
      async login(email, password) {
        const d = await api("/auth/login", { method: "POST", body: { email, password } });
        setUser(d.user);
        setAvatarRev(Date.now());
        return d.user;
      },
      async register(body) {
        const d = await api("/auth/register", { method: "POST", body });
        setUser(d.user);
        setAvatarRev(Date.now());
        return d.user;
      },
      async refreshUser(next) {
        const u = next?.id ? next : (await api("/auth/me")).user;
        setUser(u);
        setAvatarRev(Date.now());
        return u;
      },
      async impersonate(userId) {
        const d = await api("/auth/impersonate", { method: "POST", body: { userId } });
        setUser(d.user);
        setAvatarRev(Date.now());
        return d.user;
      },
      async stopImpersonation() {
        const d = await api("/auth/stop-impersonate", { method: "POST", body: {} });
        setUser(d.user);
        setAvatarRev(Date.now());
        return d.user;
      },
      async logout() {
        try {
          await api("/auth/logout", { method: "POST" });
        } catch {
          await fetch(apiUrl("/auth/logout-all"), { method: "POST", credentials: "include" });
        }
        setUser(null);
        setAvatarRev(0);
      },
    }),
    [user, ready, avatarRev],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
