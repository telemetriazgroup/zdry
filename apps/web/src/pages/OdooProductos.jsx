import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

function samePhrase(left, right) {
  const fold = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return fold(left) === fold(right);
}

export default function OdooProductos() {
  const [phrases, setPhrases] = useState([]);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(null);

  async function load() {
    const data = await api("/odoo-import/custom-products");
    setPhrases(data.phrases || []);
    setRows(data.rows || []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function addPhrase() {
    const phrase = draft.replace(/\s+/g, " ").trim();
    if (phrase.length < 3) {
      setError("Escribe al menos 3 letras del producto.");
      return;
    }
    if (phrases.some((item) => samePhrase(item, phrase))) {
      setError("Ese producto ya está en la lista.");
      return;
    }
    setPhrases((current) => [...current, phrase].slice(0, 30));
    setDraft("");
    setError("");
    setMsg("Quedó en la lista. Guarda para buscarlo en Odoo.");
  }

  async function save() {
    setBusy("Guardando");
    setError("");
    setMsg("");
    try {
      const out = await api("/odoo-import/custom-products", { method: "PUT", body: { phrases } });
      setPhrases(out.phrases || []);
      setRows(out.rows || []);
      setMsg(out.sync?.message || "Buscando esos productos en Odoo.");
      for (let i = 0; i < 1800; i += 1) {
        const next = await api("/odoo-import/progress").catch(() => null);
        if (next) setProgress(next);
        if (!next || next.status === "done" || next.status === "error" || next.status === "idle" || next.status === "cancelled") {
          if (next?.status === "error") setError(next.message || "La búsqueda no terminó.");
          else if (next?.message) setMsg(next.message);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <h2 className="section-title">Productos de Odoo</h2>
      <p className="section-sub">
        La búsqueda sigue tomando la categoría Contenedor Dry y todo producto cuyo nombre lleva DRY.
        Aquí se agregan productos concretos que no tienen DRY, por ejemplo módulo de revestimiento.
        Al guardar, ZDRY vuelve a sincronizar y asimila las series que existan. Cada producto muestra cuántos está tomando.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}
      {progress?.status === "running" ? (
        <div className="odoo-progress">
          <div className="odoo-progress-msg">{progress.step || "Buscando"}{progress.total ? ` · ${progress.current || 0}/${progress.total}` : ""}</div>
          <div className="section-sub">{progress.message || "Leyendo Odoo…"}</div>
        </div>
      ) : null}
      <div className="odoo-watch">
        <b>Agregar producto</b>
        <div className="action-row">
          <input
            aria-label="Nombre del producto en Odoo"
            value={draft}
            placeholder="modulo de revestimiento"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPhrase(); }}
            maxLength={80}
          />
          <button className="btn-ghost" type="button" disabled={!!busy} onClick={addPhrase}>Agregar</button>
          <button className="btn-primary" type="button" disabled={!!busy} onClick={save}>
            {busy ? "Buscando en Odoo…" : "Guardar y sincronizar"}
          </button>
        </div>
        <p className="section-sub">El texto tiene que aparecer en el nombre del producto. Se pueden sumar varios. Quitar uno y guardar deja de asimilarlo en la próxima búsqueda.</p>
      </div>
      {phrases.length ? (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Producto</th>
                <th>En Odoo</th>
                <th>En la bandeja</th>
                <th>Ya asimilados</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {phrases.map((phrase) => {
                const row = rows.find((item) => samePhrase(item.phrase, phrase));
                return (
                  <tr key={phrase}>
                    <td><b>{phrase}</b></td>
                    <td>{row?.at ? `${row.products} producto(s), ${row.series} serie(s)` : "Aún sin buscar"}</td>
                    <td>{row ? row.pending : "—"}</td>
                    <td>{row ? row.assimilated : "—"}</td>
                    <td>
                      <button className="btn-ghost" type="button" disabled={!!busy} onClick={() => setPhrases((current) => current.filter((item) => item !== phrase))}>
                        Quitar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="section-sub">Todavía no hay productos personalizados. DRY sigue entrando solo.</p>
      )}
      <div className="action-row">
        <Link className="btn-ghost" to="/app/almacen/odoo">Ir a regularizar</Link>
      </div>
    </>
  );
}
