import { useEffect, useState } from "react";
import { api, apiUpload, apiUrl } from "../api.js";

const LABELS = [
  "Frontal (puertas)",
  "Posterior (panel ciego)",
  "Lateral izquierdo",
  "Lateral derecho",
  "Techo exterior",
  "Interior (piso)",
  "Interior (semi-cerrada)",
  "Placa CSC",
  "Sellos de puerta",
];

function Row({ label, value }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export default function YardUnitDetail({ iso, onClose }) {
  const [unit, setUnit] = useState(null);
  const [error, setError] = useState("");
  const [busySlot, setBusySlot] = useState(null);
  const [bust, setBust] = useState(0);

  useEffect(() => {
    let cancel = false;
    setUnit(null);
    setError("");
    api(`/warehouse/units/${encodeURIComponent(iso)}`)
      .then((data) => { if (!cancel) setUnit(data); })
      .catch((e) => { if (!cancel) setError(e.message || "No se pudo abrir la ficha."); });
    return () => { cancel = true; };
  }, [iso]);

  async function upload(slot, file) {
    if (!file) return;
    setBusySlot(slot);
    setError("");
    const body = new FormData();
    body.append("file", file);
    body.append("slot", String(slot));
    try {
      const next = await apiUpload(`/warehouse/units/${encodeURIComponent(iso)}/photos`, body);
      setUnit(next);
      setBust(Date.now());
    } catch (e) {
      setError(e.message || "No se pudo cargar la foto.");
    } finally {
      setBusySlot(null);
    }
  }

  const src = unit?.odooSource && typeof unit.odooSource === "object" ? unit.odooSource : {};
  const ficha = unit?.lotFicha || {};
  const product = [src.productCode ? `[${src.productCode}]` : "", src.productName || ficha.productTitle || ""].filter(Boolean).join(" ");

  return (
    <div className="overlay open yard-detail-overlay" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Detalle de ${iso}`} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <b>{iso}{unit?.typeLabel ? ` · ${unit.typeLabel}` : ""}</b>
          <button className="modal-close" type="button" aria-label="Cerrar" onClick={onClose}>×</button>
        </div>
        <div className="modal-body single yard-detail-body">
          {error ? <div className="err">{error}</div> : null}
          {!unit && !error ? <p className="section-sub">Cargando ficha…</p> : null}
          {unit ? (
            <div className="yard-detail-grid">
              <div>
                <h3>Datos de Odoo</h3>
                <p className="section-sub">{unit.depotName} — {unit.posLabel}</p>
                <dl className="yard-detail-dl">
                  <Row label="Serial" value={src.serialRaw || unit.iso} />
                  <Row label="Producto" value={product} />
                  <Row label="Ubicación" value={src.locationName || unit.odooLocation} />
                  <Row label="Color" value={src.color || unit.color} />
                  <Row label="Tara" value={src.tareKg ?? unit.tareKg} />
                  <Row label="Peso" value={src.mgwKg ?? unit.mgwKg} />
                  <Row label="Año" value={src.year ?? ficha.yearToken ?? unit.year} />
                  <Row label="Fabricante" value={src.manufacturer || unit.manufacturer} />
                  <Row label="DUA" value={src.dua || unit.odooDua} />
                  <Row label="Procedencia" value={src.originCountry || unit.originCountry} />
                  <Row label="Material" value={src.material || unit.material} />
                  <Row label="Código" value={ficha.lotCode} />
                  <Row label="Código ZGroup" value={ficha.zgroupCode} />
                  <Row label="Referencia interna" value={ficha.internalRef} />
                  <Row label="Category" value={ficha.lotCategory} />
                  <Row label="Clasificación" value={ficha.classification} />
                  <Row label="Nombre del producto" value={ficha.productTitle} />
                  <Row label="Fecha de numeración" value={ficha.numberingDate} />
                  <Row label="Mes de fabricación" value={ficha.manufactureMonth} />
                  <Row label="Condición" value={unit.catLabel} />
                  <Row label="Estado" value={unit.status} />
                </dl>
                <h3>Descripción interna</h3>
                <p>{unit.odooDescription || "Sin descripción en Odoo."}</p>
                {unit.inspectionNotes ? (
                  <>
                    <h3>Notas de patio</h3>
                    <p>{unit.inspectionNotes}</p>
                  </>
                ) : null}
              </div>
              <div>
                <h3>Fotos</h3>
                <p className="section-sub">Se muestra la foto de cada casilla. Si no hay, tócala para cargar una.</p>
                <div className="yard-detail-photos">
                  {LABELS.map((label, index) => {
                    const has = Boolean(unit.photos?.[index]);
                    return (
                      <label key={label} className={`yard-detail-slot${has ? " has" : ""}`}>
                        {has ? (
                          <img src={`${apiUrl(`/warehouse/units/${unit.iso}/photos/${index}`)}?t=${bust}`} alt={label} />
                        ) : (
                          <span className="n">{busySlot === index ? "…" : index + 1}</span>
                        )}
                        <span>{label}{has ? "" : " · Cargar"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          hidden
                          disabled={busySlot != null}
                          onChange={(event) => {
                            upload(index, event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
