import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, apiUrl, goAppRoot, goCatalogHome, publicUrl } from "../api.js";
import { useAuth } from "../auth.jsx";
import {
  DEFAULT_CATALOG_COPY,
  STEP_ICONS,
  cartWhatsAppMessage,
  mergeCatalogCopy,
  unitWhatsAppMessage,
  whatsappUrl,
} from "../catalog-copy.js";
import SiteFooter from "./SiteFooter.jsx";
import { useLightbox } from "../media-lightbox.jsx";
import VideoMarks, { videoSilenceProps } from "../video-marks.jsx";

const CART_KEY = "zdry_cart";
const money = (n) => (n == null ? null : "$" + Math.round(Number(n)).toLocaleString("en-US"));
const GALLERY_MS = 3500;
const LEAD_MS = 5000;
const LIST_SPLASH_MSGS = [
  "Bienvenido a ZDRY...",
  "Consultando todos los Dry...",
  "Éxitos con tu compra...",
];

function CatalogSplash({ mode }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (mode !== "list") return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % LIST_SPLASH_MSGS.length), 1000);
    return () => clearInterval(t);
  }, [mode]);
  const text = mode === "detail" ? "Procesando detalles..." : LIST_SPLASH_MSGS[i];
  return (
    <div className="catalog-splash" role="status" aria-live="polite">
      <div className="catalog-splash-inner">
        <img className="catalog-splash-mark" src={publicUrl("/brand/z-transparent.webp")} alt="" />
        <p>{text}</p>
        <div className="catalog-splash-bar" aria-hidden="true"><i /></div>
      </div>
    </div>
  );
}

function HeroLeadCarousel({ leads }) {
  const items = leads?.length ? leads : [" "];
  const [i, setI] = useState(0);
  const [on, setOn] = useState(true);
  useEffect(() => { setI(0); }, [items.join("\n")]);
  useEffect(() => {
    if (items.length <= 1) return undefined;
    const t = setInterval(() => {
      setOn(false);
      window.setTimeout(() => {
        setI((x) => (x + 1) % items.length);
        setOn(true);
      }, 380);
    }, LEAD_MS);
    return () => clearInterval(t);
  }, [items.join("\n")]);
  return (
    <p className={`lead hero-lead ${on ? "on" : "off"}`} aria-live="polite">{items[i % items.length]}</p>
  );
}

function publishedSlots(u) {
  if (Array.isArray(u?.photos) && u.photos.length) return u.photos;
  return (u?.photoSlots || []).map((ok, i) => (ok ? i : null)).filter((x) => x !== null);
}

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M17.47 14.38c-.28-.14-1.66-.82-1.92-.91-.26-.1-.44-.14-.63.14-.18.27-.72.9-.88 1.08-.16.18-.33.2-.61.07-.28-.14-1.18-.43-2.25-1.38-.83-.74-1.39-1.65-1.55-1.93-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.18-.28.28-.46.09-.19.05-.35-.02-.49-.07-.14-.63-1.51-.86-2.07-.23-.55-.46-.47-.63-.48h-.54c-.18 0-.48.07-.73.35-.26.28-.96.94-.96 2.3 0 1.35 1 2.67 1.13 2.85.14.19 1.92 2.93 4.65 4.11.65.28 1.16.45 1.56.57.65.21 1.25.18 1.72.11.53-.08 1.63-.67 1.86-1.31.23-.64.23-1.19.16-1.31-.07-.11-.25-.18-.53-.32zM12.04 21.5h-.01A9.46 9.46 0 0 1 7.3 20.2L3 21.4l1.23-4.2A9.47 9.47 0 0 1 2.5 12C2.5 6.76 6.78 2.5 12.03 2.5 17.3 2.5 21.5 6.76 21.5 12c0 5.24-4.22 9.5-9.46 9.5zm0-17.3C7.48 4.2 3.8 7.86 3.8 12c0 1.64.48 3.24 1.4 4.62l-.91 3.13 3.22-.85a8.16 8.16 0 0 0 4.52 1.35h.01c4.55 0 8.25-3.68 8.25-8.25 0-4.56-3.7-8.25-8.25-8.25z" />
    </svg>
  );
}

function WhatsAppLink({ href, children, className = "btn-whatsapp", onClick }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
      <WaIcon />
      <span>{children}</span>
    </a>
  );
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

function ShareClock({ expiresAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const end = new Date(expiresAt).getTime();
  const left = Math.max(0, end - now);
  const total = Math.floor(left / 1000);
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const label = left <= 0 ? "00:00:00" : days > 0 ? `${days}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return (
    <div className="share-banner-until">
      <span>{left <= 0 ? "Venció" : "Tiempo restante"}</span>
      <b className="share-clock">{label}</b>
      <small>{new Date(expiresAt).toLocaleString("es-PE")}</small>
    </div>
  );
}

function CatalogClosed({ copy }) {
  const href = whatsappUrl(copy, "Hola, quiero ver el catálogo de contenedores dry. ¿Me puede atender un asesor?");
  return (
    <div className="site-page">
      <header className="topbar">
        <div className="topbar-inner topbar-public">
          <span className="brand"><img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></span>
        </div>
      </header>
      <div className="catalog-gate">
        <div className="catalog-gate-card">
          <p className="hero-kicker">ZGROUP</p>
          <h1>Contacta con un asesor</h1>
          <p>El catálogo se ve con tu sesión. Si aún no tienes acceso, escríbele a un asesor de ZGROUP por WhatsApp.</p>
          <a className="btn-whatsapp" href={href} target="_blank" rel="noreferrer">Hablar por WhatsApp</a>
        </div>
      </div>
      <SiteFooter copy={copy} />
    </div>
  );
}

function ShareLock({ share, error, onUnlock }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!share?.token || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api(`/catalog/share/${share.token}/unlock`, { method: "POST", body: { code } });
      onUnlock();
    } catch (ex) {
      setErr(ex.message || "Clave incorrecta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-page">
      <header className="topbar">
        <div className="topbar-inner topbar-public">
          <span className="brand"><img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></span>
        </div>
      </header>
      <div className="catalog-gate">
        <form className="catalog-gate-card share-lock" onSubmit={submit}>
          {error ? <div className="err">{error}</div> : null}
          {share ? (
            <>
              <aside className="share-banner">
                <div>
                  <span>Enlace de catálogo</span>
                  <b>Hola {share.clientName}</b>
                  <p>{share.vendorName} te comparte el stock. Escribe la clave de 6 dígitos que te envió.</p>
                </div>
                <ShareClock expiresAt={share.expiresAt} />
              </aside>
              <label htmlFor="share-code">Clave de acceso</label>
              <input
                id="share-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
              {err ? <div className="err">{err}</div> : null}
              <button className="btn-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "Comprobando…" : "Ver catálogo"}</button>
            </>
          ) : (
            <p>Abriendo el enlace…</p>
          )}
        </form>
      </div>
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
  const { iso: routeIso, shareToken } = useParams();
  const { user, ready, logout, login, register } = useAuth();
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
  const [reg, setReg] = useState({ name: "", email: "", phone: "", password: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [accountProfile, setAccountProfile] = useState(null);
  const [rucInput, setRucInput] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [dispatchPlace, setDispatchPlace] = useState("");
  const [copy, setCopy] = useState(DEFAULT_CATALOG_COPY);
  const [share, setShare] = useState(null);
  const [shareErr, setShareErr] = useState("");
  const [shareUnlocked, setShareUnlocked] = useState(false);
  const [splash, setSplash] = useState(null);
  const listSplashDone = useRef(false);
  const lb = useLightbox();

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    p.set("page", String(page));
    return p.toString();
  }, [filters, page]);

  const load = useCallback(() => {
    const showList = !routeIso && !listSplashDone.current;
    const started = Date.now();
    if (showList) setSplash("list");
    api(`/catalog?${query}`)
      .then((d) => {
        setData(d);
        if (!showList) return;
        const wait = Math.max(0, 3000 - (Date.now() - started));
        window.setTimeout(() => {
          listSplashDone.current = true;
          setSplash((cur) => (cur === "list" ? null : cur));
        }, wait);
      })
      .catch((e) => {
        if (shareToken && e.status === 401) {
          window.sessionStorage.removeItem(`zdry-share-ok:${shareToken}`);
          setShareUnlocked(false);
        }
        setError(e.message);
        if (showList) {
          listSplashDone.current = true;
          setSplash((cur) => (cur === "list" ? null : cur));
        }
      });
  }, [query, routeIso, shareToken]);

  const catalogOpen = Boolean(user) || Boolean(shareToken && shareUnlocked);

  useEffect(() => {
    if (!shareToken) {
      setShareUnlocked(false);
      return;
    }
    setShareUnlocked(window.sessionStorage.getItem(`zdry-share-ok:${shareToken}`) === "1");
  }, [shareToken]);

  useEffect(() => {
    api("/catalog/copy").then((d) => setCopy(mergeCatalogCopy(d))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!shareToken) {
      setShare(null);
      setShareErr("");
      return;
    }
    api(`/catalog/share/${shareToken}`)
      .then((s) => {
        setShare(s);
        setShareErr("");
        setCopy((cur) => ({
          ...cur,
          whatsapp: s.vendorWhatsapp || cur.whatsapp,
          coordinatorName: s.vendorName || cur.coordinatorName,
        }));
        api(`/catalog/share/${shareToken}/events`, { method: "POST", body: { kind: "open" } }).catch(() => {});
      })
      .catch((e) => {
        setShare(null);
        setShareErr(e.message || "Este enlace no es válido.");
      });
  }, [shareToken]);

  useEffect(() => {
    if (!ready || !catalogOpen) return;
    api("/catalog/meta").then(setMeta).catch(() => {});
  }, [ready, catalogOpen]);

  useEffect(() => {
    const lock = Boolean(pdp || quoteOpen || splash);
    document.body.classList.toggle("modal-locked", lock);
    return () => document.body.classList.remove("modal-locked");
  }, [pdp, quoteOpen, splash]);

  useEffect(() => {
    if (!ready || !catalogOpen) return;
    load();
  }, [load, ready, catalogOpen]);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!routeIso || !ready || !catalogOpen) {
      if (!routeIso) setPdp(null);
      return undefined;
    }
    setSplash("detail");
    const started = Date.now();
    let cancelled = false;
    api(`/catalog/${routeIso}`)
      .then((u) => {
        if (cancelled) return;
        const slots = publishedSlots(u);
        setPdp(u);
        setThumb(slots[0] ?? (u.hasVideo ? "video" : 0));
        setGalleryPaused(false);
        if (shareToken) {
          api(`/catalog/share/${shareToken}/events`, { method: "POST", body: { kind: "view_unit", iso: u.iso } }).catch(() => {});
          const first = slots[0];
          if (first != null) {
            api(`/catalog/share/${shareToken}/events`, { method: "POST", body: { kind: "view_image", iso: u.iso, detail: { slot: first } } }).catch(() => {});
          }
        }
      })
      .catch(() => {
        if (!cancelled) setPdp(null);
      })
      .finally(() => {
        const wait = Math.max(0, 1000 - (Date.now() - started));
        window.setTimeout(() => {
          if (!cancelled) setSplash((cur) => (cur === "detail" ? null : cur));
        }, wait);
      });
    return () => {
      cancelled = true;
    };
  }, [routeIso, ready, catalogOpen]);

  const loadAccount = useCallback(() => {
    if (!user || user.role !== "cliente") {
      setAccountProfile(null);
      return Promise.resolve(null);
    }
    return api("/account")
      .then((p) => {
        setAccountProfile(p);
        if (p.customer?.rucDni) setRucInput(p.customer.rucDni);
        return p;
      })
      .catch(() => null);
  }, [user]);

  useEffect(() => {
    if (quoteOpen) loadAccount();
  }, [quoteOpen, loadAccount]);

  const pdpSlots = publishedSlots(pdp);
  const pdpSlotKey = pdpSlots.join(",");
  const markSrc = apiUrl("/catalog/watermark");
  const pdpItems = pdp ? [
    ...pdpSlots.map((slot) => ({
      src: mediaSrc(pdp.iso, slot, pdp.mediaVersion),
      type: "image",
      label: `Foto ${slot + 1}`,
    })),
    ...(pdp.hasVideo ? [{
      src: `${apiUrl(`/catalog/${pdp.iso}/video`)}${pdp.mediaVersion ? `?v=${encodeURIComponent(pdp.mediaVersion)}` : ""}`,
      type: "video",
      label: "Video 360°",
      watermark: markSrc,
    }] : []),
  ] : [];
  const pdpLbIndex = thumb === "video" ? pdpSlots.length : Math.max(0, pdpSlots.indexOf(thumb));
  function openPdpMedia() {
    if (!pdpItems.length) return;
    setGalleryPaused(true);
    lb.open(pdpItems, pdpLbIndex);
  }
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

  function catalogHome() {
    return shareToken ? `/c/${shareToken}` : "/";
  }

  function trackShare(kind, iso, detail) {
    if (!shareToken) return;
    api(`/catalog/share/${shareToken}/events`, { method: "POST", body: { kind, iso, detail } }).catch(() => {});
  }

  useEffect(() => {
    if (!shareToken) return undefined;
    const q = filters.q.trim();
    if (!q) return undefined;
    const t = window.setTimeout(() => trackShare("search", null, { q }), 700);
    return () => window.clearTimeout(t);
  }, [filters.q, shareToken]);

  useEffect(() => {
    if (!shareToken) return;
    const detail = {};
    for (const key of ["type", "cat", "depot", "manufacturer", "sort"]) {
      if (filters[key]) detail[key] = filters[key];
    }
    if (!Object.keys(detail).length) return;
    trackShare("filter", null, detail);
  }, [filters.type, filters.cat, filters.depot, filters.manufacturer, filters.sort, shareToken]);

  function openUnit(iso) {
    nav(shareToken ? `/c/${shareToken}/u/${iso}` : `/u/${iso}`);
  }

  function closeUnit() {
    if (shareToken) nav(`/c/${shareToken}`);
    else goCatalogHome(nav);
  }

  function removeFromCart(iso) {
    setCart((c) => c.filter((x) => x !== iso));
  }

  function addToCart(iso) {
    if (!iso) return;
    setCart((c) => (c.includes(iso) ? c : [...c, iso]));
    trackShare("cart", iso);
  }

  function startFormalQuote(iso) {
    setError("");
    setMsg("");
    if (iso) addToCart(iso);
    setQuoteOpen(true);
  }

  const quotesOn = copy.quotesEnabled === true;
  const accountsOn = copy.accountsEnabled === true;

  async function submitQuote(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (!user) {
      setError("Crea tu cuenta (correo, contacto y teléfono) o entra para solicitar la cotización.");
      return;
    }
    if (user.role !== "cliente") {
      setError("El catálogo cotiza con una cuenta de cliente. Cierra la sesión de staff y entra o crea una cuenta de cliente.");
      return;
    }
    const prof = accountProfile || (await loadAccount());
    if (!prof?.quoteReady) {
      setError("Valida el RUC en SUNAT para emitir la cotización.");
      return;
    }
    setQuoting(true);
    try {
      const q = await api("/catalog/quotes", { method: "POST", body: { isos: cart, kind, dispatchPlace } });
      setCart([]);
      setQuoteOpen(false);
      nav("/mi-cuenta");
      setMsg(
        q.odoo?.saleName
          ? `Cotización Odoo ${q.odoo.saleName} emitida.`
          : q.odoo?.job?.error
            ? `Solicitud ${q.number} creada, pero Odoo no emitió: ${q.odoo.job.error}`
            : `Solicitud ${q.number} enviada. Se está emitiendo en Odoo.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cotizar");
    } finally {
      setQuoting(false);
    }
  }

  async function createAccountAndQuote(e) {
    e.preventDefault();
    setError("");
    if (!cart.length) return;
    try {
      await register({
        name: reg.name,
        email: reg.email,
        phone: reg.phone,
        password: reg.password,
      });
      const p = await api("/account");
      setAccountProfile(p);
      setMsg("Cuenta creada. Valida el RUC en SUNAT para pedir la cotización.");
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

  const unitWord = data.total === 1 ? copy.stockSingular : copy.stockPlural;

  if (!ready) return null;
  if (!shareToken && !user) return <CatalogClosed copy={copy} />;
  if (shareToken && !user && !shareUnlocked) {
    return (
      <ShareLock
        share={share}
        error={shareErr}
        onUnlock={() => {
          window.sessionStorage.setItem(`zdry-share-ok:${shareToken}`, "1");
          setShareUnlocked(true);
        }}
      />
    );
  }

  return (
    <div className="site-page">
      {splash ? <CatalogSplash mode={splash} /> : null}
      <header className="topbar">
        <div className="topbar-inner topbar-public">
          <Link to={catalogHome()} className="brand"><img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></Link>
          {user && !shareToken ? (
            <nav className="navtabs">
              {user.role === "cliente" ? <Link to="/mi-cuenta" className="navtab">Mi cuenta</Link> : null}
              {user.role !== "cliente" ? <Link to="/app" className="navtab">Dashboard</Link> : null}
            </nav>
          ) : null}
          <div className="topbar-tools">
            <button className="cart-pill" type="button" onClick={() => setQuoteOpen(true)}>
              🛒 <span className="cart-label">{copy.cartLabel}</span> <span>{cart.length}</span>
            </button>
            {shareToken ? null : user ? (
              <button className="btn-ghost btn-salir-ghost" type="button" onClick={async () => { await logout(); goAppRoot(); }}>
                {copy.logoutLabel}
              </button>
            ) : quotesOn || accountsOn ? (
              <Link to="/login" className="navtab">{copy.loginLabel}</Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className="hero">
        <div className="hero-inner">
          <p className="hero-kicker">{copy.heroKicker}</p>
          <h1>{copy.heroTitle}</h1>
          <HeroLeadCarousel leads={copy.heroLeads} />
          <ul className="hero-pills">
            {(copy.heroPills || []).map((p) => <li key={p}>{p}</li>)}
          </ul>
          <div className="quickfilter">
            <div className="qf-row">
              <div className="qf-field qf-search">
                <label>{copy.searchLabel}</label>
                <input value={filters.q} placeholder={copy.searchPlaceholder} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} />
              </div>
              <div className="qf-field">
                <label>{copy.typeLabel}</label>
                <select value={filters.type} onChange={(e) => { setPage(1); setFilters({ ...filters, type: e.target.value }); }}>
                  <option value="">{copy.typeAll}</option>
                  {(meta?.types || []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
              </div>
              <div className="qf-field">
                <label>{copy.conditionLabel}</label>
                <select value={filters.cat} onChange={(e) => { setPage(1); setFilters({ ...filters, cat: e.target.value }); }}>
                  <option value="">{copy.conditionAll}</option>
                  {(meta?.categories || []).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div className="qf-field">
                <label>{copy.depotLabel}</label>
                <select value={filters.depot} onChange={(e) => { setPage(1); setFilters({ ...filters, depot: e.target.value }); }}>
                  <option value="">{copy.depotAll}</option>
                  {(meta?.depots || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="view active catalog-wrap">
        {shareErr ? <div className="err">{shareErr}</div> : null}
        {share ? (
          <aside className="share-banner">
            <div>
              <span>Enlace de catálogo</span>
              <b>Hola {share.clientName}</b>
              <p>{share.vendorName} te comparte el stock disponible.</p>
            </div>
            <ShareClock expiresAt={share.expiresAt} />
          </aside>
        ) : null}
        {error ? <div className="err">{error}</div> : null}
        {msg ? <div className="ok-msg">{msg}</div> : null}
        <div className="stock-bar">
          <div className="stock-count">
            <span className="stock-n">{data.total}</span>
            <span className="stock-copy">
              <b>{unitWord}</b>
              <small>{copy.stockHint}</small>
            </span>
          </div>
          <label className="stock-sort">
            {copy.sortLabel}
            <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
              <option value="">{copy.sortIso}</option>
              <option value="price">{copy.sortPrice}</option>
              <option value="year">{copy.sortYear}</option>
            </select>
          </label>
        </div>
        <div className="steps-block">
          <h3 className="steps-title">{copy.stepsTitle}</h3>
          <div className="value-row">
            {(copy.steps || []).map((s, i) => (
              <div className="value-card step-card" key={s.title + i}>
                <div className="step-icon-wrap">
                  <img className="step-icon" src={publicUrl(STEP_ICONS[i] || STEP_ICONS[0])} alt="" />
                  <span className="step-n">{i + 1}</span>
                </div>
                <b>{s.title}</b>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
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
                    <div className="card-price">{money(u.gross)} <small>oferta · IGV incl. · neto {money(u.priceList)}</small></div>
                  ) : (
                    <span className="price-cta">{copy.requestPrice}</span>
                  )}
                  {quotesOn ? (
                    <button className="link-btn" type="button" onClick={() => startFormalQuote(u.iso)}>
                      {u.showPrice ? copy.requestQuote : copy.requestPrice}
                    </button>
                  ) : (
                    <WhatsAppLink className="link-btn" href={whatsappUrl(copy, unitWhatsAppMessage(copy, u, dispatchPlace))} onClick={() => trackShare("whatsapp", u.iso)}>
                      {copy.whatsappCta}
                    </WhatsAppLink>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
        {data.total === 0 ? (
          <p className="empty-stock">{copy.emptyStock}</p>
        ) : null}
        <div className="pager">
          {Array.from({ length: data.pages }, (_, i) => (
            <button key={i} className={`btn-ghost ${page === i + 1 ? "active" : ""}`} type="button" onClick={() => setPage(i + 1)}>{i + 1}</button>
          ))}
        </div>
      </div>

      <SiteFooter copy={copy} />

      {pdp ? (
        <div className="overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeUnit(); }}>
          <div className="modal pdp-modal">
            <div className="modal-head">
              <div>
                <h3>{pdp.typeLabel} · {pdp.iso}</h3>
                <div className="muted">{pdp.catLabel} · {pdp.depotName}</div>
              </div>
              <button className="modal-close" type="button" onClick={closeUnit}>✕</button>
            </div>
            <div className="modal-body">
              <div>
                <div className={`gallery-main ${pdpItems.length ? "can-zoom" : ""}`}>
                  {thumb === "video" && pdp.hasVideo ? (
                    <>
                      <video src={`${apiUrl(`/catalog/${pdp.iso}/video`)}${pdp.mediaVersion ? `?v=${encodeURIComponent(pdp.mediaVersion)}` : ""}`} controls autoPlay {...videoSilenceProps()} />
                      <VideoMarks src={markSrc} />
                      <button className="gallery-expand" type="button" onClick={openPdpMedia}>Ampliar</button>
                    </>
                  ) : pdpSlots.includes(thumb) ? (
                    <img
                      src={mediaSrc(pdp.iso, thumb, pdp.mediaVersion)}
                      alt={`${pdp.iso} foto ${thumb + 1}`}
                      onClick={openPdpMedia}
                    />
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
                          onClick={() => {
                            trackShare("view_image", pdp.iso, { slot });
                            if (thumb === slot) openPdpMedia();
                            else { setThumb(slot); setGalleryPaused(true); }
                          }}
                        >
                          <img src={mediaSrc(pdp.iso, slot, pdp.mediaVersion)} alt={`Miniatura ${slot + 1}`} />
                        </button>
                      ))}
                      {pdp.hasVideo ? (
                        <button
                          type="button"
                          className={`thumb video ${thumb === "video" ? "active" : ""}`}
                          onClick={() => {
                            trackShare("view_image", pdp.iso, { slot: "video" });
                            if (thumb === "video") openPdpMedia();
                            else { setThumb("video"); setGalleryPaused(true); }
                          }}
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
                      <div className="muted">Precio de oferta · IGV 18% {money(pdp.igv)} · neto {money(pdp.priceList)}</div>
                    </>
                  ) : (
                    <>
                      <div className="amt" style={{ fontSize: 20 }}>Solicitar precio</div>
                      <div className="muted">El comercial confirma el precio al cotizar.</div>
                    </>
                  )}
                </div>
                <div className="freight">
                  <label>Lugar de despacho</label>
                  <input
                    value={dispatchPlace}
                    onChange={(e) => setDispatchPlace(e.target.value)}
                    placeholder="Ej. Ate, Callao, Ica…"
                    maxLength={200}
                  />
                </div>
                <div className="pdp-cta-inline">
                  {pdp.reserved ? (
                    <button className="btn-primary" style={{ marginTop: 16, width: "100%" }} type="button" disabled>Reservado</button>
                  ) : (
                    <>
                      {quotesOn ? (
                        <button
                          className="btn-primary"
                          style={{ marginTop: 16, width: "100%" }}
                          type="button"
                          onClick={() => startFormalQuote(pdp.iso)}
                        >
                          {pdp.showPrice ? copy.requestQuote : copy.requestPrice}
                        </button>
                      ) : null}
                      <WhatsAppLink className={quotesOn ? "link-btn" : "btn-whatsapp"} href={whatsappUrl(copy, unitWhatsAppMessage(copy, pdp, dispatchPlace))} onClick={() => trackShare("whatsapp", pdp.iso)}>
                        {copy.whatsappCta}
                      </WhatsAppLink>
                    </>
                  )}
                </div>
              </div>
            </div>
            {pdp.reserved ? null : (
              <div className="pdp-cta-bar">
                {quotesOn ? (
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => startFormalQuote(pdp.iso)}
                  >
                    {pdp.showPrice ? copy.requestQuote : copy.requestPrice}
                  </button>
                ) : null}
                <WhatsAppLink className={quotesOn ? "link-btn" : "btn-whatsapp"} href={whatsappUrl(copy, unitWhatsAppMessage(copy, pdp, dispatchPlace))} onClick={() => trackShare("whatsapp", pdp.iso)}>
                  {copy.whatsappCta}
                </WhatsAppLink>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {quoteOpen ? (
        <div className="overlay open" onClick={(e) => { if (e.target === e.currentTarget) setQuoteOpen(false); }}>
          <div className="modal quote-modal">
            <div className="modal-head">
              <h3>{quotesOn ? "Solicitar cotización" : "Coordinar por WhatsApp"}</h3>
              <button className="modal-close" type="button" onClick={() => setQuoteOpen(false)}>✕</button>
            </div>
            <div className="modal-body single">
              {cart.length === 0 ? (
                <p className="section-sub">Elige una unidad en el catálogo o pulsa «Solicitar cotización» en la ficha.</p>
              ) : (
                <ul>{cart.map((iso) => (
                  <li key={iso} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                    <span className="card-iso">{iso}</span>
                    <button className="link-btn" type="button" onClick={() => removeFromCart(iso)}>Quitar</button>
                  </li>
                ))}</ul>
              )}
              <p className="section-sub" style={{ marginTop: 8 }}>
                {quotesOn
                  ? "Ver el stock es público. Crear cuenta no exige RUC. Para solicitar la cotización validamos el RUC en SUNAT."
                  : "La cotización en línea está en modo promoción. El comercial recibe tu interés por WhatsApp y arma la cotización."}
              </p>
              {error ? <div className="err">{error}</div> : null}
              <label>Lugar de despacho (referencial)</label>
              <input
                value={dispatchPlace}
                onChange={(e) => setDispatchPlace(e.target.value)}
                placeholder="Ej. Ate, Callao, Ica…"
                maxLength={200}
              />
              {quotesOn ? (
              <>
              <label>Tipo</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="venta">Venta</option>
                <option value="alquiler">Alquiler</option>
              </select>
              {kind === "alquiler" ? <div className="ok-msg">Se crea el presupuesto Odoo con servicio de alquiler + ISO a S/ 0. El comercial fija la cuota mensual.</div> : null}

              {user?.role === "cliente" ? (
                <form className="quote-form" onSubmit={submitQuote}>
                  <div className="ok-msg">Cuenta: {user.name} · {user.email}</div>
                  {accountProfile?.quoteReady ? (
                    <p className="section-sub">RUC {accountProfile.customer?.rucDni} · {accountProfile.customer?.companyName}</p>
                  ) : (
                    <>
                      <label>RUC (11 dígitos)</label>
                      <input value={rucInput} onChange={(e) => setRucInput(e.target.value)} placeholder="20XXXXXXXXX" inputMode="numeric" />
                      <p className="muted">
                        Consultas SUNAT restantes: {accountProfile?.rucLookup?.remaining ?? 5}/5
                        {accountProfile?.rucLookup?.lockedUntil ? ` · bloqueado hasta ${new Date(accountProfile.rucLookup.lockedUntil).toLocaleString("es-PE")}` : ""}
                      </p>
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={async () => {
                          setError("");
                          try {
                            await api("/account/ruc-lookup", { method: "POST", body: { ruc: rucInput } });
                            await loadAccount();
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : "No se pudo validar el RUC");
                            loadAccount();
                          }
                        }}
                      >
                        Consultar RUC en SUNAT
                      </button>
                    </>
                  )}
                  <button className="btn-primary" type="submit" disabled={!cart.length || !accountProfile?.quoteReady || quoting}>
                    {quoting ? "Emitiendo cotización Odoo…" : "Solicitar cotización"}
                  </button>
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
                      <div className="box-kicker">Persona de contacto</div>
                      <input placeholder="Nombre y apellido" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} required />
                      <input type="email" placeholder="Correo" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} required />
                      <input placeholder="Teléfono" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} required />
                      <input type="password" placeholder="Contraseña (mín. 8)" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} required minLength={8} />
                      <p className="muted">El RUC se valida después, al pedir la cotización (SUNAT).</p>
                      <button className="btn-primary" type="submit" disabled={!cart.length}>Crear cuenta</button>
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
              </>
              ) : null}
              <p className="muted" style={{ marginTop: 16 }}>
                <WhatsAppLink className="btn-whatsapp" href={whatsappUrl(copy, cart.length ? cartWhatsAppMessage(copy, cart, dispatchPlace) : cartWhatsAppMessage(copy, [], dispatchPlace))} onClick={() => trackShare("whatsapp", cart[0])}>
                  {copy.whatsappCta}
                </WhatsAppLink>
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {lb.node}
    </div>
  );
}
