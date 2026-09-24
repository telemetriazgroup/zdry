import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatWhen } from "../api.js";
import { hasRole, ROLE_LABELS, useAuth } from "../auth.jsx";

function usd(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}

function DayBars({ series, color = "#1c7ed6" }) {
  const rows = series || [];
  const max = Math.max(1, ...rows.map((d) => d.count || 0));
  return (
    <div className="dash-bars" role="img" aria-label="Actividad diaria">
      {rows.map((d) => (
        <div key={d.date} className="dash-bar" title={`${d.date}: ${d.count}`}>
          <i style={{ height: `${Math.round(((d.count || 0) / max) * 100)}%`, background: color }} />
          <span>{d.date.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [hits, setHits] = useState([]);
  const [dash, setDash] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/health").then(setHealth).catch(() => setHealth({ ok: false }));
    api("/dashboard")
      .then(setDash)
      .catch((e) => setError(e.message || "No se pudo cargar el dashboard."));
    if (hasRole(user, "admin", "compras", "coordinador")) {
      api("/purchases/badges")
        .then((b) => setHits(Array.isArray(b.hits) ? b.hits : []))
        .catch(() => setHits([]));
    }
  }, [user?.role]);

  const stock = dash?.stock;
  const usage = dash?.usage;
  const series = dash?.series;
  const pendingValue = dash?.pendingValue;
  const odooChanges = dash?.odooChanges;
  const canConciliar = hasRole(user, "superadmin", "admin", "compras", "coordinador");

  return (
    <div className="home-dashboard">
      <h2 className="section-title">Inicio — {ROLE_LABELS[user.role]}</h2>
      <p className="section-sub">
        Estado de uso de ZDRY: stock, ingresos, visitas, recepciones y quién está trabajando. El catálogo público está en{" "}
        <a href="/" style={{ color: "var(--orange)", fontWeight: 700 }}>/</a>.
      </p>
      {hits.length ? (
        <div className="reconcile-banner">
          Hay {hits.length} serie(s) de patio para conciliar con IN/OC de Odoo
          {hits.slice(0, 3).map((h) => ` · ${h.iso}${h.odooPoName ? ` ↔ ${h.odooPoName}` : ""}`).join("")}.
          {" "}
          <Link to="/app/compras/conciliar">Ir a Conciliar</Link>
        </div>
      ) : null}
      {error ? <div className="err">{error}</div> : null}

      <div className="tile-row dash-kpis">
        <div className="tile">
          <div className="v">{stock ? stock.units : "…"}</div>
          <div className="l">Unidades en stock</div>
        </div>
        {dash?.showCost ? (
          <>
            <div className="tile">
              <div className="v">{usd(stock?.cost)}</div>
              <div className="l">Costo stock</div>
            </div>
            <div className="tile">
              <div className="v">{usd(stock?.extras)}</div>
              <div className="l">Extras stock</div>
            </div>
            <div className="tile">
              <div className="v">{usd(stock?.base)}</div>
              <div className="l">Base + extras</div>
            </div>
          </>
        ) : null}
        <div className="tile">
          <div className="v">{usage ? usage.published : "…"}</div>
          <div className="l">Publicadas</div>
        </div>
        <div className="tile">
          <div className="v">{usage ? usage.pendingPublish : "…"}</div>
          <div className="l">Pendientes de publicar</div>
        </div>
        <div className="tile">
          <div className="v">{pendingValue ? pendingValue.count : "…"}</div>
          <div className="l">Reentregas sin OC</div>
        </div>
        <div className="tile">
          <div className="v">{odooChanges ? odooChanges.week : "…"}</div>
          <div className="l">Cambios Odoo · 7d</div>
        </div>
        <div className="tile">
          <div className="v">{health?.ok ? "OK" : "…"}</div>
          <div className="l">{health?.odoo === "enabled" ? "API · Odoo" : "API"}</div>
        </div>
      </div>

      <div className="dash-grid home-dash-grid">
        {dash?.showCost ? (
          <>
            <div className="panel">
              <h3>Costo en stock por tipo</h3>
              <p className="section-sub">Compra o referencial más extras de almacén/proveedor.</p>
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th>Tipo</th><th>Unid.</th><th>Costo</th><th>Extras</th><th>Base</th></tr></thead>
                  <tbody>
                    {(stock?.byType || []).map((r) => (
                      <tr key={r.key}>
                        <td>{r.key}</td>
                        <td>{r.units}</td>
                        <td>{usd(r.cost)}</td>
                        <td>{usd(r.extras)}</td>
                        <td>{usd(r.base)}</td>
                      </tr>
                    ))}
                    {!stock?.byType?.length ? <tr><td colSpan={5}>Sin unidades en stock.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <h3>Costo en stock por proveedor</h3>
              <p className="section-sub">Agrupado por proveedor Odoo de la OC. Sin proveedor = ajuste, MO o ingreso local.</p>
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th>Proveedor</th><th>Unid.</th><th>Costo</th><th>Extras</th><th>Base</th></tr></thead>
                  <tbody>
                    {(stock?.byVendor || []).map((r) => (
                      <tr key={r.key}>
                        <td>{r.key}</td>
                        <td>{r.units}</td>
                        <td>{usd(r.cost)}</td>
                        <td>{usd(r.extras)}</td>
                        <td>{usd(r.base)}</td>
                      </tr>
                    ))}
                    {!stock?.byVendor?.length ? <tr><td colSpan={5}>Sin unidades en stock.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="panel">
            <h3>Stock por tipo</h3>
            <p className="section-sub">Conteo operativo. El monto de costo lo ve Administración o Compras.</p>
            <div className="tablewrap">
              <table className="data">
                <thead><tr><th>Tipo</th><th>Unidades</th></tr></thead>
                <tbody>
                  {(stock?.byType || []).map((r) => (
                    <tr key={r.key}><td>{r.key}</td><td>{r.units}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="panel">
          <h3>Equipos ingresados por día</h3>
          <p className="section-sub">Altas de unidad en ZDRY · últimos 14 días.</p>
          <DayBars series={series?.ingresos} color="#2f9e44" />
        </div>
        <div className="panel">
          <h3>Visitas registradas por día</h3>
          <p className="section-sub">Visitas de puerta · últimos 14 días.</p>
          <DayBars series={series?.visitas} color="#1c7ed6" />
        </div>
        <div className="panel">
          <h3>Recepciones confirmadas por día</h3>
          <p className="section-sub">Confirmación de recepción en almacén · últimos 14 días.</p>
          <DayBars series={series?.recepciones} color="#d9622f" />
        </div>
        <div className="panel">
          <h3>Cambios Odoo en equipos asimilados</h3>
          <p className="section-sub">
            Eventos detectados (ficha, OC, factura, MO, existencias) sobre {odooChanges?.assimilatedUnits ?? "…"} unidad(es) asimiladas · 14 días.
          </p>
          <DayBars series={odooChanges?.series} color="#7048e8" />
          {(odooChanges?.byEvent || []).length ? (
            <ul className="dash-list" style={{ marginTop: 10 }}>
              {odooChanges.byEvent.map((r) => (
                <li key={r.key}><b>{r.count}</b><span>{r.key}</span></li>
              ))}
            </ul>
          ) : (
            <p className="section-sub" style={{ marginTop: 8 }}>Aún no hay cambios Odoo registrados sobre asimilados.</p>
          )}
        </div>
        <div className="panel">
          <h3>Reentregas sin OC / sin valor</h3>
          <p className="section-sub">
            Reentregas pendientes de match. No se publican en el catálogo hasta conciliar la orden de compra: sin OC no hay precio.
          </p>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>ISO</th><th>Tipo</th><th>Patio</th><th>Origen</th><th>Ingreso</th></tr></thead>
              <tbody>
                {(pendingValue?.items || []).map((c) => (
                  <tr key={c.iso}>
                    <td>{canConciliar ? <Link to="/app/compras/conciliar"><b>{c.iso}</b></Link> : <b>{c.iso}</b>}</td>
                    <td>{c.type}{c.cat ? ` · ${c.cat}` : ""}</td>
                    <td>{c.depot}</td>
                    <td>{c.origin === "manual" ? "Reentrega" : c.origin}</td>
                    <td>{formatWhen(c.at)}{c.by && c.by !== "—" ? ` · ${c.by}` : ""}</td>
                  </tr>
                ))}
                {!pendingValue?.items?.length ? (
                  <tr><td colSpan={5}>{pendingValue ? "No hay reentregas pendientes de valor." : "…"}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {canConciliar && pendingValue?.count ? (
            <p className="section-sub" style={{ marginTop: 8 }}>
              <Link to="/app/compras/conciliar">Conciliar {pendingValue.count} serie(s) con OC</Link>
            </p>
          ) : null}
        </div>
        <div className="panel">
          <h3>Últimos cambios Odoo</h3>
          <ul className="dash-list">
            {(odooChanges?.last || []).map((e) => (
              <li key={`${e.iso}-${e.event}-${e.at}`}>
                <b>{e.iso || "—"}</b>
                <span>{e.label}{e.action ? ` · ${e.action}` : ""} · {formatWhen(e.at)}</span>
              </li>
            ))}
            {!odooChanges?.last?.length ? <li className="muted">Sin movimientos Odoo en equipos asimilados en el período.</li> : null}
          </ul>
        </div>

        <div className="panel">
          <h3>Últimos usuarios conectados</h3>
          <ul className="dash-list">
            {(dash?.lastUsers || []).map((u) => (
              <li key={`${u.email}-${u.at}`}>
                <b>{u.name}</b>
                <span>{ROLE_LABELS[u.role] || u.role} · {formatWhen(u.at)}</span>
              </li>
            ))}
            {!dash?.lastUsers?.length ? <li className="muted">Aún no hay inicios de sesión en el período.</li> : null}
          </ul>
        </div>
        <div className="panel">
          <h3>Últimas publicaciones</h3>
          <ul className="dash-list">
            {(dash?.lastPublished || []).map((p) => (
              <li key={p.iso}>
                <Link to="/app/catalogo-media"><b>{p.iso}</b></Link>
                <span>{p.type}{p.cat ? ` · ${p.cat}` : ""} · {p.by} · {formatWhen(p.at)}</span>
              </li>
            ))}
            {!dash?.lastPublished?.length ? <li className="muted">Nadie ha publicado fichas todavía.</li> : null}
          </ul>
        </div>
      </div>

      {usage ? (
        <div className="panel dash-usage">
          <h3>Uso de ZDRY · últimos 7 días</h3>
          <div className="tile-row">
            <div className="tile"><div className="v">{usage.activeUsers}</div><div className="l">Usuarios activos</div></div>
            <div className="tile"><div className="v">{usage.loginsWeek}</div><div className="l">Ingresos al sistema</div></div>
            <div className="tile"><div className="v">{usage.ingresosWeek}</div><div className="l">Equipos dados de alta</div></div>
            <div className="tile"><div className="v">{usage.visitsWeek}</div><div className="l">Visitas</div></div>
            <div className="tile"><div className="v">{usage.quotesWeek}</div><div className="l">Cotizaciones</div></div>
            <div className="tile"><div className="v">{usage.pendingValue}</div><div className="l">Reentregas sin OC</div></div>
            <div className="tile"><div className="v">{usage.odooChangesWeek}</div><div className="l">Cambios Odoo</div></div>
            <div className="tile"><div className="v">{usage.stockUnits}</div><div className="l">Stock actual</div></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
