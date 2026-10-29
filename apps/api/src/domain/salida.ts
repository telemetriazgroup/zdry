import { whatsappDigits } from "./catalog-commerce";

export const SALIDA_CONFIG_KEY = "salida_config";
export const SALIDA_CHANNELS = ["ambos", "correo", "whatsapp", "ninguno"] as const;
export type SalidaChannel = (typeof SALIDA_CHANNELS)[number];

export type SalidaConfig = {
  url: string;
  clave: string;
  channel: SalidaChannel;
};

export type SalidaItemState = "en_cola" | "en_espera" | "rechazado" | "omitido" | "error" | "apagado";

export type SalidaResult = {
  channel: SalidaChannel;
  whatsapp: SalidaItemState;
  correo: SalidaItemState;
  motivo: string;
};

const DEFAULT_URL = "https://ztrack.app/servicio/salida";

export function normalizeSalidaConfig(raw: unknown, previous?: SalidaConfig | null): SalidaConfig {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const asked = String(src.channel || previous?.channel || "ninguno");
  const channel: SalidaChannel = (SALIDA_CHANNELS as readonly string[]).includes(asked) ? (asked as SalidaChannel) : "ninguno";
  const url = String(src.url ?? previous?.url ?? "").trim() || DEFAULT_URL;
  if (!/^https:\/\/\S+$/i.test(url)) throw new Error("La URL de salida tiene que empezar por https://");
  const typed = String(src.clave ?? "").trim().slice(0, 200);
  return {
    url: url.slice(0, 300),
    clave: typed || previous?.clave || "",
    channel,
  };
}

export function presentSalidaConfig(cfg: SalidaConfig) {
  return { url: cfg.url, channel: cfg.channel, claveSet: Boolean(cfg.clave) };
}

export const TEST_SUBJECT = "Prueba de salida ZDRY";
export const TEST_MESSAGE = "Mensaje de prueba de ZDRY. Si lo recibes, la conexión de salida está funcionando.";

/** Arma un POST de prueba. No usa el canal guardado para los enlaces. */
export function buildSalidaTest(input: {
  whatsapp: boolean;
  correo: boolean;
  telefono: string;
  contacto: string;
  email: string;
  mensaje: string;
}): { body: Record<string, unknown> | null; plan: SalidaResult } {
  const channel: SalidaChannel = input.whatsapp && input.correo ? "ambos" : input.whatsapp ? "whatsapp" : input.correo ? "correo" : "ninguno";
  if (channel === "ninguno") {
    return { body: null, plan: { channel, whatsapp: "apagado", correo: "apagado", motivo: "Elige WhatsApp, correo o los dos." } };
  }
  const built = buildShareNotice({
    channel,
    phone: input.telefono,
    email: input.email,
    message: (input.mensaje || TEST_MESSAGE).trim() || TEST_MESSAGE,
    contact: input.contacto,
    subject: TEST_SUBJECT,
  });
  if (!built.body || built.plan.whatsapp === "omitido" || built.plan.correo === "omitido") {
    const motivo = (built.plan.motivo || "Revisa los datos de la prueba.")
      .replace("Falta el celular del cliente.", "Indica el celular de destino.")
      .replace("El comercial no tiene WhatsApp para el contacto de respuesta.", "Indica el WhatsApp de respuesta.")
      .replace("Falta el correo del cliente.", "Indica un correo válido.");
    return { body: null, plan: { ...built.plan, motivo } };
  }
  return built;
}

export type ShareNoticeInput = {
  known: boolean;
  name: string;
  company: string;
  ruc: string;
  dni: string;
  address: string;
  email: string;
  phone: string;
  vendorName: string;
  vendorPhone: string;
  url: string;
  code: string;
  hours: number;
  /** Si viene, el aviso es una reapertura: el enlace venció y queda abierto esos minutos. */
  minutes?: number;
};

export function salidaQueued(state: string) {
  return state === "en_cola" || state === "en_espera";
}

/** El segundo WhatsApp espera a que el primero deje de estar en la cola del bot. */
export const SALIDA_GAP_MS = 5000;

export function shareAvisoText(client: SalidaResult, vendor: SalidaResult): { ok: boolean; text: string } {
  const channel = client.channel;
  if (channel === "ninguno") {
    return { ok: false, text: "No se enviaron WhatsApp ni correos: el canal de salida está apagado." };
  }
  const wantWa = channel === "whatsapp" || channel === "ambos";
  const wantMail = channel === "correo" || channel === "ambos";
  const failed: string[] = [];
  const check = (label: string, state: SalidaItemState, wanted: boolean) => {
    if (!wanted || state === "apagado") return;
    if (state !== "en_cola") failed.push(label);
  };
  check("WhatsApp del cliente", client.whatsapp, wantWa);
  check("correo del cliente", client.correo, wantMail);
  check("WhatsApp del comercial", vendor.whatsapp, wantWa);
  check("correo del comercial", vendor.correo, wantMail);
  if (failed.length) return { ok: false, text: `No salió: ${failed.join(", ")}.` };
  if (wantWa && wantMail) return { ok: true, text: "Se enviaron los WhatsApp y los correos al cliente y al comercial." };
  if (wantWa) return { ok: true, text: "Se enviaron los WhatsApp al cliente y al comercial." };
  return { ok: true, text: "Se enviaron los correos al cliente y al comercial." };
}

/** Aviso al comercial cuando se abre un seguimiento. No incluye la clave del catálogo. */
export function vendorFollowNotice(input: {
  vendorName: string;
  clientName: string;
  company: string;
  ruc: string;
  dni: string;
  phone: string;
  email: string;
  byClient: boolean;
}) {
  const vendor = input.vendorName.trim() || "comercial";
  const company = input.company.trim();
  const client = input.clientName.trim();
  const who = company && client && company.toLowerCase() !== client.toLowerCase()
    ? `${company}, contacto ${client}`
    : company || client || "Un cliente";
  const doc = input.ruc.trim() ? `RUC ${input.ruc.trim()}` : input.dni.trim() ? `DNI ${input.dni.trim()}` : "";
  const phone = showPhone(input.phone);
  const email = input.email.trim();
  const headline = input.byClient ? "Un cliente abrió un seguimiento." : "Se abrió un seguimiento de catálogo.";
  const lead = input.byClient
    ? "Un cliente se registró y quedó a tu cargo."
    : "Quedó un seguimiento de catálogo a tu cargo.";
  const lines = ["*ZGROUP*", headline, "", `Hola ${vendor}.`, lead, "", "*Cliente*", who];
  if (doc) lines.push(doc);
  if (phone) lines.push(`Celular: ${phone}`);
  if (email) lines.push(`Correo: ${email}`);
  lines.push("", "Atiéndelo. El sistema ya le dijo que lo vas a contactar.");
  const rows: Array<[string, string]> = [
    ["Cliente", who],
    ["Documento", doc],
    ["Celular", phone],
    ["Correo", email],
  ];
  return {
    subject: input.byClient ? "Un cliente abrió un seguimiento" : "Se abrió un seguimiento de catálogo",
    message: lines.join("\n").slice(0, 4000),
    html: executiveLetter({
      kicker: "SEGUIMIENTO",
      title: `Hola, ${vendor}`,
      lead,
      rows,
      note: "Atiéndelo. El sistema ya le dijo que lo vas a contactar.",
    }),
  };
}

/** Aviso al comercial cuando el cliente pide información de un equipo. No incluye la clave. */
export function unitInterestNotice(input: {
  vendorName: string;
  clientName: string;
  company: string;
  iso: string;
  type: string;
  phone: string;
  email: string;
}) {
  const vendor = input.vendorName.trim() || "comercial";
  const company = input.company.trim();
  const client = input.clientName.trim();
  const who = company && client && company.toLowerCase() !== client.toLowerCase()
    ? `${client} de ${company}`
    : client || company || "Un cliente";
  const unit = [input.iso.trim(), input.type.trim()].filter(Boolean).join(" ");
  const phone = showPhone(input.phone);
  const email = input.email.trim();
  const message = [
    `Hola ${vendor}.`,
    `${who} pidió información del equipo ${unit}.`,
    "Su cotización fue solicitada.",
    phone ? `Celular: ${phone}.` : "",
    email ? `Correo: ${email}.` : "",
    "Atiéndelo. El sistema ya le dijo que lo vas a contactar.",
  ].filter(Boolean).join(" ");
  return { subject: `Te pidieron información de ${input.iso.trim() || "un equipo"}`, message };
}

/** Aviso al comercial cuando el cliente vuelve y el enlace ya había vencido. No incluye la clave. */
export function vendorReturnNotice(input: { vendorName: string; clientName: string; company: string; ruc: string; dni: string }) {
  const vendor = input.vendorName.trim() || "comercial";
  const company = input.company.trim();
  const client = input.clientName.trim();
  const who = company && client && company.toLowerCase() !== client.toLowerCase()
    ? `${company}, contacto ${client}`
    : company || client || "Un cliente";
  const doc = input.ruc.trim() ? `RUC ${input.ruc.trim()}` : input.dni.trim() ? `DNI ${input.dni.trim()}` : "";
  const message = [
    `Hola ${vendor}.`,
    `${who}${doc ? ` (${doc})` : ""} volvió a pedir el catálogo.`,
    "El enlace había vencido y se le abrieron 30 minutos más.",
    "El cliente está buscando información.",
  ].join(" ");
  return { subject: "Un cliente volvió a pedir el catálogo", message };
}

export function showPhone(value: string) {
  const digits = whatsappDigits(value);
  if (digits.startsWith("51") && digits.length === 11) return `+51 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return digits ? `+${digits}` : "";
}

function hoursLabel(hours: number) {
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

function spanLabel(hours: number, minutes?: number) {
  const extra = Number(minutes);
  if (Number.isFinite(extra) && extra > 0) return extra === 1 ? "1 minuto" : `${Math.round(extra)} minutos`;
  return hoursLabel(hours);
}

function executiveLetter(input: {
  kicker: string;
  title: string;
  lead: string;
  rows: Array<[string, string]>;
  note: string;
}) {
  const font = "Arial,Helvetica,sans-serif";
  const rows = input.rows.filter((pair) => pair[1]).map(([label, value]) => (
    `<tr><td style="padding:11px 0;border-bottom:1px solid #e2e4ea;color:#5c6370;font-size:13px;width:120px;font-family:${font};">${esc(label)}</td><td style="padding:11px 0;border-bottom:1px solid #e2e4ea;color:#1a1d29;font-size:14px;font-weight:700;font-family:${font};">${esc(value)}</td></tr>`
  )).join("");
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e4ea;border-radius:12px;overflow:hidden;font-family:${font};">
<tr><td style="background:#d9622f;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#12203a;padding:28px 36px 24px;">
<div style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.22em;font-family:${font};">ZGROUP</div>
<div style="color:#d7deea;font-size:13px;margin-top:8px;font-family:${font};">Venta y alquiler de contenedores</div>
</td></tr>
<tr><td style="padding:32px 36px 8px;">
<div style="color:#d9622f;font-size:13px;font-weight:700;letter-spacing:0.14em;font-family:${font};">${esc(input.kicker)}</div>
<h1 style="margin:12px 0 0;font-size:26px;line-height:1.25;color:#12203a;font-weight:700;font-family:${font};">${esc(input.title)}</h1>
<p style="margin:14px 0 0;color:#1a1d29;font-size:15px;line-height:1.55;font-family:${font};">${esc(input.lead)}</p>
</td></tr>
<tr><td style="padding:22px 36px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e4ea;">${rows}</table>
</td></tr>
<tr><td style="padding:8px 36px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e4ea;border-radius:12px;">
<tr><td style="padding:16px 18px;border-left:4px solid #d9622f;color:#12203a;font-size:14px;line-height:1.5;font-family:${font};">${esc(input.note)}</td></tr>
</table>
</td></tr>
<tr><td style="background:#12203a;padding:16px 36px;color:#d7deea;font-size:12px;line-height:1.5;font-family:${font};">ZGROUP · Aviso interno de seguimiento.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Carta del enlace: saludo si ya es cliente, bienvenida si es nuevo, datos y comercial. */
export function shareNoticePack(input: ShareNoticeInput) {
  const name = input.name.trim() || "cliente";
  const company = input.company.trim();
  const vendor = input.vendorName.trim();
  const vendorPhone = showPhone(input.vendorPhone);
  const greeting = input.known ? "Zgroup te saluda nuevamente." : "Zgroup te da la bienvenida.";
  const span = spanLabel(input.hours, input.minutes);
  const attend = vendor
    ? `${vendor} queda a cargo de tu atención.`
    : "Un comercial de ZGROUP queda a cargo de tu atención.";
  const intro = input.minutes
    ? `Tu enlace había vencido. Queda abierto ${span} más. ${attend}`
    : "";
  const data: Array<[string, string]> = [
    ["Empresa", company && company.toLowerCase() !== name.toLowerCase() ? company : ""],
    ["Contacto", name],
    ["RUC", input.ruc.trim()],
    ["DNI", input.dni.trim()],
    ["Dirección", input.address.trim()],
    ["Correo", input.email.trim()],
    ["Celular", showPhone(input.phone)],
  ].filter((pair): pair is [string, string] => Boolean(pair[1]));
  const dataLines = data.map(([label, value]) => `${label}: ${value}`);
  const whatsapp = [
    "*ZGROUP*",
    greeting,
    "",
    input.minutes ? `Hola ${name}. ${intro}` : `Hola ${name}, tu catálogo de equipos ya está listo. ${attend}`,
    "",
    "*Tu catálogo*",
    input.url,
    `Clave de acceso: *${input.code}*`,
    `Vigencia: ${span}`,
    "",
    "*Tu comercial*",
    vendor || "Comercial ZGROUP",
    vendorPhone ? `WhatsApp: ${vendorPhone}` : "Si quieres llamarlo, pide el número en portería.",
    "Si quieres ver los equipos o resolver una duda, escríbele directo a ese número.",
  ].join("\n").slice(0, 4000);
  const email = [
    "ZGROUP",
    "Venta y alquiler de contenedores",
    "",
    greeting,
    "",
    `Hola ${name},`,
    "",
    input.minutes ? intro : `Tu catálogo de equipos ya está preparado. ${attend}`,
    "",
    "TUS DATOS",
    ...dataLines,
    "",
    "TU CATÁLOGO",
    `Enlace: ${input.url}`,
    `Clave de acceso: ${input.code}`,
    `Vigencia: ${span}`,
    "",
    "TU COMERCIAL",
    vendor || "Comercial ZGROUP",
    ...(vendorPhone ? [`WhatsApp: ${vendorPhone}`] : []),
    "Puedes escribirle directamente si quieres ver los equipos o resolver una duda.",
    "",
    "ZGROUP",
    "Este acceso es personal. No reenvíes la clave.",
  ].join("\n").slice(0, 8000);
  const subject = (input.minutes
    ? "ZGROUP te saluda. Tu catálogo sigue abierto"
    : input.known ? "ZGROUP te saluda. Tu catálogo está listo" : "Bienvenido a ZGROUP. Tu catálogo está listo").slice(0, 180);
  return { subject, whatsapp, email, html: shareNoticeHtml({ ...input, name, greeting, attend, span, vendor, vendorPhone, data, lead: input.minutes ? intro : `Tu catálogo de equipos ya está preparado. ${attend}` }) };
}

function shareNoticeHtml(input: {
  name: string;
  greeting: string;
  attend: string;
  span: string;
  vendor: string;
  vendorPhone: string;
  url: string;
  code: string;
  lead: string;
  data: Array<[string, string]>;
}) {
  const font = "Arial,Helvetica,sans-serif";
  const rows = input.data.map(([label, value]) => (
    `<tr><td style="padding:11px 0;border-bottom:1px solid #e2e4ea;color:#5c6370;font-size:13px;width:120px;font-family:${font};">${esc(label)}</td><td style="padding:11px 0;border-bottom:1px solid #e2e4ea;color:#1a1d29;font-size:14px;font-weight:700;font-family:${font};">${esc(value)}</td></tr>`
  )).join("");
  const vendorDigits = input.vendorPhone.replace(/\D/g, "");
  const vendorLine = vendorDigits.length >= 8
    ? `<a href="https://wa.me/${vendorDigits}" style="color:#d9622f;font-weight:700;text-decoration:none;">WhatsApp ${esc(input.vendorPhone)}</a>`
    : `<span style="color:#5c6370;">Pide su número en portería si quieres llamarlo.</span>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e4ea;border-radius:12px;overflow:hidden;font-family:${font};">
<tr><td style="background:#d9622f;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#12203a;padding:28px 36px 24px;">
<div style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.22em;font-family:${font};">ZGROUP</div>
<div style="color:#d7deea;font-size:13px;margin-top:8px;font-family:${font};">Venta y alquiler de contenedores</div>
</td></tr>
<tr><td style="padding:32px 36px 4px;">
<div style="color:#d9622f;font-size:13px;font-weight:700;font-family:${font};">${esc(input.greeting)}</div>
<h1 style="margin:12px 0 0;font-size:26px;line-height:1.25;color:#12203a;font-weight:700;font-family:${font};">Hola, ${esc(input.name)}</h1>
<p style="margin:14px 0 0;color:#1a1d29;font-size:15px;line-height:1.55;font-family:${font};">${esc(input.lead)}</p>
</td></tr>
<tr><td style="padding:26px 36px 0;">
<div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#8a90a2;font-family:${font};">TUS DATOS</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid #e2e4ea;">${rows}</table>
</td></tr>
<tr><td style="padding:24px 36px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#12203a;border-radius:12px;">
<tr><td style="padding:24px 26px;">
<div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#d7deea;font-family:${font};">TU CATÁLOGO</div>
<p style="margin:16px 0 0;color:#8a90a2;font-size:12px;font-family:${font};">Clave de acceso</p>
<div style="margin-top:4px;font-size:32px;line-height:1.1;font-weight:700;letter-spacing:0.18em;color:#ffffff;font-family:${font};">${esc(input.code)}</div>
<p style="margin:10px 0 0;color:#d7deea;font-size:14px;font-family:${font};">Vigencia: ${esc(input.span)}</p>
<a href="${esc(input.url)}" style="display:inline-block;margin-top:18px;background:#d9622f;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;font-family:${font};">Ver catálogo</a>
<p style="margin:14px 0 0;font-size:12px;line-height:1.4;font-family:${font};"><a href="${esc(input.url)}" style="color:#d7deea;text-decoration:underline;">${esc(input.url)}</a></p>
</td></tr></table>
</td></tr>
<tr><td style="padding:18px 36px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e4ea;border-radius:12px;">
<tr><td style="padding:18px 20px 18px 18px;border-left:4px solid #d9622f;">
<div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#8a90a2;font-family:${font};">TU COMERCIAL</div>
<div style="margin-top:8px;font-size:18px;font-weight:700;color:#12203a;font-family:${font};">${esc(input.vendor || "Comercial ZGROUP")}</div>
<div style="margin-top:6px;font-size:14px;font-family:${font};">${vendorLine}</div>
<p style="margin:8px 0 0;color:#5c6370;font-size:13px;line-height:1.5;font-family:${font};">Si quieres ver los equipos o resolver una duda, escríbele directo.</p>
</td></tr></table>
</td></tr>
<tr><td style="background:#12203a;padding:16px 36px;color:#d7deea;font-size:12px;line-height:1.5;font-family:${font};">ZGROUP · Este acceso es personal. No reenvíes la clave.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Arma el POST de SGIT. Si el canal está apagado, no hay cuerpo. */
export function buildShareNotice(input: {
  channel: SalidaChannel;
  phone: string;
  email: string;
  message: string;
  emailBody?: string;
  html?: string;
  contact: string;
  subject: string;
}): { body: Record<string, unknown> | null; plan: SalidaResult } {
  const sendWa = input.channel === "ambos" || input.channel === "whatsapp";
  const sendMail = input.channel === "ambos" || input.channel === "correo";
  if (!sendWa && !sendMail) {
    return { body: null, plan: { channel: input.channel, whatsapp: "apagado", correo: "apagado", motivo: "" } };
  }
  const body: Record<string, unknown> = {};
  let whatsapp: SalidaItemState = sendWa ? "omitido" : "apagado";
  let correo: SalidaItemState = sendMail ? "omitido" : "apagado";
  const motivos: string[] = [];
  if (sendWa) {
    const telefono = whatsappDigits(input.phone);
    const contacto = whatsappDigits(input.contact);
    const ok = (n: string) => n.length >= 8 && n.length <= 15;
    if (!ok(telefono)) motivos.push("Falta el celular del cliente.");
    else if (!ok(contacto)) motivos.push("El comercial no tiene WhatsApp para el contacto de respuesta.");
    else if (!input.message.trim()) motivos.push("Falta el mensaje.");
    else {
      body.whatsapp = { telefono, mensaje: input.message.slice(0, 4000), contacto };
      whatsapp = "en_cola";
    }
  }
  if (sendMail) {
    const direccion = input.email.trim().toLowerCase().slice(0, 180);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direccion)) motivos.push("Falta el correo del cliente.");
    else if (!input.subject.trim()) motivos.push("Falta el asunto.");
    else if (!(input.emailBody || input.message).trim()) motivos.push("Falta el mensaje.");
    else {
      const correoBody: Record<string, string> = {
        direccion,
        asunto: input.subject.trim().slice(0, 180),
        cuerpo: (input.emailBody || input.message).slice(0, 8000),
      };
      const html = String(input.html || "").trim();
      if (html) correoBody.html = html.slice(0, 20000);
      body.correo = correoBody;
      correo = "en_cola";
    }
  }
  return {
    body: body.whatsapp || body.correo ? body : null,
    plan: { channel: input.channel, whatsapp, correo, motivo: motivos.join(" ") },
  };
}

export function readSalidaStates(payload: unknown, plan: SalidaResult): SalidaResult {
  const src = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const first = (key: string) => {
    const list = src[key];
    return Array.isArray(list) ? (list[0] as Record<string, unknown> | undefined) : undefined;
  };
  const take = (item: Record<string, unknown> | undefined, current: SalidaItemState): { state: SalidaItemState; motivo: string } => {
    if (current !== "en_cola") return { state: current, motivo: "" };
    const estado = String(item?.estado || "");
    if (estado === "en_cola" || estado === "en_espera" || estado === "rechazado") {
      return { state: estado, motivo: String(item?.motivo || "") };
    }
    return { state: "error", motivo: "La salida no confirmó el envío." };
  };
  const wa = take(first("whatsapp"), plan.whatsapp);
  const mail = take(first("correos"), plan.correo);
  const motivo = [plan.motivo, wa.motivo, mail.motivo].filter(Boolean).join(" ");
  return { channel: plan.channel, whatsapp: wa.state, correo: mail.state, motivo };
}
