import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const COOKIE_KEY = "zdry.cookieConsent";
const COMPANY = "ZGROUP S.A.C.";
const ADDRESS = "MZ.D LTE 14 PROGRAMA DE VIVIENDA ACUARIO. Callao, Perú";
const PHONE = "+51 (1) 651-1974";
const EMAIL = "ventas@zgroup.com.pe";

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

function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(!localStorage.getItem(COOKIE_KEY));
    } catch {
      setOpen(true);
    }
  }, []);

  function close(value) {
    try {
      localStorage.setItem(COOKIE_KEY, value);
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="cookie-bar" role="dialog" aria-label="Aviso de cookies">
      <p>
        Usamos cookies para mejorar tu experiencia. Revisa nuestras{" "}
        <Link to="/legal/privacidad">política de privacidad</Link> y de{" "}
        <Link to="/legal/cookies">cookies</Link>.
      </p>
      <div className="cookie-actions">
        <button className="cookie-accept" type="button" onClick={() => close("accepted")}>Aceptar</button>
        <button className="cookie-x" type="button" aria-label="Cerrar" onClick={() => close("dismissed")}>×</button>
      </div>
    </div>
  );
}

export default function SiteFooter() {
  return (
    <>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-top">
            <div className="site-social">
              <a href="https://www.facebook.com/ZgroupSac" target="_blank" rel="noopener noreferrer" aria-label="Facebook de ZGROUP">
                <IconFacebook />
              </a>
              <a href="https://www.instagram.com/zgroup_modular_solution/" target="_blank" rel="noopener noreferrer" aria-label="Instagram de ZGROUP">
                <IconInstagram />
              </a>
            </div>
            <nav className="site-legal-links" aria-label="Información legal">
              <Link to="/legal/terminos">Términos y condiciones</Link>
              <Link to="/legal/cookies">Política de cookies</Link>
              <Link to="/legal/privacidad">Política de privacidad</Link>
              <Link to="/legal/datos">Oficial de Datos Personales</Link>
            </nav>
          </div>
          <div className="site-footer-bottom">
            <div>
              <div className="site-copy">© TODOS LOS DERECHOS RESERVADOS</div>
              <div className="site-company">{COMPANY}</div>
              <div className="site-address">{ADDRESS}</div>
              <div className="site-contact">
                <a href={`tel:${PHONE.replace(/[^\d+]/g, "")}`}>{PHONE}</a>
                {" · "}
                <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
              </div>
            </div>
            <a className="site-credit" href="https://ztrack.app/" target="_blank" rel="noopener noreferrer">
              Desarrollado por equipo ZTRACK
            </a>
          </div>
        </div>
      </footer>
      <CookieBanner />
    </>
  );
}
