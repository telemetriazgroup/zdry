export const DEFAULT_CATALOG_COPY = {
  heroKicker: "Venta y alquiler · Contenedores dry · Callao",
  heroTitle: "Contenedores dry listos para vender o alquilar",
  heroLeads: [
    "Stock propio en patio. 20' y 40' inspeccionados, con fotos reales de cada unidad.",
    "Elige el dry que mejor te conviene: tamaño, condición y el ISO que ves en catálogo.",
    "Paga la cotización y coordinamos el despacho del equipo hasta tu planta.",
    "Venta o alquiler, sin compromiso: arma tu pedido en minutos.",
  ],
  heroPills: ["Venta inmediata", "Alquiler operativo", "Fotos de inspección", "Retiro en Callao"],
  searchLabel: "Buscar",
  searchPlaceholder: "ISO, fabricante…",
  typeLabel: "Tipo",
  typeAll: "Todos",
  conditionLabel: "Condición",
  conditionAll: "Todas",
  depotLabel: "Depósito",
  depotAll: "Todos",
  stockSingular: "unidad disponible",
  stockPlural: "unidades disponibles",
  stockHint: "Para venta o alquiler · stock propio",
  sortLabel: "Ordenar",
  sortIso: "ISO",
  sortPrice: "Precio",
  sortYear: "Año",
  stepsTitle: "Adquiere tu dry en 3 pasos",
  steps: [
    { title: "Elige", body: "Selecciona el contenedor dry que mejor te conviene: medida, condición y fotos reales de patio." },
    { title: "Paga", body: "Recibe la cotización y realiza el pago. Queda registrada tu compra o alquiler." },
    { title: "Recibe tu dry", body: "Coordinamos el despacho del equipo hasta tu planta." },
  ],
  requestPrice: "Solicitar precio",
  addToQuote: "Agregar",
  inQuote: "En cotización",
  emptyStock: "No hay unidades publicadas con esos filtros. Prueba otro tipo, condición o depósito.",
  cartLabel: "Cotización",
  loginLabel: "Entrar",
  logoutLabel: "Salir",
  company: "ZGROUP S.A.C.",
  address: "MZ.D LTE 14 PROGRAMA DE VIVIENDA ACUARIO. Callao, Perú",
  phone: "+51 (1) 651-1974",
  email: "ventas@zgroup.com.pe",
  facebook: "https://www.facebook.com/ZgroupSac",
  instagram: "https://www.instagram.com/zgroup_modular_solution/",
  copyright: "© TODOS LOS DERECHOS RESERVADOS",
  credit: "Desarrollado por equipo ZTRACK",
  creditUrl: "https://ztrack.app/",
  cookieText: "Usamos cookies para mejorar tu experiencia. Revisa nuestras política de privacidad y de cookies.",
  cookieAccept: "Aceptar",
  legalTerms: "Términos y condiciones",
  legalCookies: "Política de cookies",
  legalPrivacy: "Política de privacidad",
  legalData: "Oficial de Datos Personales",
  legalTermsBody: "ZDRY es el catálogo de contenedores dry de ZGROUP S.A.C. para venta y alquiler. El stock publicado es propio, inspeccionado en patio, y la cotización no reserva la unidad hasta que un comercial la confirme.\n\nLas solicitudes de cotización (venta o alquiler) se atienden con los datos de empresa y contacto que registres. Los precios, plazos y extras se confirman por escrito en la cotización.",
  legalCookiesBody: "Usamos cookies técnicas para mantener tu sesión, la cotización en curso y tu preferencia de este aviso. No usamos redes de publicidad de terceros en este catálogo.\n\nPuedes borrar las cookies desde el navegador. Al hacerlo deberás volver a entrar si tenías sesión abierta.",
  legalPrivacyBody: "ZGROUP S.A.C. trata los datos que entregas al crear cuenta o cotizar (empresa, RUC/DNI, nombre, correo y teléfono) para atender la venta o el alquiler de contenedores dry y para contactarte sobre tu solicitud.\n\nNo vendemos tu lista de contactos. Puedes pedir acceso, rectificación o baja escribiendo a ventas@zgroup.com.pe o al Oficial de Datos Personales.",
  legalDataBody: "El responsable del tratamiento es ZGROUP S.A.C., con domicilio en MZ.D LTE 14 PROGRAMA DE VIVIENDA ACUARIO. Callao, Perú.\n\nPara ejercer tus derechos previstos en la Ley 29733, escribe a ventas@zgroup.com.pe indicando «Oficial de Datos Personales» o llama al +51 (1) 651-1974.",
};

function text(v, fallback) {
  const t = typeof v === "string" ? v.trim() : "";
  return t || fallback;
}

function lines(v, fallback) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [];
  const out = arr.map((x) => String(x ?? "").trim()).filter(Boolean);
  return out.length ? out : fallback;
}

export function mergeCatalogCopy(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_CATALOG_COPY;
  const rawSteps = Array.isArray(src.steps) ? src.steps : [];
  return {
    ...d,
    ...Object.fromEntries(Object.keys(d).filter((k) => k !== "steps" && k !== "heroLeads" && k !== "heroPills").map((k) => [k, text(src[k], d[k])])),
    heroLeads: lines(src.heroLeads, d.heroLeads),
    heroPills: lines(src.heroPills, d.heroPills),
    steps: d.steps.map((def, i) => ({
      title: text(rawSteps[i]?.title, def.title),
      body: text(rawSteps[i]?.body, def.body),
    })),
  };
}

export function legalParagraphs(body) {
  return String(body || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
