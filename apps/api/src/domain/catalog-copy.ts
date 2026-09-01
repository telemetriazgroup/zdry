export const CATALOG_COPY_KEY = "catalog_copy";

export type CatalogStep = { title: string; body: string };

export type CatalogCopy = {
  heroKicker: string;
  heroTitle: string;
  heroLeads: string[];
  heroPills: string[];
  searchLabel: string;
  searchPlaceholder: string;
  typeLabel: string;
  typeAll: string;
  conditionLabel: string;
  conditionAll: string;
  depotLabel: string;
  depotAll: string;
  stockSingular: string;
  stockPlural: string;
  stockHint: string;
  sortLabel: string;
  sortIso: string;
  sortPrice: string;
  sortYear: string;
  stepsTitle: string;
  steps: CatalogStep[];
  requestPrice: string;
  requestQuote: string;
  addToQuote: string;
  inQuote: string;
  whatsapp: string;
  whatsappCta: string;
  whatsappMessage: string;
  whatsappCartMessage: string;
  emptyStock: string;
  cartLabel: string;
  loginLabel: string;
  logoutLabel: string;
  company: string;
  address: string;
  phone: string;
  email: string;
  facebook: string;
  instagram: string;
  copyright: string;
  credit: string;
  creditUrl: string;
  cookieText: string;
  cookieAccept: string;
  legalTerms: string;
  legalCookies: string;
  legalPrivacy: string;
  legalData: string;
  legalTermsBody: string;
  legalCookiesBody: string;
  legalPrivacyBody: string;
  legalDataBody: string;
};

export const DEFAULT_CATALOG_COPY: CatalogCopy = {
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
  requestQuote: "Solicitar cotización",
  addToQuote: "Agregar",
  inQuote: "En cotización",
  whatsapp: "",
  whatsappCta: "WhatsApp",
  whatsappMessage: "Hola, me interesa el contenedor {iso} ({type}, {cat}) — {price}. ¿Sigue disponible?",
  whatsappCartMessage: "Hola, quiero cotizar estas unidades: {isos}. ¿Siguen disponibles?",
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
  legalTermsBody:
    "ZDRY es el catálogo de contenedores dry de ZGROUP S.A.C. para venta y alquiler. El stock publicado es propio, inspeccionado en patio, y la cotización no reserva la unidad hasta que un comercial la confirme.\n\nLas solicitudes de cotización (venta o alquiler) se atienden con los datos de empresa y contacto que registres. Los precios, plazos y extras se confirman por escrito en la cotización.",
  legalCookiesBody:
    "Usamos cookies técnicas para mantener tu sesión, la cotización en curso y tu preferencia de este aviso. No usamos redes de publicidad de terceros en este catálogo.\n\nPuedes borrar las cookies desde el navegador. Al hacerlo deberás volver a entrar si tenías sesión abierta.",
  legalPrivacyBody:
    "ZGROUP S.A.C. trata los datos que entregas al crear cuenta o cotizar (empresa, RUC/DNI, nombre, correo y teléfono) para atender la venta o el alquiler de contenedores dry y para contactarte sobre tu solicitud.\n\nNo vendemos tu lista de contactos. Puedes pedir acceso, rectificación o baja escribiendo a ventas@zgroup.com.pe o al Oficial de Datos Personales.",
  legalDataBody:
    "El responsable del tratamiento es ZGROUP S.A.C., con domicilio en MZ.D LTE 14 PROGRAMA DE VIVIENDA ACUARIO. Callao, Perú.\n\nPara ejercer tus derechos previstos en la Ley 29733, escribe a ventas@zgroup.com.pe indicando «Oficial de Datos Personales» o llama al +51 (1) 651-1974.",
};

function asText(v: unknown, fallback: string) {
  const t = typeof v === "string" ? v.trim() : "";
  return t || fallback;
}

function asLines(v: unknown, fallback: string[]) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [];
  const out = arr.map((x) => String(x ?? "").trim()).filter(Boolean);
  return out.length ? out : fallback;
}

export function normalizeCatalogCopy(raw: unknown): CatalogCopy {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_CATALOG_COPY;
  const rawSteps = Array.isArray(src.steps) ? src.steps : [];
  const steps = d.steps.map((def, i) => {
    const row = rawSteps[i] && typeof rawSteps[i] === "object" ? (rawSteps[i] as Record<string, unknown>) : {};
    return { title: asText(row.title, def.title), body: asText(row.body, def.body) };
  });
  return {
    heroKicker: asText(src.heroKicker, d.heroKicker),
    heroTitle: asText(src.heroTitle, d.heroTitle),
    heroLeads: asLines(src.heroLeads, d.heroLeads),
    heroPills: asLines(src.heroPills, d.heroPills),
    searchLabel: asText(src.searchLabel, d.searchLabel),
    searchPlaceholder: asText(src.searchPlaceholder, d.searchPlaceholder),
    typeLabel: asText(src.typeLabel, d.typeLabel),
    typeAll: asText(src.typeAll, d.typeAll),
    conditionLabel: asText(src.conditionLabel, d.conditionLabel),
    conditionAll: asText(src.conditionAll, d.conditionAll),
    depotLabel: asText(src.depotLabel, d.depotLabel),
    depotAll: asText(src.depotAll, d.depotAll),
    stockSingular: asText(src.stockSingular, d.stockSingular),
    stockPlural: asText(src.stockPlural, d.stockPlural),
    stockHint: asText(src.stockHint, d.stockHint),
    sortLabel: asText(src.sortLabel, d.sortLabel),
    sortIso: asText(src.sortIso, d.sortIso),
    sortPrice: asText(src.sortPrice, d.sortPrice),
    sortYear: asText(src.sortYear, d.sortYear),
    stepsTitle: asText(src.stepsTitle, d.stepsTitle),
    steps,
    requestPrice: asText(src.requestPrice, d.requestPrice),
    requestQuote: asText(src.requestQuote, d.requestQuote),
    addToQuote: asText(src.addToQuote, d.addToQuote),
    inQuote: asText(src.inQuote, d.inQuote),
    whatsapp: asText(src.whatsapp, d.whatsapp),
    whatsappCta: asText(src.whatsappCta, d.whatsappCta),
    whatsappMessage: asText(src.whatsappMessage, d.whatsappMessage),
    whatsappCartMessage: asText(src.whatsappCartMessage, d.whatsappCartMessage),
    emptyStock: asText(src.emptyStock, d.emptyStock),
    cartLabel: asText(src.cartLabel, d.cartLabel),
    loginLabel: asText(src.loginLabel, d.loginLabel),
    logoutLabel: asText(src.logoutLabel, d.logoutLabel),
    company: asText(src.company, d.company),
    address: asText(src.address, d.address),
    phone: asText(src.phone, d.phone),
    email: asText(src.email, d.email),
    facebook: asText(src.facebook, d.facebook),
    instagram: asText(src.instagram, d.instagram),
    copyright: asText(src.copyright, d.copyright),
    credit: asText(src.credit, d.credit),
    creditUrl: asText(src.creditUrl, d.creditUrl),
    cookieText: asText(src.cookieText, d.cookieText),
    cookieAccept: asText(src.cookieAccept, d.cookieAccept),
    legalTerms: asText(src.legalTerms, d.legalTerms),
    legalCookies: asText(src.legalCookies, d.legalCookies),
    legalPrivacy: asText(src.legalPrivacy, d.legalPrivacy),
    legalData: asText(src.legalData, d.legalData),
    legalTermsBody: asText(src.legalTermsBody, d.legalTermsBody),
    legalCookiesBody: asText(src.legalCookiesBody, d.legalCookiesBody),
    legalPrivacyBody: asText(src.legalPrivacyBody, d.legalPrivacyBody),
    legalDataBody: asText(src.legalDataBody, d.legalDataBody),
  };
}
