import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);

export const ROLE_LABELS = {
  admin: "Administrador Total",
  gerente: "Gerente de Ventas",
  vendedor: "Vendedor / Comercial",
  compras: "Compras / Costos",
  almacen: "Almacén / Operador",
};

export const ROLE_DESC = {
  admin: "Ve inventario con costo real, personas, maestros y configuración.",
  gerente: "Define reglas de precio y visibilidad. No ve FOB ni C_T.",
  vendedor: "Cotiza, valida comprobantes y confirma asignación. Nunca ve el costo real.",
  compras: "Facturas de compra, extras y DAM. Ve costos de adquisición.",
  almacen: "Recepción, patio y despachos. Sin precios ni costos.",
};

export const ROLE_NAV = {
  admin: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/inventario", label: "Inventario y costos" },
    { to: "/app/personas", label: "Personas" },
    { to: "/app/maestros", label: "Maestros" },
    { to: "/app/configuracion", label: "Configuración" },
    { to: "/app/auditoria", label: "Auditoría" },
    { to: "/app/compras/facturas", label: "Compras" },
  ],
  gerente: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/precios", label: "Reglas de precio" },
    { to: "/app/equipo", label: "Equipo" },
    { to: "/app/configuracion", label: "Configuración" },
  ],
  vendedor: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/inventario", label: "Inventario" },
    { to: "/app/bandeja", label: "Bandeja" },
    { to: "/app/negociacion", label: "Negociación" },
    { to: "/app/pagos", label: "Pagos por validar" },
    { to: "/app/seguimiento", label: "Seguimiento" },
    { to: "/app/alquileres", label: "Alquileres" },
  ],
  compras: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/compras/facturas", label: "Facturas de compra" },
    { to: "/app/compras/extras", label: "Costos adicionales" },
    { to: "/app/compras/dam", label: "Nacionalización (DAM)" },
  ],
  almacen: [
    { to: "/app", label: "Inicio", end: true },
    { to: "/app/almacen/recepcion", label: "Recepción" },
    { to: "/app/almacen/patio", label: "Patio" },
    { to: "/app/almacen/despachos", label: "Despachos" },
  ],
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

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
      nav: user ? ROLE_NAV[user.role] || [] : [],
      async login(email, password) {
        const d = await api("/auth/login", { method: "POST", body: { email, password } });
        setUser(d.user);
        return d.user;
      },
      async logout() {
        try {
          await api("/auth/logout", { method: "POST" });
        } catch {
          await fetch("/api/auth/logout-all", { method: "POST", credentials: "include" });
        }
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
