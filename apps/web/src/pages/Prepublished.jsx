import { useEffect, useState } from "react";
import { api, apiUrl } from "../api.js";
import { useLightbox } from "../media-lightbox.jsx";

const money = (n) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US"));

function photoUrl(iso, slot, version) {
  const q = version ? `?v=${encodeURIComponent(version)}` : "";
  return `${apiUrl(`/catalog/prepublished/${encodeURIComponent(iso)}/photos/${slot}`)}${q}`;
}

export default function Prepublished() {
  const lightbox = useLightbox();
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ pageSize: "96" });
      if (q.trim()) query.set("q", q.trim());
      api(`/catalog/prepublished?${query}`)
        .then((next) => {
          if (!cancelled) {
            setData(next);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  function showPhotos(unit, index = 0) {
    const items = (unit.photos || []).map((slot) => ({
      src: photoUrl(unit.iso, slot, unit.mediaVersion),
      alt: `${unit.iso} foto ${slot + 1}`,
    }));
    lightbox.open(items, index);
  }

  const items = data?.items || [];

  return (
    <div className="catalog-wrap" style={{ paddingTop: 8 }}>
      <h2 className="section-title">Prepublicados</h2>
      <aside className="share-banner">
        <div>
          <span>Sin puesto en el patio</span>
          <b>Los administradores de despacho no tienen posición definida para estos equipos</b>
          <p>
            Tienen fotos, precio de lista, mínimo y margen, igual que los publicados. Cuando despacho confirme el puesto, pasan al catálogo publicado.
          </p>
        </div>
      </aside>
      <div className="panel" style={{ marginTop: 14 }}>
        <input
          className="odoo-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar ISO, tipo o fabricante"
          aria-label="Buscar equipos prepublicados"
        />
      </div>
      {error ? <div className="err">{error}</div> : null}
      <p className="section-sub">
        {data ? `${data.total} equipo${data.total === 1 ? "" : "s"} prepublicado${data.total === 1 ? "" : "s"}.` : "Cargando…"}
      </p>
      <div className="grid">
        {items.map((unit) => (
          <article className="card" key={unit.iso}>
            <div className="card-media" onClick={() => showPhotos(unit)}>
              {unit.photos?.[0] != null ? (
                <img src={photoUrl(unit.iso, unit.photos[0], unit.mediaVersion)} alt={unit.iso} />
              ) : (
                <span className="muted">Sin foto</span>
              )}
              <span className="badge" style={{ background: "var(--navy)" }}>{unit.type}</span>
              <span className="badge-status">Sin posición</span>
            </div>
            <div className="card-body">
              <div className="card-title">{unit.typeLabel}</div>
              <div className="card-iso">{unit.iso}</div>
              <div className="card-meta">
                <span><b>{unit.catLabel}</b></span>
                <span>{unit.depotName}</span>
                <span>{unit.status}</span>
              </div>
              <div className="card-footer">
                <div className="card-price">
                  Lista {money(unit.priceList)}
                  <small>Mínimo {money(unit.priceMin)} · margen {money(unit.margin)}</small>
                </div>
                <button className="link-btn" type="button" onClick={() => setOpen(unit)}>Ver ficha</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {data && data.total === 0 ? (
        <p className="empty-stock">Ningún equipo está prepublicado con fotos y sin puesto.</p>
      ) : null}
      {open ? (
        <div className="overlay open" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="modal pdp-modal" role="dialog" aria-modal="true" aria-label={`Ficha de ${open.iso}`}>
            <div className="modal-head">
              <div>
                <h3>{open.typeLabel} · {open.iso}</h3>
                <div className="muted">{open.catLabel} · {open.depotName}</div>
              </div>
              <button className="modal-close" type="button" aria-label="Cerrar" onClick={() => setOpen(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div>
                <p className="section-sub">Los administradores de despacho no tienen posición definida para este equipo.</p>
                <div className="gallery-thumbs">
                  {(open.photos || []).map((slot, index) => (
                    <button className="thumb" key={slot} type="button" onClick={() => showPhotos(open, index)}>
                      <img src={photoUrl(open.iso, slot, open.mediaVersion)} alt={`${open.iso} foto ${slot + 1}`} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <table className="spec-table">
                  <tbody>
                    <tr><td>Estado</td><td>{open.status}</td></tr>
                    <tr><td>Fabricante</td><td>{open.manufacturer || "—"}</td></tr>
                    <tr><td>Año</td><td>{open.year || "—"}</td></tr>
                    <tr><td>Color</td><td>{open.color || "—"}</td></tr>
                    <tr><td>Posición</td><td>Sin definir por despacho</td></tr>
                  </tbody>
                </table>
                {open.inspectionNotes ? <p className="section-sub" style={{ marginTop: 10 }}>{open.inspectionNotes}</p> : null}
                <div className="price-box">
                  <div className="amt">{money(open.priceList)}</div>
                  <div className="muted">Lista · mínimo {money(open.priceMin)} · margen para negociar {money(open.margin)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {lightbox.node}
    </div>
  );
}
