import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, apiUrl, publicUrl } from "../api.js";
import { useAuth } from "../auth.jsx";

const CART_KEY = "zdry_cart";
const money = (n) => (n == null ? null : "$" + Math.round(Number(n)).toLocaleString("en-US"));
const GALLERY_MS = 3500;

function publishedSlots(u) {
  if (Array.isArray(u?.photos) && u.photos.length) return u.photos;
  return (u?.photoSlots || []).map((ok, i) => (ok ? i : null)).filter((x) => x !== null);
}

function mediaSrc(iso, slot, version) {
  const q = version ? `?v=${encodeURIComponent(version)}` : "";
  return `${apiUrl(`/catalog/${iso}/photos/${slot}`)}${q}`;
}

function CardCover({ iso, slots, version }) {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  useEffect(() => { setI(0); }, [iso, slots.join(",")]);
  useEffect(() => {
    if (hover || slots.length <= 1) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % slots.length), GALLERY_MS);
    return () => clearInterval(t);
  }, [hover, slots.length, iso]);
  const slot = slots[i];
  if (slot == null) return <span className="muted">Sin foto</span>;
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <img src={mediaSrc(iso, slot, version)} alt={iso} />
    </div>
  );
}

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export default function Catalog() {
  const { iso: routeIso } = useParams();
  const { user, logout, login, register } = useAuth();
  const nav = useNavigate();
  const [meta, setMeta] = useState(null);
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 });
  const [filters, setFilters] = useState({ q: "", type: "", cat: "", depot: "", manufacturer: "", sort: "" });
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState(loadCart);
  const [pdp, setPdp] = useState(null);
  const [thumb, setThumb] = useState(0);
  const [galleryPaused, setGalleryPaused] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [kind, setKind] = useState("venta");
  const [authMode, setAuthMode] = useState("register");
  const [reg, setReg] = useState({ companyName: "", rucDni: "", name: "", email: "", phone: "", password: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [zoneId, setZoneId] = useState("fz1");
  const [freight, setFreight] = useState(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    p.set("page", String(page));
    return p.toString();
  }, [filters, page]);

  const load = useCallback(() => {
    api(`/catalog?${query}`).then(setData).catch((e) => setError(e.message));
  }, [query]);

  useEffect(() => {
    api("/catalog/meta").then(setMeta).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (routeIso) {
      api(`/catalog/${routeIso}`)
        .then((u) => {
          const slots = publishedSlots(u);
          setPdp(u);
          setThumb(slots[0] ?? (u.hasVideo ? "video" : 0));
          setGalleryPaused(false);
        })
        .catch(() => setPdp(null));
    } else {
      setPdp(null);
    }
  }, [routeIso]);

  const pdpSlots = publishedSlots(pdp);
  const pdpSlotKey = pdpSlots.join(",");
  useEffect(() => {
    if (!pdp || galleryPaused || pdpSlots.length < 2) return undefined;
    const id = setInterval(() => {
      setThumb((cur) => {
        if (cur === "video") return cur;
        const idx = pdpSlots.indexOf(cur);
        return pdpSlots[(idx < 0 ? 0 : idx + 1) % pdpSlots.length];
      });
    }, GALLERY_MS);
    return () => clearInterval(id);
  }, [pdp, galleryPaused, pdpSlotKey]);

  function openUnit(iso) {
    nav(`/u/${iso}`);
  }

  function addToCart(iso) {
    setCart((c) => (c.includes(iso) ? c : [...c, iso]));
  }

  function removeFromCart(iso) {
    setCart((c) => c.filter((x) => x !== iso));
  }

  async function estimateFreight(isoType) {
    if (!zoneId) return;
    const types = isoType || (pdp ? pdp.type : "");
    try {
      const r = await api(`/catalog/freight?zoneId=${zoneId}&types=${encodeURIComponent(types)}`);
      setFreight(r);
    } catch {
      setFreight(null);
    }
  }

  async function submitQuote(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (!user) {
      setError("Crea tu cuenta (empresa + persona de contacto) o entra para solicitar la cotización.");
      return;
    }
    if (user.role !== "cliente") {
      setError("El catálogo cotiza con una cuenta de cliente. Entra con cliente@andina.pe o crea una cuenta nueva.");
      return;
    }
    try {
      const q = await api("/catalog/quotes", { method: "POST", body: { isos: cart, kind } });
      setCart([]);
      setQuoteOpen(false);
      nav("/mi-cuenta");
      setMsg(`Solicitud ${q.number} enviada.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cotizar");
    }
  }

  async function createAccountAndQuote(e) {
    e.preventDefault();
    setError("");
    if (!cart.length) return;
    try {
      await register({
        companyName: reg.companyName,
        rucDni: reg.rucDni,
        name: reg.name,
        email: reg.email,
        phone: reg.phone,
        password: reg.password,
      });
      const q = await api("/catalog/quotes", { method: "POST", body: { isos: cart, kind } });
      setCart([]);
      setQuoteOpen(false);
      nav("/mi-cuenta");
      setMsg(`Solicitud ${q.number} enviada.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la cuenta o cotizar");
    }
  }

  async function loginAndStay(e) {
    e.preventDefault();
    setError("");
    try {
      const u = await login(loginForm.email, loginForm.password);
      if (u.role !== "cliente") {
        setError("Esta cuenta es de staff. Para cotizar usa o crea una cuenta de cliente.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo entrar");
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></Link>
          <nav className="navtabs">
            <Link to="/" className="navtab active-link">Catálogo</Link>
            {user?.role === "cliente" ? <Link to="/mi-cuenta" className="navtab">Mi cuenta</Link> : null}
            {user && user.role !== "cliente" ? <Link to="/app" className="navtab">Dashboard</Link> : null}
          </nav>
          <button className="cart-pill" type="button" onClick={() => setQuoteOpen(true)}>
            🛒 Cotización <span>{cart.length}</span>
          </button>
          {user ? (
            <button className="btn-ghost" type="button" style={{ color: "#fff", borderColor: "rgba(255,255,255,.25)", background: "transparent" }} onClick={async () => { await logout(); nav("/"); }}>
              Salir
            </button>
          ) : (
            <Link to="/login" className="navtab">Entrar</Link>
          )}
        </div>
      </header>

      <div className="hero">
        <div className="hero-inner">
          <h1>¿Qué necesitas almacenar o transportar?</h1>
          <p className="lead">Filtra por tamaño, condición y depósito, revisa la inspección multimedia estandarizada de cada unidad y cotiza en segundos. Solo mostramos unidades propias disponibles para la venta.</p>
          <div className="quickfilter">
            <div className="qf-row">
              <div className="qf-field qf-search">
                <label>Buscar</label>
                <input value={filters.q} placeholder="ISO, fabricante…" onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} />
              </div>
              <div className="qf-field">
                <label>Tipo</label>
                <select value={filters.type} onChange={(e) => { setPage(1); setFilters({ ...filters, type: e.target.value }); }}>
                  <option value="">Todos</option>
                  {(meta?.types || []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
              </div>
              <div className="qf-field">
                <label>Condición</label>
                <select value={filters.cat} onChange={(e) => { setPage(1); setFilters({ ...filters, cat: e.target.value }); }}>
                  <option value="">Todas</option>
                  {(meta?.categories || []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div className="qf-field">
                <label>Depósito</label>
                <select value={filters.depot} onChange={(e) => { setPage(1); setFilters({ ...filters, depot: e.target.value }); }}>
                  <option value="">Todos</option>
                  {(meta?.depots || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="view active catalog-wrap">
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="ok-msg">{msg}</div> : null}
        <div className="catalog-toolbar">
          <div className="result-count">{data.total} unidades en catálogo</div>
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
            <option value="">ISO</option>
            <option value="price">Precio</option>
            <option value="year">Año</option>
          </select>
        </div>
        <div className="grid">
          {data.items.map((u) => (
            <article className="card" key={u.iso}>
              <div className="card-media" onClick={() => openUnit(u.iso)}>
                <CardCover iso={u.iso} slots={publishedSlots(u)} version={u.mediaVersion} />
                <span className="badge" style={{ background: "var(--navy)" }}>{u.type}</span>
                <span className="badge-status">{u.status}</span>
                {u.demo ? <span className="badge-status" style={{ top: 34, background: "#d9622f" }}>DEMO</span> : null}
              </div>
              <div className="card-body">
                <div className="card-title">{u.typeLabel}</div>
                <div className="card-iso">{u.iso}</div>
                <div className="card-meta">
                  <span><b>{u.catLabel}</b></span>
                  <span>{u.manufacturer} · {u.year || "—"}</span>
                  <span>{u.depotName}</span>
                </div>
                <div className="card-footer">
                  {u.showPrice ? (
                    <div className="card-price">{money(u.gross)} <small>+ IGV incluido aprox. · neto {money(u.priceList)}</small></div>
                  ) : (
                    <div className="price-cta">💬 Solicitar precio</div>
                  )}
                  <button className="link-btn" type="button" onClick={() => addToCart(u.iso)} disabled={u.status === "Reservado"}>
                    {cart.includes(u.iso) ? "En cotización" : "Agregar"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="pager">
          {Array.from({ length: data.pages }, (_, i) => (
            <button key={i} className={`btn-ghost ${page === i + 1 ? "active" : ""}`} type="button" onClick={() => setPage(i + 1)}>{i + 1}</button>
          ))}
        </div>
      </div>

      {pdp ? (
        <div className="overlay open" onClick={(e) => { if (e.target === e.currentTarget) nav("/"); }}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <h3>{pdp.typeLabel} · {pdp.iso}</h3>
                <div className="muted">{pdp.catLabel} · {pdp.depotName}</div>
              </div>
              <button className="modal-close" type="button" onClick={() => nav("/")}>✕</button>
            </div>
            <div className="modal-body">
              <div>
                <div className="gallery-main">
                  {thumb === "video" && pdp.hasVideo ? (
                    <video src={`${apiUrl(`/catalog/${pdp.iso}/video`)}${pdp.mediaVersion ? `?v=${encodeURIComponent(pdp.mediaVersion)}` : ""}`} controls autoPlay muted playsInline />
                  ) : pdpSlots.includes(thumb) ? (
                    <img src={mediaSrc(pdp.iso, thumb, pdp.mediaVersion)} alt={`${pdp.iso} foto ${thumb + 1}`} />
                  ) : (
                    <span className="muted">Sin foto de inspección publicada</span>
                  )}
                </div>
                {pdpSlots.length || pdp.hasVideo ? (
                  <>
                    <div className="gallery-thumbs">
                      {pdpSlots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          className={`thumb ${thumb === slot ? "active" : ""}`}
                          onClick={() => { setThumb(slot); setGalleryPaused(true); }}
                        >
                          <img src={mediaSrc(pdp.iso, slot, pdp.mediaVersion)} alt={`Miniatura ${slot + 1}`} />
                        </button>
                      ))}
                      {pdp.hasVideo ? (
                        <button
                          type="button"
                          className={`thumb video ${thumb === "video" ? "active" : ""}`}
                          onClick={() => { setThumb("video"); setGalleryPaused(true); }}
                        >
                          360°
                        </button>
                      ) : null}
                    </div>
                    {pdpSlots.length > 1 ? (
                      <p className="gallery-hint">
                        {galleryPaused ? (
                          <>
                            Vista fija.{" "}
                            <button type="button" className="link-btn" onClick={() => setGalleryPaused(false)}>Reanudar recorrido</button>
                          </>
                        ) : (
                          "Las fotos recorren solas. Pulsa una miniatura para fijar esa vista."
                        )}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div>
                <table className="spec-table">
                  <tbody>
                    <tr><td>Fabricante</td><td>{pdp.manufacturer}</td></tr>
                    <tr><td>Año</td><td>{pdp.year || "—"}</td></tr>
                    <tr><td>Tara / MGW</td><td>{pdp.tareKg} / {pdp.mgwKg} kg</td></tr>
                    <tr><td>Color</td><td>{pdp.color}</td></tr>
                  </tbody>
                </table>
                {pdp.inspectionNotes ? <p className="section-sub" style={{ marginTop: 10 }}>{pdp.inspectionNotes}</p> : null}
                <div className="price-box">
                  {pdp.showPrice ? (
                    <>
                      <div className="amt">{money(pdp.gross)}</div>
                      <div className="muted">IGV 18% {money(pdp.igv)} · neto {money(pdp.priceList)}</div>
                    </>
                  ) : (
                    <div className="amt" style={{ fontSize: 20 }}>Solicitar precio</div>
                  )}
                </div>
                <div className="freight">
                  <div className="muted">Estimado de flete (stub)</div>
                  <div className="freight-row">
                    <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                      {(meta?.freightZones || []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                    <button className="btn-ghost" type="button" onClick={() => estimateFreight(pdp.type)}>Calcular</button>
                  </div>
                  {freight ? <div className="freight-result show">≈ {money(freight.minSell)} · {freight.km} km · {freight.days} día(s)</div> : null}
                </div>
                <button className="btn-primary" style={{ marginTop: 16, width: "100%" }} type="button" disabled={pdp.reserved} onClick={() => { addToCart(pdp.iso); setQuoteOpen(true); }}>
                  {pdp.reserved ? "Reservado" : "Agregar a cotización"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {quoteOpen ? (
        <div className="overlay open" onClick={(e) => { if (e.target === e.currentTarget) setQuoteOpen(false); }}>
          <div className="modal quote-modal">
            <div className="modal-head">
              <h3>Solicitar cotización</h3>
              <button className="modal-close" type="button" onClick={() => setQuoteOpen(false)}>✕</button>
            </div>
            <div className="modal-body single">
              {cart.length === 0 ? <p className="section-sub">Tu cotización está vacía. El catálogo es público: puedes agregar unidades sin cuenta.</p> : (
                <ul>{cart.map((iso) => (
                  <li key={iso} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                    <span className="card-iso">{iso}</span>
                    <button className="link-btn" type="button" onClick={() => removeFromCart(iso)}>Quitar</button>
                  </li>
                ))}</ul>
              )}
              <p className="section-sub" style={{ marginTop: 8 }}>
                Ver el stock es público. Para <b>solicitar, reservar, negociar o pagar</b> necesitas una cuenta con datos de tu empresa y una persona de contacto. Ahí verás las cuentas de ZDRY para transferir y adjuntar el voucher.
              </p>
              {error ? <div className="err">{error}</div> : null}
              <label>Tipo</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="venta">Venta</option>
                <option value="alquiler">Alquiler (solicitud)</option>
              </select>
              {kind === "alquiler" ? <div className="locked-note">El contrato de alquiler completo entra en el Sprint 5. Esta solicitud queda como cotización nueva.</div> : null}

              {user?.role === "cliente" ? (
                <form className="quote-form" onSubmit={submitQuote}>
                  <div className="ok-msg">Cuenta: {user.name} · {user.email}</div>
                  <button className="btn-primary" type="submit" disabled={!cart.length}>Solicitar cotización</button>
                </form>
              ) : user ? (
                <div className="locked-note">Estás en una sesión de staff. Cierra sesión y entra o crea una <b>cuenta de cliente</b> para cotizar.</div>
              ) : (
                <>
                  <div className="subtab-row">
                    <button type="button" className={`subtab ${authMode === "register" ? "active" : ""}`} onClick={() => setAuthMode("register")}>Crear cuenta</button>
                    <button type="button" className={`subtab ${authMode === "login" ? "active" : ""}`} onClick={() => setAuthMode("login")}>Ya tengo cuenta</button>
                  </div>
                  {authMode === "register" ? (
                    <form className="quote-form" onSubmit={createAccountAndQuote}>
                      <div className="box-kicker">Empresa</div>
                      <input placeholder="Razón social" value={reg.companyName} onChange={(e) => setReg({ ...reg, companyName: e.target.value })} required />
                      <input placeholder="RUC / DNI" value={reg.rucDni} onChange={(e) => setReg({ ...reg, rucDni: e.target.value })} required />
                      <div className="box-kicker">Persona de contacto</div>
                      <input placeholder="Nombre y apellido" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} required />
                      <input type="email" placeholder="Correo" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} required />
                      <input placeholder="Teléfono" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} required />
                      <input type="password" placeholder="Contraseña (mín. 8)" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} required minLength={8} />
                      <button className="btn-primary" type="submit" disabled={!cart.length}>Crear cuenta y solicitar</button>
                    </form>
                  ) : (
                    <form className="quote-form" onSubmit={loginAndStay}>
                      <input type="email" placeholder="Correo" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} required />
                      <input type="password" placeholder="Contraseña" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required />
                      <button className="btn-primary" type="submit">Entrar</button>
                      <p className="muted">Luego pulsa «Solicitar cotización». El carrito se conserva.</p>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
