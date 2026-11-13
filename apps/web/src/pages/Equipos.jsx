import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { hasRole, useAuth } from "../auth.jsx";
import { NoticeModal } from "../notice.jsx";
import GearMedia from "./GearMedia.jsx";

export default function Equipos() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState("");
  const [code, setCode] = useState("");
  const [feet, setFeet] = useState("20");
  const [color, setColor] = useState("#8a90a2");
  const [kind, setKind] = useState("REEFER");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = hasRole(user, "admin", "coordinador");
  const depotId = params.get("depotId") || layout?.depotId || "";
  const plan = layout?.plan;
  const kinds = plan?.equipmentKinds?.length ? plan.equipmentKinds : ["REEFER", "TUNEL", "POWERPACK", "MODULO", "OTROS"];
  const gear = (plan?.outsiders || []).find((item) => item.id === pickedId) || null;
  const needle = query.trim().toUpperCase();
  const rows = (plan?.outsiders || []).filter((item) => !needle || `${item.code} ${item.feet} ${item.kind} ${item.note || ""}`.toUpperCase().includes(needle));

  async function load(id) {
    const data = await api(`/yard/${id}`);
    setLayout(data);
    return data;
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        if (depotId) {
          const data = await load(depotId);
          if (!cancel) setLayout(data);
          return;
        }
        const meta = await api("/warehouse/meta");
        const first = meta.depots?.[0]?.id;
        if (first) setParams({ depotId: first }, { replace: true });
      } catch (e) {
        if (!cancel) setError(e.message);
      }
    })();
    return () => { cancel = true; };
  }, [depotId]);

  function fill(item) {
    setPickedId(item?.id || "");
    setCode(item?.code || "");
    setFeet(String(item?.feet || 20));
    setColor(item?.color || "#8a90a2");
    setKind(kinds.includes(item?.kind) ? item.kind : kinds[0]);
    setNote(item?.note || "");
  }

  async function save(remove = false) {
    setBusy(true);
    setError("");
    try {
      await api("/yard/outsider", {
        method: "POST",
        body: {
          depotId,
          ...(pickedId ? { id: pickedId } : {}),
          code,
          feet: Number(feet),
          color,
          kind,
          note,
          ...(remove ? { remove: true } : {}),
        },
      });
      const data = await load(depotId);
      if (remove) fill(null);
      else {
        const next = (data.plan?.outsiders || []).find((item) => item.code === code.trim().toUpperCase());
        if (next) fill(next);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!layout) {
    return (
      <>
        <h2 className="section-title">Equipos que no son DRY</h2>
        {error ? <NoticeModal title="Aviso" text={error} onClose={() => setError("")} /> : <p className="section-sub">Cargando…</p>}
      </>
    );
  }

  return (
    <>
      <h2 className="section-title">Equipos que no son DRY</h2>
      <NoticeModal title="Aviso" text={error} onClose={() => setError("")} />
      <div className="panel">
        <label className="zone-field">Depósito
          <select aria-label="Depósito" value={depotId} onChange={(event) => { setPickedId(""); setParams({ depotId: event.target.value }); }}>
            {(layout.depots || []).map((depot) => <option key={depot.id} value={depot.id}>{depot.name}</option>)}
          </select>
        </label>
        <p className="section-sub">Aquí se editan los datos y se cargan las fotos y los videos. Luego se ubican en el patio como un DRY: se elige el equipo y se toca el puesto.</p>
        <input className="odoo-search" aria-label="Buscar equipo" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar equipo" />
        <div className="pill-list">
          {rows.map((item) => (
            <button
              key={item.id}
              className="pill-check"
              type="button"
              style={{ cursor: "pointer", background: item.id === pickedId ? "#12203a" : "#fff", color: item.id === pickedId ? "#fff" : "inherit" }}
              onClick={() => fill(item)}
            >
              {item.code} — {item.feet} pies · {item.kind}
            </button>
          ))}
        </div>
        {!rows.length ? <p className="section-sub">{needle ? "Ninguno coincide con la búsqueda." : "Todavía no hay equipos asimilados en este depósito."}</p> : null}
        {canEdit ? (
          <div className="guest-form">
            <label className="zone-field">Código
              <input aria-label="Código del equipo" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Código" />
            </label>
            <label className="zone-field">Largo
              <select aria-label="Largo del equipo" value={feet} onChange={(event) => setFeet(event.target.value)}>
                <option value="10">10 pies</option>
                <option value="20">20 pies</option>
                <option value="40">40 pies</option>
              </select>
            </label>
            <label className="zone-field">Color
              <input aria-label="Color del equipo" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
            <label className="zone-field">Tipo
              <select aria-label="Tipo del equipo" value={kinds.includes(kind) ? kind : kinds[0]} onChange={(event) => setKind(event.target.value)}>
                {kinds.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="zone-field">Nota
              <input aria-label="Nota del equipo" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opcional" maxLength={120} />
            </label>
            <button className="btn-primary" type="button" disabled={busy || !code.trim()} onClick={() => save(false)}>{pickedId ? "Guardar cambios" : "Asimilar al depósito"}</button>
          </div>
        ) : null}
        {gear ? (
          <>
            <div className="action-row">
              <Link className="btn-ghost" to={`/app/almacen/patio?depotId=${encodeURIComponent(depotId)}`}>Ubicar en el patio</Link>
              {canEdit ? <button className="btn-ghost" type="button" disabled={busy} onClick={() => save(true)}>Eliminar</button> : null}
            </div>
            <GearMedia depotId={depotId} gear={gear} canEdit={canEdit} onSaved={() => load(depotId)} />
          </>
        ) : <p className="section-sub">Elige un equipo para ver sus datos, sus fotos y sus videos.</p>}
      </div>
    </>
  );
}
