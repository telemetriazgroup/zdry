import { useEffect, useState } from "react";
import { api } from "../api.js";

const STATUS = {
  abierto: "Esperando respuesta",
  esperando_contacto: "Pidió contacto",
  cotizacion_pedida: "Pidió cotización",
  cerrado: "Cerrado",
};

const money = (n) => (n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function HilosComerciales() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  function loadList() {
    return api("/commercial/hilos")
      .then((next) => {
        setRows(next);
        setError("");
      })
      .catch((e) => setError(e.message));
  }

  function loadOne(id) {
    return api(`/commercial/hilos/${id}`)
      .then((next) => {
        setSelected(next);
        setPrice("");
        setError("");
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!selected?.id) return undefined;
    const timer = window.setInterval(() => loadOne(selected.id), 8000);
    return () => window.clearInterval(timer);
  }, [selected?.id]);

  async function offerList() {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await api(`/commercial/hilos/${selected.id}/precio`, { method: "POST", body: { useList: true } });
      setSelected(next);
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function offerOther(event) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const next = await api(`/commercial/hilos/${selected.id}/precio`, { method: "POST", body: { price: Number(price) } });
      setSelected(next);
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmOk() {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await api(`/commercial/hilos/${selected.id}/ok`, { method: "POST", body: {} });
      setSelected(next);
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hilos</h1>
          <p className="muted">Precio que pide el cliente, cotización y contacto. El máximo sugerido es el precio de lista.</p>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="panel">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>Cliente</th><th>Equipo</th><th>Vendedor</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.clientName}</td>
                  <td>{row.iso}</td>
                  <td>{row.vendorName}</td>
                  <td>{STATUS[row.status] || row.status}</td>
                  <td><button className="btn-ghost" type="button" onClick={() => loadOne(row.id)}>Abrir</button></td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={5}>No hay hilos abiertos.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {selected ? (
        <div className="panel">
          <h2>{selected.iso} · {selected.clientName}</h2>
          <p className="muted">
            Lista {money(selected.priceList)} · mínimo {money(selected.priceMin)} · margen {money(selected.margin)}
          </p>
          <p>{selected.clientPhone} · {selected.clientEmail}</p>
          {(selected.messages || []).map((item) => (
            <p key={item.id}><strong>{item.author}.</strong> {item.body}</p>
          ))}
          {selected.status === "abierto" ? (
            <div className="form-grid">
              <button className="btn-primary" type="button" disabled={busy} onClick={offerList}>1. {selected.maxLabel}</button>
              <form onSubmit={offerOther} className="form-grid">
                <div>
                  <label>Otro precio neto</label>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Dentro del mínimo y la lista" />
                </div>
                <button className="btn-ghost" type="submit" disabled={busy}>Enviar este precio</button>
              </form>
            </div>
          ) : null}
          {selected.status === "esperando_contacto" && !selected.vendorOkAt ? (
            <button className="btn-primary" type="button" disabled={busy} onClick={confirmOk}>OK, ya me comunico</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
