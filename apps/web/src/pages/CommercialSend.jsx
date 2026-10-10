import { useEffect, useState } from "react";
import { api, apiBlob, APP_ROOT } from "../api.js";
import { whatsappDigits } from "../catalog-copy.js";

export async function downloadCommercialMedia(iso) {
  const blob = await apiBlob(`/catalog/commercial/${encodeURIComponent(iso)}/descarga`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${iso}-fotos.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CommercialSend({ unit }) {
  const [rows, setRows] = useState([]);
  const [shareId, setShareId] = useState("");
  const [includePrice, setIncludePrice] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api("/catalog-shares")
      .then((list) => {
        const usable = (Array.isArray(list) ? list : []).filter((row) => row.clientPhone);
        setRows(usable);
        setShareId((cur) => cur || usable[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);

  async function send() {
    setError("");
    const share = rows.find((row) => row.id === shareId);
    if (!share) {
      setError("Elige un cliente de los enlaces.");
      return;
    }
    setSending(true);
    try {
      const pack = await api(`/catalog/commercial/${unit.iso}/envio`, {
        method: "POST",
        body: { shareId, includePrice },
      });
      const page = `${window.location.origin}${APP_ROOT === "/" ? "" : APP_ROOT.replace(/\/$/, "")}${pack.path}`;
      const text = String(pack.message || "").replaceAll("{url}", page);
      const phone = whatsappDigits(pack.clientPhone || share.clientPhone);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function download() {
    setError("");
    setDownloading(true);
    try {
      await downloadCommercialMedia(unit.iso);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="commercial-send">
      <b>Enviar esta ficha por WhatsApp</b>
      <p className="field-hint">Descarga las fotos y el video y súbelos tú en el chat. WhatsApp Web no puede adjuntarlos solo. El mensaje lleva el texto y, si lo marcas, el precio de lista. El mínimo no se envía.</p>
      <label>Cliente del enlace</label>
      <select value={shareId} onChange={(e) => setShareId(e.target.value)} aria-label="Cliente del enlace">
        {rows.length ? null : <option value="">No hay enlaces con teléfono</option>}
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {(row.clientCompany || row.clientName)} · {row.contactName || row.clientName} · {row.status}
          </option>
        ))}
      </select>
      <label className="login-check">
        <input type="checkbox" checked={includePrice} onChange={(e) => setIncludePrice(e.target.checked)} />
        Incluir el precio de lista{unit?.priceList ? ` (USD ${Math.round(Number(unit.priceList)).toLocaleString("en-US")})` : ""}
      </label>
      {error ? <p className="err">{error}</p> : null}
      <div className="action-row">
        <button className="btn-ghost" type="button" disabled={downloading} onClick={download}>
          {downloading ? "Preparando descarga…" : "Descargar fotos y video"}
        </button>
        <button className="btn-whatsapp" type="button" disabled={sending || !shareId} onClick={send}>
          {sending ? "Abriendo…" : "Abrir WhatsApp"}
        </button>
      </div>
    </div>
  );
}
