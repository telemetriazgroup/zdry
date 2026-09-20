import { useEffect, useMemo, useState } from "react";
import { api, apiUrl } from "../api.js";

const PIPE_LABEL = {
  cotizacion: "Cotización",
  confirmada: "Confirmada",
  por_facturar: "Por facturar",
  ingreso: "Ingreso facturado",
  cancelada: "Cancelada",
};

const KIND_LABEL = { venta: "Venta", alquiler: "Alquiler", otros: "Otros" };

const OTROS_LABEL = {
  mixto_reefer: "Mixto reefer",
  servicio_reefer: "Servicio reefer",
  modular: "Modular / plano",
  derivado: "Furgón / store / OT",
  garantia: "Garantía",
  falso_flete: "Falso flete",
  servicio_patio: "Patio / acondicionar",
  mixto: "Venta + alquiler",
  solo_logistica: "Solo flete",
  otro: "Otro asunto DRY",
  sin_asunto: "Sin asunto",
};

const DOC_LABEL = {
  picking_out: "Salida / despacho",
  picking_in: "Entrada / retorno",
  invoice: "Factura",
  refund: "Nota de crédito",
  other: "Almacén",
};

const PAY_LABEL = {
  paid: "Cobrada",
  not_paid: "Por cobrar",
  partial: "Parcial",
  in_payment: "En pago",
};

function blockHead(b) {
  if (!b) return 0;
  return (b.quotes || 0) + (b.confirmadas || 0) + (b.porFacturar || 0) + (b.ingresos || 0) + (b.canceladas || 0);
}

function money(m) {
  if (!m) return "—";
  const bits = [];
  if (m.USD) bits.push(`USD ${m.USD.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  if (m.PEN) bits.push(`S/ ${m.PEN.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  return bits.join(" · ") || "0";
}

function signed(n) {
  const v = Number(n) || 0;
  if (v > 0) return `+${v}`;
  return String(v);
}

function fmtMoney(cur, n) {
  const v = Number(n) || 0;
  const code = String(cur || "USD").includes("PEN") ? "PEN" : "USD";
  return `${code} ${v.toLocaleString(code === "PEN" ? "es-PE" : "en-US", { maximumFractionDigits: 2 })}`;
}

function VendorCompare({ a, b }) {
  if (!a || !b) return null;
  const rows = [
    ["Puesto", a.rank, b.rank],
    ["SO venta", a.venta, b.venta],
    ["SO alquiler", a.alquiler, b.alquiler],
    ["Siguen cotización", a.cotizacion, b.cotizacion],
    ["En proceso", a.proceso, b.proceso],
    ["Facturadas (ingreso real)", a.ingresos, b.ingresos],
    ["% del ingreso del equipo", `${a.shareIngreso}%`, `${b.shareIngreso}%`],
    ["Pedido → factura", `${a.invoiceRate}%`, `${b.invoiceRate}%`],
    ["Ticket medio USD", a.ticketUsd, b.ticketUsd],
    ["Monto facturado USD", a.amountIngreso?.USD || 0, b.amountIngreso?.USD || 0],
    ["Monto facturado PEN", a.amountIngreso?.PEN || 0, b.amountIngreso?.PEN || 0],
  ];
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Indicador</th>
            <th>{a.name}</th>
            <th>{b.name}</th>
            <th>Diferencia (A − B)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([lab, va, vb]) => {
            const na = typeof va === "number" ? va : Number(String(va).replace("%", "")) || 0;
            const nb = typeof vb === "number" ? vb : Number(String(vb).replace("%", "")) || 0;
            const diff = typeof va === "number" && typeof vb === "number" ? signed(Math.round((na - nb) * 100) / 100) : "—";
            const better = typeof va === "number" && typeof vb === "number" && lab !== "Puesto" && lab !== "Siguen cotización"
              ? (na > nb ? "a" : na < nb ? "b" : "")
              : "";
            return (
              <tr key={lab}>
                <td>{lab}</td>
                <td className={better === "a" ? "dry-win" : ""}>{va}</td>
                <td className={better === "b" ? "dry-win" : ""}>{vb}</td>
                <td>{diff}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtWhen(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DryStats() {
  const [stats, setStats] = useState(null);
  const [deals, setDeals] = useState([]);
  const [dealTotal, setDealTotal] = useState(0);
  const [year, setYear] = useState("all");
  const [kind, setKind] = useState("all");
  const [pipeline, setPipeline] = useState("all");
  const [vendor, setVendor] = useState("");
  const [month, setMonth] = useState("");
  const [q, setQ] = useState("");
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [ficha, setFicha] = useState(null);
  const [fichaBusy, setFichaBusy] = useState(false);
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  const take = 80;

  const hydrate = stats?.hydrate;

  function qs() {
    const p = new URLSearchParams();
    p.set("take", String(take));
    p.set("skip", String(skip));
    if (year !== "all") p.set("year", year);
    if (kind !== "all") p.set("kind", kind);
    if (pipeline !== "all") p.set("pipeline", pipeline);
    if (vendor) p.set("vendor", vendor);
    if (month) p.set("month", month);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }

  async function load() {
    const statQ = new URLSearchParams();
    if (year !== "all") statQ.set("year", year);
    if (kind !== "all") statQ.set("kind", kind);
    const [s, d] = await Promise.all([
      api(`/dry-stats${statQ.toString() ? `?${statQ}` : ""}`),
      api(`/dry-stats/deals?${qs()}`),
    ]);
    setStats(s);
    setDeals(d.rows || []);
    setDealTotal(d.total || 0);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [year, kind, pipeline, vendor, month, skip]);

  useEffect(() => {
    if (hydrate?.status !== "running") return undefined;
    const t = setInterval(() => {
      api("/dry-stats/hydrate")
        .then((h) => setStats((prev) => (prev ? { ...prev, hydrate: h } : prev)))
        .catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [hydrate?.status]);

  const years = useMemo(() => {
    if (!stats?.years) return [];
    return Object.keys(stats.years).filter((y) => ["2023", "2024", "2025", "2026"].includes(y)).sort();
  }, [stats]);

  const kindTotals = useMemo(() => {
    const out = { venta: 0, alquiler: 0, otros: 0 };
    for (const y of Object.values(stats?.years || {})) {
      out.venta += blockHead(y.venta);
      out.alquiler += blockHead(y.alquiler);
      out.otros += blockHead(y.otros);
    }
    return out;
  }, [stats]);

  const block = (y, k) => stats?.years?.[y]?.[k];

  function filter(next) {
    setSkip(0);
    if (next.year !== undefined) setYear(next.year);
    if (next.kind !== undefined) setKind(next.kind);
    if (next.pipeline !== undefined) setPipeline(next.pipeline);
    if (next.vendor !== undefined) setVendor(next.vendor);
    if (next.month !== undefined) setMonth(next.month);
  }

  async function run(fn, label) {
    setBusy(label);
    setError("");
    setMsg("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function openDeal(row) {
    setFichaBusy(true);
    setError("");
    try {
      setFicha(await api(`/dry-stats/deals/${row.id}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setFichaBusy(false);
    }
  }

  async function searchDeals(e) {
    e.preventDefault();
    setSkip(0);
    try {
      const d = await api(`/dry-stats/deals?${qs()}`);
      setDeals(d.rows || []);
      setDealTotal(d.total || 0);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h2 className="section-title">Estadística DRY — archivo local</h2>
      <p className="section-sub">
        Se traen de Odoo <b>todas</b> las cotizaciones con DRY en el asunto (líneas, OUT/IN, facturas y notas).
        Después se consulta <b>aquí</b>: por comercial, fecha, venta/alquiler y el estado en que quedó. No hace falta volver a Odoo para cada ficha.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {msg ? <div className="ok-msg">{msg}</div> : null}

      <div className="action-row" style={{ marginBottom: 16 }}>
        <button
          className="btn-primary"
          type="button"
          disabled={!!busy}
          onClick={() => run(async () => {
            const s = await api("/dry-stats/import", { method: "POST", body: {} });
            setStats(s);
            setMsg(`Cabeceras: ${s.dealCount}. El expediente (líneas, despacho, factura, notas) sigue bajando en segundo plano.`);
          }, "import")}
        >
          {busy === "import" ? "Trayendo cabeceras…" : "Traer de Odoo"}
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={!!busy || !stats?.dealCount || hydrate?.status === "running"}
          onClick={() => run(async () => {
            await api("/dry-stats/hydrate", { method: "POST", body: {} });
            setMsg("Bajando imágenes y documentos que falten al archivo local.");
          }, "hydrate")}
        >
          Completar expedientes
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={!!busy || !stats?.dealCount}
          onClick={() => run(async () => {
            const s = await api("/dry-stats/baseline", { method: "POST", body: { label: "Antes de ZDRY" } });
            setStats(s);
            setMsg("Línea base guardada.");
          }, "base")}
        >
          Marcar línea base
        </button>
      </div>

      {hydrate?.status === "running" ? (
        <div className="dry-hydrate">
          <b>Bajando expedientes {hydrate.current}/{hydrate.total}</b>
          <div className="dry-bar"><i style={{ width: `${hydrate.total ? (hydrate.current / hydrate.total) * 100 : 0}%` }} /></div>
          <span>{hydrate.message}{hydrate.name ? ` · ${hydrate.name}` : ""}</span>
        </div>
      ) : hydrate?.status === "done" ? (
        <p className="ok-msg">Expedientes locales listos. Las consultas de detalle ya no van a Odoo.</p>
      ) : hydrate?.status === "error" ? (
        <div className="err">{hydrate.message}</div>
      ) : null}

      {stats?.fetchedAt ? (
        <p className="section-sub">
          Última importación: {new Date(stats.fetchedAt).toLocaleString("es-PE")}
          {stats.baselineAt ? ` · Línea base “${stats.baselineLabel}”: ${new Date(stats.baselineAt).toLocaleString("es-PE")}` : " · Aún no hay línea base"}
        </p>
      ) : (
        <p className="section-sub">Aún no hay datos locales. Pulsa Traer de Odoo.</p>
      )}

      {stats?.leader ? (
        <div className="dry-leader">
          <b>Mayor rango de venta (ingreso facturado real):</b> {stats.leader.name}
          {" · "}{stats.leader.ingresos} SO facturadas · {money(stats.leader.amountIngreso)}
        </div>
      ) : null}

      {stats?.delta ? (
        <div className="dry-delta">
          <b>Después vs línea base:</b> ingresos venta {signed(stats.delta.ventaIngresos)} · alquiler {signed(stats.delta.alquilerIngresos)}
          {" · "}otros {signed(stats.delta.otrosIngresos)} · USD {signed(stats.delta.amountIngresoUsd)} · PEN {signed(stats.delta.amountIngresoPen)}
        </div>
      ) : null}

      <div className="tile-row">
        <button type="button" className={`tile dry-click ${year === "all" && kind === "all" && !vendor ? "on" : ""}`} onClick={() => filter({ year: "all", kind: "all", pipeline: "all", vendor: "", month: "" })}>
          <div className="v">{stats?.dealCount ?? "—"}</div><div className="l">SO con DRY</div>
        </button>
        <button type="button" className={`tile dry-click ${kind === "venta" ? "on" : ""}`} onClick={() => filter({ kind: "venta" })}>
          <div className="v">{stats ? kindTotals.venta : "—"}</div><div className="l">Venta DRY</div>
        </button>
        <button type="button" className={`tile dry-click ${kind === "alquiler" ? "on" : ""}`} onClick={() => filter({ kind: "alquiler" })}>
          <div className="v">{stats ? kindTotals.alquiler : "—"}</div><div className="l">Alquiler DRY</div>
        </button>
        <button type="button" className={`tile dry-click ${kind === "otros" ? "on" : ""}`} onClick={() => filter({ kind: "otros" })}>
          <div className="v">{stats ? kindTotals.otros : "—"}</div><div className="l">Otros</div>
        </button>
        <button type="button" className={`tile dry-click ${pipeline === "ingreso" ? "on" : ""}`} onClick={() => filter({ pipeline: "ingreso" })}>
          <div className="v">{stats?.pipeline?.ingreso ?? "—"}</div><div className="l">Ya son ingreso</div>
        </button>
      </div>

      <h3 className="dry-h">Embudo — pulsa para ver esas cotizaciones</h3>
      <div className="dry-funnel">
        {Object.entries(PIPE_LABEL).map(([k, lab]) => {
          const n = stats?.pipeline?.[k] || 0;
          const max = Math.max(1, ...Object.values(stats?.pipeline || { a: 1 }));
          return (
            <button key={k} type="button" className={`dry-funnel-row dry-click ${pipeline === k ? "on" : ""}`} onClick={() => filter({ pipeline: pipeline === k ? "all" : k })}>
              <span>{lab}</span>
              <div className="dry-bar"><i style={{ width: `${(n / max) * 100}%` }} /></div>
              <b>{n}</b>
            </button>
          );
        })}
      </div>

      <h3 className="dry-h">Por año</h3>
      <div className="dry-years">
        {years.map((y) => (
          <div key={y} className={`tile dry-year ${year === y ? "on" : ""}`}>
            <h4><button type="button" className="dry-link" onClick={() => filter({ year: year === y ? "all" : y })}>{y}</button></h4>
            {["venta", "alquiler", "otros"].map((k) => {
              const b = block(y, k);
              if (!b) return null;
              return (
                <button key={k} type="button" className={`dry-year-kind dry-click ${year === y && kind === k ? "on" : ""}`} onClick={() => filter({ year: y, kind: k })}>
                  <b>{KIND_LABEL[k]}</b>
                  <p>Cotiz. {b.quotes} · Confirm. {b.confirmadas} · Por facturar {b.porFacturar} · Ingreso {b.ingresos} · Cancel. {b.canceladas}</p>
                  <p>Conversión a pedido {b.confirmRate}% · de pedido a factura {b.invoiceRate}%</p>
                  <p>Cotizado {money(b.amountQuoted)} · Ingreso {money(b.amountIngreso)}</p>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <h3 className="dry-h">Comerciales — ranking por ingreso facturado</h3>
      <p className="section-sub">El ingreso es SO ya facturada (dinero real). En proceso = confirmada o por facturar. Pulsa un nombre para ver sus cotizaciones.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Comercial</th>
              <th>Ventas</th>
              <th>Alquileres</th>
              <th>Cotiz.</th>
              <th>En proceso</th>
              <th>Facturadas</th>
              <th>% del ingreso</th>
              <th>Pedido→factura</th>
              <th>Ticket USD</th>
              <th>Monto facturado</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.vendors || []).map((v) => (
              <tr key={v.name} className={vendor === v.name ? "on" : ""}>
                <td>{v.rank}</td>
                <td><button type="button" className="dry-link" onClick={() => filter({ vendor: vendor === v.name ? "" : v.name })}>{v.name}</button></td>
                <td><button type="button" className="dry-link" onClick={() => filter({ vendor: v.name, kind: "venta" })}>{v.venta}</button></td>
                <td><button type="button" className="dry-link" onClick={() => filter({ vendor: v.name, kind: "alquiler" })}>{v.alquiler}</button></td>
                <td>{v.cotizacion}</td>
                <td>{v.proceso}</td>
                <td>{v.ingresos}</td>
                <td>{v.shareIngreso}%</td>
                <td>{v.invoiceRate}%</td>
                <td>{v.ticketUsd ? `USD ${v.ticketUsd.toLocaleString("en-US")}` : "—"}</td>
                <td>{money(v.amountIngreso)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="dry-h">Comparar dos comerciales</h3>
      <div className="action-row" style={{ marginBottom: 10 }}>
        <select value={cmpA} onChange={(e) => setCmpA(e.target.value)} aria-label="Comercial A">
          <option value="">Comercial A</option>
          {(stats?.vendors || []).map((v) => <option key={`a-${v.name}`} value={v.name}>{v.rank}. {v.name}</option>)}
        </select>
        <select value={cmpB} onChange={(e) => setCmpB(e.target.value)} aria-label="Comercial B">
          <option value="">Comercial B</option>
          {(stats?.vendors || []).map((v) => <option key={`b-${v.name}`} value={v.name}>{v.rank}. {v.name}</option>)}
        </select>
      </div>
      {cmpA && cmpB && cmpA !== cmpB ? (
        <VendorCompare a={(stats?.vendors || []).find((v) => v.name === cmpA)} b={(stats?.vendors || []).find((v) => v.name === cmpB)} />
      ) : (
        <p className="section-sub">Elige dos nombres para ver quién cierra más venta y quién deja más cotizaciones abiertas.</p>
      )}

      <h3 className="dry-h">Mejora mes a mes — cotización / en proceso / facturado</h3>
      <p className="section-sub">Facturado = ingreso real. Δ es contra el mes anterior. Pulsa el mes para listar esas SO.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Mes</th>
              <th>Cotización</th>
              <th>En proceso</th>
              <th>Facturado</th>
              <th>Cancelada</th>
              <th>% a factura</th>
              <th>Δ facturado</th>
              <th>Δ cotización</th>
              <th>Δ proceso</th>
              <th>Ingreso</th>
              <th>Δ ingreso USD</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.months || []).filter((m) => year === "all" || m.month.startsWith(year)).map((m) => (
              <tr key={m.month} className={month === m.month ? "on" : ""}>
                <td><button type="button" className="dry-link" onClick={() => filter({ month: month === m.month ? "" : m.month, year: m.month.slice(0, 4) })}>{m.month}</button></td>
                <td><button type="button" className="dry-link" onClick={() => filter({ month: m.month, year: m.month.slice(0, 4), pipeline: "cotizacion" })}>{m.cotizacion}</button></td>
                <td>{m.proceso}</td>
                <td><button type="button" className="dry-link" onClick={() => filter({ month: m.month, year: m.month.slice(0, 4), pipeline: "ingreso" })}>{m.facturado}</button></td>
                <td>{m.cancelada}</td>
                <td>{m.conversionFactura}%</td>
                <td>{m.deltaFacturado == null ? "—" : signed(m.deltaFacturado)}</td>
                <td>{m.deltaCotizacion == null ? "—" : signed(m.deltaCotizacion)}</td>
                <td>{m.deltaProceso == null ? "—" : signed(m.deltaProceso)}</td>
                <td>{money(m.amountIngreso)}</td>
                <td>{m.deltaIngresoUsd == null ? "—" : signed(m.deltaIngresoUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.keys(stats?.otrosByReason || {}).length ? (
        <>
          <h3 className="dry-h">Desglose de «otros»</h3>
          <p className="section-sub">
            {Object.entries(stats.otrosByReason).map(([k, n]) => `${OTROS_LABEL[k] || k}: ${n}`).join(" · ")}
          </p>
        </>
      ) : null}

      <h3 className="dry-h">Cotizaciones que conforman el número</h3>
      <form className="action-row" onSubmit={searchDeals} style={{ marginBottom: 10 }}>
        <select value={year} onChange={(e) => filter({ year: e.target.value })} aria-label="Año">
          <option value="all">2023 a 2026</option>
          <option value="2023">2023</option>
          <option value="2024">2024</option>
          <option value="2025">2025</option>
          <option value="2026">2026</option>
        </select>
        <select value={kind} onChange={(e) => filter({ kind: e.target.value })} aria-label="Tipo">
          <option value="all">Venta, alquiler y otros</option>
          <option value="venta">Solo venta</option>
          <option value="alquiler">Solo alquiler</option>
          <option value="otros">Solo otros</option>
        </select>
        <select value={pipeline} onChange={(e) => filter({ pipeline: e.target.value })} aria-label="Estado">
          <option value="all">Todos los estados</option>
          {Object.entries(PIPE_LABEL).map(([k, lab]) => <option key={k} value={k}>{lab}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SO, cliente, comercial, asunto" aria-label="Buscar" />
        <button className="btn-ghost" type="submit">Buscar en local</button>
        {(vendor || month) ? (
          <span className="section-sub">
            {vendor ? `Comercial: ${vendor}` : ""}{month ? ` · ${month}` : ""}
            {" "}
            <button type="button" className="dry-link" onClick={() => filter({ vendor: "", month: "" })}>quitar</button>
          </span>
        ) : null}
      </form>
      <p className="section-sub">{dealTotal} cotizaciones en este filtro. Pulsa una fila para ver líneas, despacho, factura y notas.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>SO</th>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Comercial</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>OUT</th>
              <th>IN</th>
              <th>Fact.</th>
              <th>Notas</th>
              <th>Archivos</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id} className="dry-row" onClick={() => openDeal(d)}>
                <td>{d.name}</td>
                <td>{d.month}</td>
                <td>{KIND_LABEL[d.kind] || d.kind}{d.otherReason ? ` · ${OTROS_LABEL[d.otherReason] || d.otherReason}` : ""}</td>
                <td>{d.vendorName}</td>
                <td>{d.partnerName}</td>
                <td>{PIPE_LABEL[d.pipeline] || d.pipeline}{d.paymentState ? ` · ${PAY_LABEL[d.paymentState] || d.paymentState}` : ""}</td>
                <td>{d.outCount}</td>
                <td>{d.inCount}</td>
                <td>{d.invoiceCount}</td>
                <td>{d.noteCount}</td>
                <td>{d.fileCount}</td>
                <td>{fmtMoney(d.currency, d.amountTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dealTotal > take ? (
        <div className="action-row">
          <button type="button" className="btn-ghost" disabled={skip <= 0} onClick={() => setSkip(Math.max(0, skip - take))}>Anterior</button>
          <span className="section-sub">{skip + 1}–{Math.min(skip + take, dealTotal)} de {dealTotal}</span>
          <button type="button" className="btn-ghost" disabled={skip + take >= dealTotal} onClick={() => setSkip(skip + take)}>Siguiente</button>
        </div>
      ) : null}

      {fichaBusy && !ficha ? <p className="section-sub">Abriendo ficha local…</p> : null}

      {ficha ? (
        <div className="overlay open" onClick={() => setFicha(null)}>
          <div className="modal dry-ficha" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>{ficha.name}</h3>
                <p className="section-sub">
                  {KIND_LABEL[ficha.kind]} · {PIPE_LABEL[ficha.pipeline]} · {ficha.vendorName} · {ficha.dossierStatus === "ok" ? "archivo local" : ficha.dossierStatus === "pending" ? "expediente pendiente" : ficha.dossierError || "sin expediente"}
                </p>
              </div>
              <button className="modal-close" type="button" onClick={() => setFicha(null)}>✕</button>
            </div>
            <div className="modal-body single dry-ficha-body">
              <p><b>{ficha.partnerName}</b>{ficha.partnerVat ? ` · RUC ${ficha.partnerVat}` : ""}</p>
              <p>{ficha.asunto}</p>
              <p>
                {fmtMoney(ficha.currency, ficha.amountTotal)}
                {ficha.amountTax ? ` · IGV ${fmtMoney(ficha.currency, ficha.amountTax)}` : ""}
                {ficha.paymentTerm ? ` · ${ficha.paymentTerm}` : ""}
                {ficha.warehouse ? ` · ${ficha.warehouse}` : ""}
                {ficha.paymentState ? ` · ${PAY_LABEL[ficha.paymentState] || ficha.paymentState}` : ""}
              </p>
              {ficha.note ? <p className="section-sub">{ficha.note}</p> : null}

              <h4>Líneas</h4>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Descripción</th>
                      <th>Cant.</th>
                      <th>Entregado</th>
                      <th>Facturado</th>
                      <th>P. unit</th>
                      <th>Subtotal</th>
                      <th>Serie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ficha.lines || []).filter((l) => l.displayType !== "line_section").map((l) => (
                      <tr key={l.id}>
                        <td>{l.description || l.productName}</td>
                        <td>{l.qty}</td>
                        <td>{l.qtyDelivered}</td>
                        <td>{l.qtyInvoiced}</td>
                        <td>{fmtMoney(ficha.currency, l.priceUnit)}</td>
                        <td>{fmtMoney(ficha.currency, l.priceSubtotal)}</td>
                        <td>{l.studioEquipo || l.lotName || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4>Entrada, salida, despacho y facturas</h4>
              {(ficha.docs || []).length ? (
                <ul className="dry-docs">
                  {(ficha.docs || []).map((doc) => (
                    <li key={doc.id}>
                      <b>{DOC_LABEL[doc.kind] || doc.kind}</b> {doc.name} · {doc.state}
                      {doc.paymentState ? ` · ${PAY_LABEL[doc.paymentState] || doc.paymentState}` : ""}
                      {doc.amount ? ` · ${fmtMoney(doc.currency || ficha.currency, doc.amount)}` : ""}
                      {doc.date ? ` · ${fmtWhen(doc.date)}` : ""}
                      {doc.isos?.length ? ` · ${doc.isos.join(", ")}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="section-sub">{ficha.dossierStatus === "pending" ? "Todavía no bajó el expediente de esta SO." : "Odoo no tiene OUT/IN ni factura ligada a esta cotización."}</p>
              )}

              <h4>Imágenes y documentos</h4>
              {(ficha.files || []).length ? (
                <div className="dry-files">
                  {(ficha.files || []).filter((f) => f.kind === "image").map((f) => (
                    <a key={f.id} className="dry-file-img" href={apiUrl(`/dry-stats/deals/${ficha.id}/files/${f.id}`)} target="_blank" rel="noreferrer">
                      <img src={apiUrl(`/dry-stats/deals/${ficha.id}/files/${f.id}`)} alt={f.name} />
                      <span>{f.name}</span>
                    </a>
                  ))}
                  {(ficha.files || []).filter((f) => f.kind !== "image").map((f) => (
                    <a key={f.id} className="dry-file-doc" href={apiUrl(`/dry-stats/deals/${ficha.id}/files/${f.id}`)} target="_blank" rel="noreferrer">
                      {f.name} · {f.mimetype || "documento"}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="section-sub">Sin imágenes ni PDF en el chatter / adjuntos de esta SO (o aún se están bajando).</p>
              )}

              <h4>Notas y mensajes</h4>
              {(ficha.notes || []).length ? (
                <ol className="dry-notes">
                  {(ficha.notes || []).map((n) => (
                    <li key={n.id}>
                      <div className="dry-note-meta">{n.author || "Odoo"} · {fmtWhen(n.date)} · {n.messageType}</div>
                      <pre>{n.body}</pre>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="section-sub">{ficha.dossierStatus === "pending" ? "Las notas se copian cuando termina el expediente." : "Sin mensajes en el chatter de esta SO."}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
