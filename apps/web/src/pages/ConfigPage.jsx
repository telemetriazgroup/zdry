import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function ConfigPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/config/sections").then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h2 className="section-title">Configuración</h2>
      <p className="section-sub">{data?.note || "Solo Administrador y Gerente."}</p>
      {error ? <div className="err">{error}</div> : null}
      <div className="config-grid">
        {(data?.sections || []).map((s) => (
          <div className="config-card" key={s.id}>
            <h4>{s.title}</h4>
            <p>{s.blurb}</p>
            <div className="locked-note" style={{ marginTop: 8 }}>Ancla Sprint 1 — edición en sprints posteriores</div>
          </div>
        ))}
      </div>
    </>
  );
}
