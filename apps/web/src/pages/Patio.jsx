import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import {
  LAYOUT_STATUS_COLOR,
  bestSlotFor,
  columnCompatible,
  columnFillStatus,
  columnUsable,
  nextNivelInColumn,
} from "../yard.js";

export default function Patio() {
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState(null);
  const [selectedIso, setSelectedIso] = useState(null);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [error, setError] = useState("");

  const depotId = params.get("depotId") || layout?.depotId || "";

  async function load(id) {
    const data = await api(`/yard/${id}`);
    setLayout(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (depotId) {
          const data = await load(depotId);
          if (!cancelled) setLayout(data);
          return;
        }
        const meta = await api("/warehouse/meta");
        const first = meta.depots[0]?.id;
        if (first) {
          setParams({ depotId: first }, { replace: true });
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [depotId]);

  const occupants = useMemo(() => {
    if (!layout) return [];
    return layout.units
      .filter((u) => u.lado)
      .map((u) => ({
        iso: u.iso,
        type: u.type,
        cat: u.cat,
        manufacturer: u.manufacturer,
        depotId: layout.depotId,
        lado: u.lado,
        ruma: u.ruma,
        columna: u.columna,
        nivel: u.nivel,
        status: u.status,
      }));
  }, [layout]);

  const selected = layout?.units.find((u) => u.iso === selectedIso) || null;
  const suggested = selected
    ? bestSlotFor(occupants, layout.depotId, selected.type, selected.cat, layout.config, layout.rules)
    : null;

  async function onCellClick(lado, ruma, columna, nivel) {
    const occ = layout.units.find(
      (x) => x.lado === lado && x.ruma === ruma && x.columna === columna && x.nivel === nivel,
    );
    if (occ) {
      setSelectedIso(selectedIso === occ.iso ? null : occ.iso);
      setMsg({ kind: "", text: "" });
      return;
    }
    if (!selectedIso) return;
    try {
      const out = await api("/yard/place", {
        method: "POST",
        body: { iso: selectedIso, depotId: layout.depotId, lado, ruma, columna, nivel },
      });
      setSelectedIso(null);
      setMsg({ kind: "ok", text: out.message });
      await load(layout.depotId);
    } catch (e) {
      setMsg({ kind: "err", text: e.message });
    }
  }

  async function compact() {
    try {
      const out = await api("/yard/compact", { method: "POST", body: { depotId: layout.depotId } });
      setMsg({ kind: "ok", text: `✓ Compactación por gravedad: ${out.moved} unidad(es) reasentada(s).` });
      await load(layout.depotId);
    } catch (e) {
      setMsg({ kind: "err", text: e.message });
    }
  }

  if (!layout) {
    return (
      <>
        <h2 className="section-title">Layout de patio</h2>
        {error ? <div className="err">{error}</div> : <p className="section-sub">Cargando…</p>}
      </>
    );
  }

  const { config, rules, unassigned } = layout;
  const maxNivel = Math.min(rules.maxNivel || config.niveles, config.niveles);

  function cell(lado, ruma, columna, nivel) {
    const occ = layout.units.find(
      (x) => x.lado === lado && x.ruma === ruma && x.columna === columna && x.nivel === nivel,
    );
    if (occ) {
      const isSel = selectedIso === occ.iso;
      const committed = occ.committed;
      return (
        <div
          key={`${lado}-${ruma}-${columna}-${nivel}`}
          onClick={() => onCellClick(lado, ruma, columna, nivel)}
          title={`${occ.iso} — ${occ.typeLabel}${committed ? ` — comprometida (${occ.status}), pendiente de despacho físico` : ""}`}
          style={{
            width: 74,
            height: 32,
            borderRadius: 6,
            background: occ.typeColor,
            color: "#fff",
            fontSize: 9,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            outline: isSel ? "3px solid var(--orange)" : committed ? "2px dashed #c9720b" : "none",
            textAlign: "center",
            padding: 2,
            lineHeight: 1.1,
            position: "relative",
          }}
        >
          {committed ? <span style={{ position: "absolute", top: -6, right: -4, fontSize: 10 }}>🚚</span> : null}
          {occ.iso}
        </div>
      );
    }
    let canDrop = false;
    if (selected) {
      canDrop =
        columnCompatible(
          occupants,
          layout.depotId,
          lado,
          ruma,
          columna,
          selected.type,
          selected.cat,
          selected.manufacturer,
          config,
          rules,
        ) && nextNivelInColumn(occupants, layout.depotId, lado, ruma, columna, config, rules) === nivel;
    }
    const usable = columnUsable(occupants, layout.depotId, lado, ruma, columna, config, rules);
    const isSuggested = suggested && suggested.lado === lado && suggested.ruma === ruma && suggested.columna === columna && suggested.nivel === nivel;
    if (!usable) {
      return (
        <div
          key={`${lado}-${ruma}-${columna}-${nivel}`}
          style={{
            width: 74,
            height: 32,
            borderRadius: 6,
            background: "#f1f2f5",
            border: "1.5px dashed var(--line)",
            opacity: 0.35,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            color: "var(--text-3)",
          }}
        >
          🔒
        </div>
      );
    }
    return (
      <div
        key={`${lado}-${ruma}-${columna}-${nivel}`}
        onClick={() => onCellClick(lado, ruma, columna, nivel)}
        style={{
          width: 74,
          height: 32,
          borderRadius: 6,
          background: canDrop ? "#ebfbee" : "#eef1f6",
          border: isSuggested ? "2px solid var(--green)" : canDrop ? "1.5px dashed var(--green)" : "1.5px dashed var(--line)",
          cursor: selectedIso ? "pointer" : "default",
          opacity: canDrop || selectedIso ? 1 : 0.55,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color: "var(--text-3)",
          fontWeight: isSuggested ? 800 : 500,
        }}
      >
        {isSuggested ? "★ N" + nivel : "N" + nivel}
      </div>
    );
  }

  function ladoBlock(lado) {
    const rumaRows = [];
    for (let ruma = 1; ruma <= config.rumas; ruma++) {
      const columnBlocks = [];
      for (let columna = 1; columna <= config.columnas; columna++) {
        const cells = [];
        for (let nivel = config.niveles; nivel >= 1; nivel--) {
          cells.push(cell(lado, ruma, columna, nivel));
        }
        const st = columnFillStatus(occupants, layout.depotId, lado, ruma, columna, config, rules);
        columnBlocks.push(
          <div key={columna} style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
            {cells}
            <div style={{ fontSize: 9, fontWeight: 700, marginTop: 2, color: LAYOUT_STATUS_COLOR[st] }}>Col {columna} · {st}</div>
          </div>,
        );
      }
      rumaRows.push(
        <div key={ruma} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-2)", fontWeight: 800, width: 44, textAlign: "right", paddingRight: 4 }}>R{ruma}</div>
          <div style={{ display: "flex", gap: 10 }}>{columnBlocks}</div>
        </div>,
      );
    }
    return (
      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ fontWeight: 800, fontSize: 12, color: "var(--text-2)", marginBottom: 10, letterSpacing: ".03em" }}>LADO {lado.toUpperCase()}</div>
        {rumaRows}
      </div>
    );
  }

  return (
    <>
      <div className="unit-picker">
        <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>Depósito:</label>
        <select
          value={layout.depotId}
          onChange={(e) => {
            setSelectedIso(null);
            setMsg({ kind: "", text: "" });
            setParams({ depotId: e.target.value });
          }}
        >
          {layout.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {selectedIso ? (
          <button className="btn-ghost" type="button" onClick={() => { setSelectedIso(null); setMsg({ kind: "", text: "" }); }}>
            Cancelar selección ({selectedIso})
          </button>
        ) : null}
        <button className="btn-ghost" type="button" onClick={compact}>Compactar patio (gravedad)</button>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {unassigned.length ? (
        <div className="panel" style={{ borderColor: "#c9720b", background: "#fff8ee" }}>
          <h3 style={{ color: "#c9720b" }}>📍 Contenedores sin posición asignada ({unassigned.length})</h3>
          <p className="section-sub">Ya pasaron por Recepción — el stackero debe darles ubicación. Toca uno para seleccionarlo y luego toca una celda vacía compatible en el patio.</p>
          <div className="pill-list">
            {unassigned.map((c) => (
              <button
                key={c.iso}
                className="pill-check"
                type="button"
                style={{ cursor: "pointer", background: selectedIso === c.iso ? "#12203a" : "#fff", color: selectedIso === c.iso ? "#fff" : "inherit" }}
                onClick={() => { setSelectedIso(c.iso); setMsg({ kind: "", text: "" }); }}
              >
                {c.iso} — {c.typeLabel} · {c.catLabel}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="panel">
        <p className="section-sub">Toca un contenedor para seleccionarlo (se resalta en naranja), luego toca una celda vacía resaltada en verde para moverlo ahí. Una columna no puede mezclar tamaños (20'/40'/45'), y según las reglas activas (Configuración → Reglas de columna) tampoco condición nuevo/usado ni fabricante. Máximo {maxNivel} niveles por columna; una columna nueva se habilita recién cuando la anterior está completamente llena (🔒 = bloqueada). El costo de posición se recalcula al instante según cuántos contenedores hay que remover para llegar a cada unidad.</p>
        {msg.text ? (
          <div style={{ fontSize: 12, marginBottom: 10, color: msg.kind === "ok" ? "var(--green)" : "#c92a2a", fontWeight: msg.kind === "ok" ? 700 : 600 }}>
            {msg.text}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 22, alignItems: "flex-start", overflowX: "auto" }}>
          {ladoBlock(config.lados[0])}
          <div style={{ alignSelf: "stretch", minWidth: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ writingMode: "vertical-rl", textOrientation: "mixed", fontSize: 10, fontWeight: 800, letterSpacing: ".06em", color: "var(--text-3)", borderLeft: "2px dashed var(--line)", borderRight: "2px dashed var(--line)", height: "100%", padding: "0 6px", display: "flex", alignItems: "center" }}>
              PASADIZO CENTRAL — STACKER
            </div>
          </div>
          {ladoBlock(config.lados[1])}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>ISO</th><th>Tipo</th><th>Condición</th><th>Estado</th><th>Ingreso</th><th>Posición</th><th>Movimientos para extraer</th>
              </tr>
            </thead>
            <tbody>
              {layout.occupants.map((c) => (
                <tr key={c.iso}>
                  <td>{c.iso}</td>
                  <td>{c.typeLabel}</td>
                  <td style={{ color: c.catColor }}>{c.catLabel}</td>
                  <td>
                    {c.committed ? (
                      <span className="badge-scope" style={{ background: "#c9720b" }}>🚚 {c.status} — comprometida, pendiente de despacho físico</span>
                    ) : c.status}
                  </td>
                  <td>{c.intakeLabel}</td>
                  <td>{c.posLabel}</td>
                  <td>{c.movesToRetrieve > 0 ? `${c.movesToRetrieve} movimientos` : "Acceso directo"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
