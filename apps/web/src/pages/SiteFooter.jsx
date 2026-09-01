import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { DEFAULT_CATALOG_COPY, mergeCatalogCopy } from "../catalog-copy.js";

const COOKIE_KEY = "zdry.cookieConsent";

function IconFacebook() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="currentColor" d="M14.5 8.5H16V6h-1.5C12.6 6 11 7.6 11 9.5V11H9.5v2.5H11V20h2.5v-6.5H16l.5-2.5h-3V9.5c0-.6.4-1 1-1Z" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="currentColor" d="M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Zm8 1.8H8A2.2 2.2 0 0 0 5.8 8v8A2.2 2.2 0 0 0 8 18.2h8A2.2 2.2 0 0 0 18.2 16V8A2.2 2.2 0 0 0 16 5.8ZM12 8.6A3.4 3.4 0 1 1 8.6 12 3.4 3.4 0 0 1 12 8.6Zm0 1.7A1.7 1.7 0 1 0 13.7 12 1.7 1.7 0 0 0 12 10.3Zm3.7-2.6a.8.8 0 1 1-.8.8.8.8 0 0 1 .8-.8Z" />
    </svg>
  );
}

function CookieBanner({ copy, forceCookie }) {
  const [open, setOpen] = useState(!!forceCookie);
  useEffect(() => {
    if (forceCookie) {
      setOpen(true);
      return;
    }
    try {
      setOpen(!localStorage.getItem(COOKIE_KEY));
    } catch {
      setOpen(true);
    }
  }, [forceCookie]);

  function close(value) {
    if (!forceCookie) {
      try {
        localStorage.setItem(COOKIE_KEY, value);
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="cookie-bar" role="dialog" aria-label="Aviso de cookies">
      <p>{copy.cookieText}</p>
      <div className="cookie-actions">
        <button className="cookie-accept" type="button" onClick={() => close("accepted")}>{copy.cookieAccept}</button>
        <button className="cookie-x" type="button" aria-label="Cerrar" onClick={() => close("dismissed")}>×</button>
      </div>
    </div>
  );
}

export default function SiteFooter({ copy: copyProp, forceCookie = false }) {
  const [loaded, setLoaded] = useState(copyProp || null);

  useEffect(() => {
    if (copyProp) {
      setLoaded(mergeCatalogCopy(copyProp));
      return;
    }
    api("/catalog/copy")
      .then((d) => setLoaded(mergeCatalogCopy(d)))
      .catch(() => setLoaded(DEFAULT_CATALOG_COPY));
  }, [copyProp]);

  const copy = loaded || DEFAULT_CATALOG_COPY;
  const tel = (copy.phone || "").replace(/[^\d+]/g, "");

  return (
    <>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-top">
            <div className="site-social">
              {copy.facebook ? (
                <a href={copy.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                  <IconFacebook />
                </a>
              ) : null}
              {copy.instagram ? (
                <a href={copy.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <IconInstagram />
                </a>
              ) : null}
            </div>
            <nav className="site-legal-links" aria-label="Información legal">
              <Link to="/legal/terminos">{copy.legalTerms}</Link>
              <Link to="/legal/cookies">{copy.legalCookies}</Link>
              <Link to="/legal/privacidad">{copy.legalPrivacy}</Link>
              <Link to="/legal/datos">{copy.legalData}</Link>
            </nav>
          </div>
          <div className="site-footer-bottom">
            <div>
              <div className="site-copy">{copy.copyright}</div>
              <div className="site-company">{copy.company}</div>
              <div className="site-address">{copy.address}</div>
              <div className="site-contact">
                {copy.phone ? <a href={`tel:${tel}`}>{copy.phone}</a> : null}
                {copy.phone && copy.email ? " · " : null}
                {copy.email ? <a href={`mailto:${copy.email}`}>{copy.email}</a> : null}
              </div>
            </div>
            {copy.credit ? (
              copy.creditUrl ? (
                <a className="site-credit" href={copy.creditUrl} target="_blank" rel="noopener noreferrer">{copy.credit}</a>
              ) : (
                <span className="site-credit">{copy.credit}</span>
              )
            ) : null}
          </div>
        </div>
      </footer>
      <CookieBanner copy={copy} forceCookie={forceCookie} />
    </>
  );
}
