import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Shell from "./pages/Shell.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/app/*" element={<Shell />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
