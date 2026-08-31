import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, homeFor, ROLE_LABELS, useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Shell from "./pages/Shell.jsx";
import Catalog from "./pages/Catalog.jsx";
import Account from "./pages/Account.jsx";
import { apiUrl } from "./api.js";

function DemoBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    fetch(apiUrl("/demo/public-status"), { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setOn(!!d.on))
      .catch(() => {});
  }, []);
  if (!on) return null;
  return (
    <div className="demo-bar">
      Modo demostración activo — los datos etiquetados como demo conviven con producción. El superusuario lo apaga en Configuración.
    </div>
  );
}

function ImpersonationBar() {
  const { user, stopImpersonation } = useAuth();
  const nav = useNavigate();
  if (!user?.impersonator) return null;
  return (
    <div className="impersonation-bar">
      <span>
        Viendo como <b>{user.name}</b> ({ROLE_LABELS[user.role]}). Sesión real: {user.impersonator.name}.
      </span>
      <button
        type="button"
        onClick={async () => {
          const u = await stopImpersonation();
          nav(homeFor(u));
        }}
      >
        Volver a mi sesión
      </button>
    </div>
  );
}

function StaffGuard({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "cliente") return <Navigate to="/mi-cuenta" replace />;
  return children;
}

function ClientGuard({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "cliente") return <Navigate to="/app" replace />;
  return children;
}

function Guest({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (user) return <Navigate to={homeFor(user)} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <DemoBanner />
      <ImpersonationBar />
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/u/:iso" element={<Catalog />} />
        <Route path="/login" element={<Guest><Login /></Guest>} />
        <Route path="/mi-cuenta" element={<ClientGuard><Account /></ClientGuard>} />
        <Route path="/app/*" element={<StaffGuard><Shell /></StaffGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
