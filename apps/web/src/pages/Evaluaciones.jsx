import { useEffect, useState } from "react";
import { api, ApiError } from "../api.js";

const LEVELS = [
  { key: "malo", label: "Malo" },
  { key: "regular", label: "Regular" },
  { key: "bueno", label: "Bueno" },
  { key: "excelente", label: "Excelente" },
];

function blankRule() {
  return { id: `r-${Date.now()}`, fromCat: "ASIS", minAverage: 2, toCat: "WWT" };
}

export default function Evaluaciones() {
  const [categories, setCategories] = useState([]);
  const [points, setPoints] = useState({ malo: 1, regular: 2, bueno: 4, excelente: 5 });
  const [rules, setRules] = useState([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/catalog-media/meta").then((meta) => setCategories(meta.categories || [])).catch(() => {});
    api("/evaluation/offer-rules")
      .then((config) => {
        setPoints(config.points || { malo: 1, regular: 2, bueno: 4, excelente: 5 });
        setRules(Array.isArray(config.rules) ? config.rules : []);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : e.message));
  }, []);

  function label(code) {
    if (code === "*") return "Cualquier condición que no sea nuevo";
    return categories.find((c) => c.code === code)?.label || code;
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const saved = await api("/evaluation/offer-rules", {
        method: "PUT",
        body: { points, rules },
      });
      setPoints(saved.points);
      setRules(saved.rules);
      setMsg("Reglas guardadas. Las unidades sin condición fijada a mano vuelven a calcularse.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view active">
      <div className="page-head">
        <div>
          <h2>Evaluaciones</h2>
          <p className="section-sub">El promedio sale de los conceptos evaluados. Si no hay evaluación, el equipo se queda en su condición. Si el promedio alcanza una regla, el precio usa la condición superior y se conserva la anterior.</p>
        </div>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      <form className="panel" onSubmit={save}>
        <h3>Puntos de cada nivel</h3>
        <div className="form-grid">
          {LEVELS.map((level) => (
            <div key={level.key}>
              <label>{level.label}</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={points[level.key] ?? ""}
                onChange={(e) => setPoints({ ...points, [level.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <h3 style={{ marginTop: 18 }}>Salto de condición</h3>
        <p className="section-sub">Si el promedio llega al mínimo y la condición documental coincide, el precio pasa a la condición destino. Si coinciden varias, gana la de promedio más alto. No baja de condición ni cambia un nuevo.</p>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Desde</th>
                <th>Promedio mínimo</th>
                <th>Pasa a</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <select
                      value={rule.fromCat}
                      aria-label={`Desde ${label(rule.fromCat)}`}
                      onChange={(e) => setRules(rules.map((row) => row.id === rule.id ? { ...row, fromCat: e.target.value } : row))}
                    >
                      <option value="*">Cualquier condición que no sea nuevo</option>
                      {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={rule.minAverage}
                      aria-label="Promedio mínimo"
                      onChange={(e) => setRules(rules.map((row) => row.id === rule.id ? { ...row, minAverage: e.target.value } : row))}
                    />
                  </td>
                  <td>
                    <select
                      value={rule.toCat}
                      aria-label={`Pasa a ${label(rule.toCat)}`}
                      onChange={(e) => setRules(rules.map((row) => row.id === rule.id ? { ...row, toCat: e.target.value } : row))}
                    >
                      {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className="btn-ghost" type="button" onClick={() => setRules(rules.filter((row) => row.id !== rule.id))}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button className="btn-ghost" type="button" onClick={() => setRules([...rules, blankRule()])}>Agregar regla</button>
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar reglas"}</button>
        </div>
      </form>
    </div>
  );
}
