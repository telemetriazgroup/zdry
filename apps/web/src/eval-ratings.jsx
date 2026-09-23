import { useMemo, useState } from "react";
import { formatWhen } from "./api.js";

const SOURCE = {
  patio: "Patio",
  recepcion: "Recepción",
  catalogo: "Ficha catálogo",
};

export function levelFor(ratings, concept) {
  const id = typeof concept === "string" ? concept : concept?.id;
  const key = typeof concept === "string" ? "" : concept?.key || "";
  return (ratings || []).find((r) => r.conceptId === id || (key && r.conceptKey === key)) || null;
}

export function EvalGrid({ concepts = [], levels = [], ratings = [], onChange, disabled }) {
  if (!concepts.length) return <p className="section-sub">No hay conceptos de evaluación activos. El admin los arma en Configuración.</p>;
  return (
    <div className="form-grid eval-grid">
      {concepts.map((c) => {
        const current = levelFor(ratings, c);
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
  const [rowErr, setRowErr] = useState({});
  const [rowBusy, setRowBusy] = useState("");
  if (!concepts.length) return <p className="section-sub">Aún no hay conceptos de evaluación. Configúralos en Configuración.</p>;

  function setField(concept, patch) {
    const base = levelFor(ratings, concept)?.levelId || "";
    setDraft((d) => ({ ...d, [concept.id]: { reason: "", levelId: base, ...d[concept.id], ...patch } }));
    setRowErr((e) => ({ ...e, [concept.id]: "" }));
  }

  return (
    <div className="eval-correct">
      {concepts.map((c) => {
        const current = levelFor(ratings, c);
        const row = draft[c.id] || { levelId: current?.levelId || "", reason: "" };
        const changed = row.levelId && row.levelId !== (current?.levelId || "");
        const needsReason = !!current && changed;
        const reasonOk = !needsReason || row.reason.trim().length >= 4;
        return (
          <div key={c.id} className="eval-correct-row">
            <div className="eval-correct-head">
              <b>{c.label}</b>
              <span className="recv-who">
                {current
                  ? `${current.levelLabel} · ${SOURCE[current.source] || current.source} · ${current.setByName || "—"} · ${formatWhen(current.setAt)}`
                  : "Sin evaluar"}
              </span>
            </div>
            <div className="form-grid">
              <div>
                <label>{current ? "Corregir a" : "Evaluar"}</label>
                <select value={row.levelId} onChange={(e) => setField(c, { levelId: e.target.value })}>
                  <option value="">—</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>{current ? "Motivo (según fotos)" : "Nota (opcional)"}</label>
                <input
                  value={row.reason}
                  onChange={(e) => setField(c, { reason: e.target.value })}
                  placeholder={current ? "Ej. corrosión visible en foto 3" : "Opcional"}
                />
              </div>
            </div>
            {needsReason && !reasonOk ? (
              <p className="recv-who">Para corregir una evaluación ya hecha, escribe el motivo (mínimo 4 caracteres).</p>
            ) : null}
            {rowErr[c.id] ? <div className="err">{rowErr[c.id]}</div> : null}
            <button
              className="btn-primary"
              type="button"
              disabled={busy || rowBusy === c.id || !changed || !reasonOk}
              onClick={async () => {
                setRowBusy(c.id);
                setRowErr((e) => ({ ...e, [c.id]: "" }));
                try {
                  await onCorrect?.({ conceptId: c.id, levelId: row.levelId, reason: row.reason });
                  setDraft((d) => ({ ...d, [c.id]: { levelId: row.levelId, reason: "" } }));
                } catch (err) {
                  setRowErr((e) => ({ ...e, [c.id]: err.message || "No se guardó la evaluación." }));
                } finally {
                  setRowBusy("");
                }
              }}
            >
              {rowBusy === c.id ? "Guardando…" : current ? "Guardar corrección" : "Guardar evaluación"}
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
