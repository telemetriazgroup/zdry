import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, apiUrl, publicUrl } from "../api.js";

function kg(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  return v.toLocaleString("en-US");
}

export default function EnvioFicha() {
  const { token } = useParams();
  const [unit, setUnit] = useState(null);
  const [error, setError] = useState("");
  const [slot, setSlot] = useState(0);

  useEffect(() => {
    api(`/catalog/envio/${token}`)
      .then((row) => {
        setUnit(row);
        setSlot(row.photos?.[0] ?? (row.hasVideo ? "video" : 0));
      })
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return <div className="site-page"><div className="panel" style={{ margin: 24 }}><p className="err">{error}</p></div></div>;
  }
  if (!unit) return null;
  const version = unit.mediaVersion;
  const photo = (n) => `${apiUrl(`/catalog/envio/${token}/photos/${n}`)}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
  return (
    <div className="site-page">
      <header className="topbar">
        <div className="topbar-inner topbar-public">
          <img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" height={36} />
        </div>
      </header>
      <div className="view active catalog-wrap">
        <div className="panel handoff-card">
          <h2>{unit.typeLabel} · {unit.iso}</h2>
          <p className="section-sub">{unit.catLabel} · {unit.depotName}{unit.year ? ` · ${unit.year}` : ""}</p>
          <div className="share-brief-main">
            {slot === "video" && unit.hasVideo ? (
              <video src={`${apiUrl(`/catalog/envio/${token}/video`)}${version ? `?v=${encodeURIComponent(version)}` : ""}`} controls />
            ) : unit.photos?.includes(slot) ? (
              <img src={photo(slot)} alt={`${unit.iso} foto ${Number(slot) + 1}`} />
            ) : <span className="muted">Sin foto publicada</span>}
          </div>
          <div className="share-brief-photos">
            {(unit.photos || []).map((n) => (
              <button key={n} type="button" className={slot === n ? "on" : ""} onClick={() => setSlot(n)}>
                <img src={photo(n)} alt={`Foto ${n + 1}`} />
              </button>
            ))}
            {unit.hasVideo ? <button type="button" className={slot === "video" ? "on" : ""} onClick={() => setSlot("video")}>360°</button> : null}
          </div>
          <table className="spec-table">
            <tbody>
              <tr><td>Fabricante</td><td>{unit.manufacturer}</td></tr>
              <tr><td>Año</td><td>{unit.year || "—"}</td></tr>
              <tr><td>Tara / MGW</td><td>{kg(unit.tareKg)} / {kg(unit.mgwKg)} kg</td></tr>
              <tr><td>Color</td><td>{unit.color || "—"}</td></tr>
              {unit.includePrice && unit.priceList ? <tr><td>Precio de lista</td><td>USD {Math.round(Number(unit.priceList)).toLocaleString("en-US")}</td></tr> : null}
            </tbody>
          </table>
          {unit.inspectionNotes ? <p className="section-sub">{unit.inspectionNotes}</p> : null}
        </div>
      </div>
    </div>
  );
}
