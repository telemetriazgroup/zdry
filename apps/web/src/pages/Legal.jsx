import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api, publicUrl } from "../api.js";
import { DEFAULT_CATALOG_COPY, legalParagraphs, mergeCatalogCopy } from "../catalog-copy.js";
import SiteFooter from "./SiteFooter.jsx";

const SLUGS = {
  terminos: { title: "legalTerms", body: "legalTermsBody" },
  cookies: { title: "legalCookies", body: "legalCookiesBody" },
  privacidad: { title: "legalPrivacy", body: "legalPrivacyBody" },
  datos: { title: "legalData", body: "legalDataBody" },
};

export default function Legal() {
  const { slug } = useParams();
  const spec = SLUGS[slug];
  const [copy, setCopy] = useState(DEFAULT_CATALOG_COPY);

  useEffect(() => {
    api("/catalog/copy")
      .then((d) => setCopy(mergeCatalogCopy(d)))
      .catch(() => {});
  }, []);

  if (!spec) return <Navigate to="/" replace />;

  return (
    <div className="site-page">
      <header className="topbar">
        <div className="topbar-inner topbar-public">
          <Link to="/" className="brand"><img src={publicUrl("/brand/LOGO_Z.png")} alt="ZDRY" /></Link>
          <div className="topbar-tools">
            <Link to="/" className="navtab">Catálogo</Link>
          </div>
        </div>
      </header>
      <div className="page legal-page">
        <h1 className="section-title">{copy[spec.title]}</h1>
        <div className="legal-body">
          {legalParagraphs(copy[spec.body]).map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
        </div>
        <Link to="/" className="link-btn">← Volver al catálogo</Link>
      </div>
      <SiteFooter copy={copy} />
    </div>
  );
}
