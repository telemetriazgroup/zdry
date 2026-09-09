import { useMemo, useState } from "react";
import { formatWhen } from "./api.js";

const SOURCE = {
  patio: "Patio",
  recepcion: "Recepción",
  catalogo: "Ficha catálogo",
};

export function levelFor(ratings, conceptId) {
  return (ratings || []).find((r) => r.conceptId === conceptId) || null;
}

export function EvalGrid({ concepts = [], levels = [], ratings = [], onChange, disabled }) {
  if (!concepts.length) return <p className="section-sub">No hay conceptos de evaluación activos. El admin los arma en Configuración.</p>;
  return (
    <div className="form-grid eval-grid">
      {concepts.map((c) => {
        const current = levelFor(ratings, c.id);
        return (
          <div key={c.id}>
            <label>{c.label}</label>
            <select
              value={current?.levelId || ""}
              disabled={disabled}
              onChange={(e) => onChange?.(c.id, e.target.value)}
            >
              <option value="">—</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
            {current ? (
              <div className="recv-who">
                {SOURCE[current.source] || current.source} · {current.setByName || "—"} · {formatWhen(current.setAt)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function EvalCorrect({ concepts = [], levels = [], ratings = [], history = [], onCorrect, busy }) {
  const [draft, setDraft] = useState({});
  if (!concepts.length) return <p className="section-sub">Aún no hay conceptos de evaluación. Configúralos en Configuración.</p>;

  function setField(id, patch) {
    setDraft((d) => ({ ...d, [id]: { reason: "", levelId: levelFor(ratings, id)?.levelId || "", ...d[id], ...patch } }));
  }

  return (
    <div className="eval-correct">
      {concepts.map((c) => {
        const current = levelFor(ratings, c.id);
        const row = draft[c.id] || { levelId: current?.levelId || "", reason: "" };
        const changed = row.levelId && row.levelId !== (current?.levelId || "");
        return (
          <div key={c.id} className="eval-correct-row">
            <div className="eval-correct-head">
              <b>{c.label}</b>
              <span className="recv-who">
                {current
                  ? `${current.levelLabel} · ${SOURCE[current.source] || current.source} · ${current.setByName || "—"} · ${formatWhen(current.setAt)}`
                  : "Sin evaluar en patio"}
              </span>
            </div>
            <div className="form-grid">
              <div>
                <label>Corregir a</label>
                <select value={row.levelId} onChange={(e) => setField(c.id, { levelId: e.target.value })}>
                  <option value="">—</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Motivo (según fotos)</label>
                <input
                  value={row.reason}
                  onChange={(e) => setField(c.id, { reason: e.target.value })}
                  placeholder="Ej. corrosión visible en foto 3"
                />
              </div>
            </div>
            <button
              className="btn-ghost"
              type="button"
              disabled={busy || !changed}
              onClick={() => onCorrect?.({ conceptId: c.id, levelId: row.levelId, reason: row.reason })}
            >
              Guardar corrección
            </button>
          </div>
        );
      })}
      {history.length ? (
        <div className="eval-history">
          <b>Trazabilidad</b>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <span>{h.conceptLabel}: {h.fromLevelLabel || "—"} → {h.toLevelLabel}</span>
                <span className="recv-who">
                  {SOURCE[h.source] || h.source} · {h.setByName} · {formatWhen(h.createdAt)}
                  {h.reason ? ` · ${h.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function useEvalCatalog(meta) {
  return useMemo(() => ({
    concepts: meta?.evaluationConcepts || [],
    levels: meta?.evaluationLevels || [],
  }), [meta]);
}
