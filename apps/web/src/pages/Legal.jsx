import { Link, Navigate, useParams } from "react-router-dom";
import { publicUrl } from "../api.js";
import SiteFooter from "./SiteFooter.jsx";

const PAGES = {
  terminos: {
    title: "Términos y condiciones",
    body: (
      <>
        <p>ZDRY es el catálogo de contenedores dry de ZGROUP S.A.C. para venta y alquiler. El stock publicado es propio, inspeccionado en patio, y la cotización no reserva la unidad hasta que un comercial la confirme.</p>
        <p>Las solicitudes de cotización (venta o alquiler) se atienden con los datos de empresa y contacto que registres. Los precios, plazos y extras se confirman por escrito en la cotización.</p>
        <p>ZGROUP S.A.C. — MZ.D LTE 14 PROGRAMA DE VIVIENDA ACUARIO. Callao, Perú.</p>
      </>
    ),
  },
  cookies: {
    title: "Política de cookies",
    body: (
      <>
        <p>Usamos cookies técnicas para mantener tu sesión, la cotización en curso y tu preferencia de este aviso. No usamos redes de publicidad de terceros en este catálogo.</p>
        <p>Puedes borrar las cookies desde el navegador. Al hacerlo deberás volver a entrar si tenías sesión abierta.</p>
      </>
    ),
  },
  privacidad: {
    title: "Política de privacidad",
    body: (
      <>
        <p>ZGROUP S.A.C. trata los datos que entregas al crear cuenta o cotizar (empresa, RUC/DNI, nombre, correo y teléfono) para atender la venta o el alquiler de contenedores dry y para contactarte sobre tu solicitud.</p>
        <p>No vendemos tu lista de contactos. Puedes pedir acceso, rectificación o baja escribiendo a ventas@zgroup.com.pe o al Oficial de Datos Personales.</p>
        <p>Domicilio: MZ.D LTE 14 PROGRAMA DE VIVIENDA ACUARIO. Callao, Perú. Tel. +51 (1) 651-1974.</p>
      </>
    ),
  },
  datos: {
    title: "Oficial de Datos Personales",
    body: (
      <>
        <p>El responsable del tratamiento es ZGROUP S.A.C., con domicilio en MZ.D LTE 14 PROGRAMA DE VIVIENDA ACUARIO. Callao, Perú.</p>
        <p>Para ejercer tus derechos previstos en la Ley 29733 (protección de datos personales), escribe a ventas@zgroup.com.pe indicando «Oficial de Datos Personales» o llama al +51 (1) 651-1974.</p>
      </>
    ),
  },
};

export default function Legal() {
  const { slug } = useParams();
  const page = PAGES[slug];
  if (!page) return <Navigate to="/" replace />;

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
        <h1 className="section-title">{page.title}</h1>
        <div className="legal-body">{page.body}</div>
        <Link to="/" className="link-btn">← Volver al catálogo</Link>
      </div>
      <SiteFooter />
    </div>
  );
}
