import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api.js";

export default function TypeAudit() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState({});
  const [applyCondition, setApplyCondition] = useState(false);
  const [pending, setPending] = useState(false);

  async function load() {
    const next = await api("/superadmin/type-audit");
    setData(next);
    const on = {};
    for (const row of next.rows || []) {
      if (row.suggestedType) on[row.id] = true;
    }
    setPicked(on);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const compact = needle.replace(/[\s-]/g, "");
    return (data?.rows || []).filter((row) => {
      if (!needle) return true;
      const hay = [row.iso, row.currentType, row.suggestedType, row.currentCat, row.suggestedCat, row.productName, row.productCode, row.typeReason, row.catReason]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle) || hay.replace(/[\s-]/g, "").includes(compact);
    });
  }, [data, q]);

  function toggleAll(on) {
    const next = { ...picked };
    for (const row of rows) {
      if (row.suggestedType || (applyCondition && row.suggestedCat)) next[row.id] = on;
    }
    setPicked(next);
  }

  async function apply() {
    const ids = Object.entries(picked).filter(([, on]) => on).map(([id]) => id);
    if (!ids.length) {
      setError("Elige al menos una fila.");
      return;
    }
    const typeN = (data?.rows || []).filter((row) => ids.includes(row.id) && row.suggestedType).length;
    const catN = applyCondition ? (data?.rows || []).filter((row) => ids.includes(row.id) && row.suggestedCat).length : 0;
    const ok = window.confirm(
      `Se actualizan ${typeN} tipos en ZDRY${catN ? ` y ${catN} condiciones` : ""}. No se escribe en Odoo ni se rehacen las cotizaciones ya emitidas. Las listas que no son oferta a mano se recalculan.`,
    );
    if (!ok) return;
    setPending(true);
    setError("");
    try {
      const out = await api("/superadmin/type-audit/apply", { method: "POST", body: { ids, applyCondition } });
      setMsg(`Tipos actualizados: ${out.types}. Condiciones: ${out.conditions}. Listas recalculadas: ${out.pricesRecalculated}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Tipos según Odoo</h2>
      <p className="section-sub">
        Compara la descripción del producto en Odoo con el tipo guardado en ZDRY.
        Un 40 DC no puede quedarse así si el producto dice «contenedor dry 20 DC».
        20 DC y 20GP se tratan como el mismo standard de 20 pies, igual que 40 DC y 40GP.
        ASIS, nuevo y 1-trip no cambian salvo que la descripción diga otra condición y marques esa opción.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {data ? (
        <p className="muted">
          Revisados {data.scannedContainers} contenedores y {data.scannedLots} lotes aún sin ficha.
          {" "}{data.typeCount} con tipo distinto. {data.conditionCount} con condición distinta, en espera.
        </p>
      ) : null}
      <div className="action-row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          className="odoo-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar ISO, tipo o producto"
          aria-label="Buscar diferencias de tipo"
          style={{ minWidth: 260 }}
        />
        <button type="button" className="btn-ghost" onClick={() => toggleAll(true)}>Marcar visibles</button>
        <button type="button" className="btn-ghost" onClick={() => toggleAll(false)}>Quitar marcas</button>
        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={applyCondition} onChange={(e) => setApplyCondition(e.target.checked)} />
          También actualizar la condición
        </label>
        <button type="button" className="btn-primary" disabled={pending} onClick={apply}>
          {pending ? "Aplicando…" : "Aplicar sugerencias"}
        </button>
      </div>
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th></th>
              <th>Equipo</th>
              <th>Tipo actual</th>
              <th>Producto Odoo</th>
              <th>Sugerencia</th>
              <th>Condición</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={!!picked[row.id]}
                    aria-label={`Incluir ${row.iso || row.id}`}
                    onChange={(e) => setPicked({ ...picked, [row.id]: e.target.checked })}
                  />
                </td>
                <td>
                  <b>{row.iso || "Sin ISO"}</b>
                  <div className="muted">{row.source === "lote" ? "Lote sin ficha" : "Contenedor"}</div>
                </td>
                <td>{row.currentType || "—"}</td>
                <td>{row.productCode ? `[${row.productCode}] ` : ""}{row.productName}</td>
                <td>
                  {row.suggestedType ? <b>{row.suggestedType}</b> : "—"}
                  {row.typeReason ? <div className="muted">{row.typeReason}</div> : null}
                </td>
                <td>
                  {row.currentCat || "—"}
                  {row.suggestedCat ? <div className="muted">Opcional: {row.suggestedCat}. {row.catReason}</div> : null}
                </td>
              </tr>
            ))}
            {data && !rows.length ? (
              <tr><td colSpan={6}>No hay diferencias con ese filtro.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
