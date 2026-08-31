import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, homeFor, useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Shell from "./pages/Shell.jsx";
import Catalog from "./pages/Catalog.jsx";
import Account from "./pages/Account.jsx";

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
