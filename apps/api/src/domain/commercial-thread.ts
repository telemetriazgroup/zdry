import { grossOf, igvOf } from "./pricing";

export const VENDOR_PING_MS = 5 * 60 * 1000;
export const EXECUTIVE_PING_MS = 15 * 60 * 1000;

export type ClientChoice = "1" | "2" | "3" | "ok" | "libre";

export function usd(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const [whole, cents] = rounded.toFixed(2).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

export function commercialReplyUrl(): string {
  const explicit = String(process.env.COMMERCIAL_REPLY_URL || "").trim();
  if (explicit) return explicit;
  const origin = String(process.env.WEB_ORIGIN || "http://localhost:28080").replace(/\/$/, "");
  const root = String(process.env.COOKIE_PATH || "/zdry").replace(/\/$/, "");
  return `${origin}${root}/api/commercial/respuesta`;
}

export function staffThreadsUrl(): string {
  const origin = String(process.env.WEB_ORIGIN || "http://localhost:28080").replace(/\/$/, "");
  const root = String(process.env.COOKIE_PATH || "/zdry").replace(/\/$/, "");
  return `${origin}${root}/app/hilos`;
}

export function threadReference(threadId: string, now = Date.now()): string {
  return `hilo:${threadId}:${now.toString(36)}`.slice(0, 80);
}

export function parseThreadId(referencia: string): string {
  const match = String(referencia || "").match(/^hilo:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : "";
}

export function parseClientChoice(text: string): ClientChoice {
  const clean = String(text || "").trim();
  if (clean === "1" || clean === "2" || clean === "3") return clean;
  if (/^ok$/i.test(clean)) return "ok";
  return "libre";
}

export function offerPrice(input: { useList: boolean; amount: number | null; priceMin: number; priceList: number }): { ok: true; net: number } | { ok: false; message: string } {
  const min = roundMoney(input.priceMin);
  const list = roundMoney(input.priceList);
  if (list <= 0 || min <= 0 || min > list) return { ok: false, message: "Ese equipo no tiene un rango de precio para ofrecer." };
  if (input.useList) return { ok: true, net: list };
  const amount = input.amount == null ? NaN : roundMoney(input.amount);
  if (!Number.isFinite(amount)) return { ok: false, message: "Escribe el precio neto." };
  if (amount < min || amount > list) return { ok: false, message: `El precio tiene que estar entre ${usd(min)} y ${usd(list)}.` };
  return { ok: true, net: amount };
}

export function priceLines(net: number): { net: number; igv: number; gross: number; text: string } {
  const value = roundMoney(net);
  const igv = igvOf(value);
  const gross = grossOf(value);
  return {
    net: value,
    igv,
    gross,
    text: [`Precio neto: ${usd(value)}`, `IGV 18%: ${usd(igv)}`, `Total con IGV: ${usd(gross)}`].join("\n"),
  };
}

export function contactClock(input: {
  contactAskedAt: Date;
  vendorOkAt: Date | null;
  lastVendorPingAt: Date | null;
  executivePingAt: Date | null;
  now: Date;
}): { pingVendor: boolean; pingExecutive: boolean } {
  if (input.vendorOkAt) return { pingVendor: false, pingExecutive: false };
  const asked = input.contactAskedAt.getTime();
  const now = input.now.getTime();
  const pingExecutive = !input.executivePingAt && now - asked >= EXECUTIVE_PING_MS;
  const last = (input.lastVendorPingAt || input.contactAskedAt).getTime();
  const pingVendor = now - last >= VENDOR_PING_MS;
  return { pingVendor, pingExecutive };
}

export function clientOfferText(input: { clientName: string; iso: string; unitType: string; net: number }): string {
  const name = input.clientName.trim() || "cliente";
  const unit = [input.iso.trim(), input.unitType.trim()].filter(Boolean).join(" ");
  const price = priceLines(input.net);
  return [
    "ZGROUP te saluda.",
    "",
    `Hola ${name}. Sobre el equipo ${unit} que estás mirando:`,
    price.text,
    "",
    "Responde:",
    "1. Solicitar cotización",
    "2. Que me contacte el comercial",
    "3. Entendido, gracias",
  ].join("\n").slice(0, 4000);
}

export const REVIEWING_TEXT = "El comercial está revisando tu solicitud y te entrega la cotización en un momento.";
export const THANKS_TEXT = "Entendido, gracias. Quedamos atentos si más adelante quieres este equipo.";
export const CONTACT_WAIT_TEXT = "Tu comercial va a comunicarse contigo. Si ya lo pidió, espera su llamada.";

export function quoteAskedText(input: { clientName: string; iso: string; unitType: string; net: number }): string {
  const unit = [input.iso.trim(), input.unitType.trim()].filter(Boolean).join(" ");
  const price = priceLines(input.net);
  return [
    `${input.clientName.trim() || "El cliente"} pidió la cotización del equipo ${unit}.`,
    price.text,
    "La orden en Odoo se emite en el paso siguiente. Atiende este pedido.",
  ].join("\n").slice(0, 4000);
}

export function contactAskedText(input: { clientName: string; iso: string; unitType: string; phone: string; email: string; net: number }): string {
  const unit = [input.iso.trim(), input.unitType.trim()].filter(Boolean).join(" ");
  const price = priceLines(input.net);
  return [
    `${input.clientName.trim() || "El cliente"} quiere que lo contactes ahora.`,
    `Equipo: ${unit}.`,
    input.phone.trim() ? `Celular: ${input.phone.trim()}.` : "",
    input.email.trim() ? `Correo: ${input.email.trim()}.` : "",
    price.text,
    "Responde OK cuando te comuniques.",
  ].filter(Boolean).join("\n").slice(0, 4000);
}

export function vendorReminderText(input: { clientName: string; iso: string }): string {
  return `Seguimos a la espera de tu OK. ${input.clientName.trim() || "El cliente"} pidió que lo contactes por el equipo ${input.iso.trim()}. Responde OK cuando te comuniques.`.slice(0, 4000);
}

export function executiveEscalationText(input: { vendorName: string; clientName: string; phone: string; email: string; iso: string; unitType: string }): string {
  const unit = [input.iso.trim(), input.unitType.trim()].filter(Boolean).join(" ");
  return [
    `${input.vendorName.trim() || "El comercial"} no confirmó la comunicación con el cliente.`,
    `Cliente: ${input.clientName.trim() || "sin nombre"}.`,
    input.phone.trim() ? `Celular: ${input.phone.trim()}.` : "",
    input.email.trim() ? `Correo: ${input.email.trim()}.` : "",
    `Equipo: ${unit}.`,
    "Puedes comunicarte tú si deseas.",
  ].filter(Boolean).join("\n").slice(0, 4000);
}

export function interestNoticeText(input: { who: string; clientName: string; iso: string; unitType: string; priceList: number; priceMin: number }): string {
  const unit = [input.iso.trim(), input.unitType.trim()].filter(Boolean).join(" ");
  const margin = Math.round(input.priceList - input.priceMin);
  return [
    `Hola ${input.who.trim() || "comercial"}.`,
    `${input.clientName.trim() || "Un cliente"} pidió precio o información del equipo ${unit}.`,
    `Precio de lista: ${usd(input.priceList)}.`,
    `Mínimo: ${usd(input.priceMin)}.`,
    `Margen: ${usd(margin)}.`,
    "Entra al hilo y ofrece el precio de lista o uno dentro de ese rango.",
    staffThreadsUrl(),
  ].join("\n").slice(0, 4000);
}

export function registrationVendorText(input: { vendorName: string; clientName: string; company: string; doc: string; phone: string; email: string }): string {
  return [
    `Hola ${input.vendorName.trim() || "comercial"}.`,
    "Tienes un cliente por atender.",
    clientBlock(input),
    "Atiéndelo. El sistema ya le envió el enlace del catálogo.",
    staffThreadsUrl(),
  ].join("\n").slice(0, 4000);
}

export function registrationExecutiveText(input: { executiveName: string; vendorName: string; clientName: string; company: string; doc: string; phone: string; email: string }): string {
  return [
    `Hola ${input.executiveName.trim() || "ejecutivo"}.`,
    `${input.vendorName.trim() || "Un comercial"} de tu equipo quedó asignado a un cliente.`,
    clientBlock(input),
    "Revisa que lo atienda a tiempo.",
    staffThreadsUrl(),
  ].join("\n").slice(0, 4000);
}

function clientBlock(input: { clientName: string; company: string; doc: string; phone: string; email: string }): string {
  const who = input.company.trim() && input.clientName.trim() && input.company.trim().toLowerCase() !== input.clientName.trim().toLowerCase()
    ? `${input.company.trim()}, contacto ${input.clientName.trim()}`
    : input.company.trim() || input.clientName.trim() || "Cliente";
  return [who, input.doc.trim(), input.phone.trim() ? `Celular: ${input.phone.trim()}` : "", input.email.trim() ? `Correo: ${input.email.trim()}` : ""].filter(Boolean).join("\n");
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
