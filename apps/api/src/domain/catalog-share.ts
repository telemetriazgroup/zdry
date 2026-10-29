import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { whatsappDigits } from "./catalog-commerce";
import { isValidPeruRuc, normalizeRuc } from "./ruc-sunat";

export function normalizeDni(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

/** Prefijo aparte (51 por defecto) y el resto del celular. Si el número ya trae el prefijo, no se duplica. */
export function joinPhone(prefix: unknown, local: unknown): string {
  const country = whatsappDigits(prefix).slice(0, 4) || "51";
  const number = whatsappDigits(local);
  if (!number) return "";
  if (number.startsWith(country) && number.length > country.length + 5) return number.slice(0, 20);
  return `${country}${number}`.slice(0, 20);
}

export function splitPhone(raw: unknown, fallbackPrefix = "51"): { prefix: string; local: string } {
  const digits = whatsappDigits(raw);
  const prefix = whatsappDigits(fallbackPrefix).slice(0, 4) || "51";
  if (digits.startsWith(prefix) && digits.length > prefix.length + 5) {
    return { prefix, local: digits.slice(prefix.length) };
  }
  return { prefix, local: digits };
}

export const SHARE_HOURS_MIN = 24;
export const SHARE_HOURS_MAX = 240;
export const WALKIN_RUC_HOURS = 3;
export const WALKIN_DNI_HOURS = 1;
export const WALKIN_EXTEND_MINUTES = 30;

/** Portería reabre un enlace vencido por media hora, contando desde ahora. */
export function walkInExtendUntil(now = new Date()): Date {
  return new Date(now.getTime() + WALKIN_EXTEND_MINUTES * 60 * 1000);
}
export const SHARE_HOUR_OPTIONS = Array.from({ length: 10 }, (_, i) => (i + 1) * 24);

export const SHARE_EVENT_KINDS = ["open", "view_unit", "view_image", "filter", "whatsapp", "cart", "search"] as const;
export type ShareEventKind = (typeof SHARE_EVENT_KINDS)[number];

export function clampShareHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 72;
  return Math.min(SHARE_HOURS_MAX, Math.max(SHARE_HOURS_MIN, Math.round(n)));
}

export function newShareToken(): string {
  return randomBytes(12).toString("hex");
}

export function newShareAccessCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function shareCodeMatches(stored: string, raw: unknown): boolean {
  const given = String(raw ?? "").replace(/\D/g, "").slice(0, 6);
  const a = Buffer.from(String(stored || "").padEnd(6, " "));
  const b = Buffer.from(given.padEnd(6, " "));
  return a.length === b.length && timingSafeEqual(a, b) && stored === given;
}

function shareGrantSecret(): string {
  return process.env.JWT_SECRET || "cambiar-en-produccion";
}

export function newShareSession(): string {
  return randomBytes(9).toString("hex");
}

export function signShareGrant(token: string, sessionId: string): string {
  const payload = `${token}.${sessionId}`;
  const mac = createHmac("sha256", shareGrantSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readShareGrant(raw: unknown): { token: string; sessionId: string } | null {
  const parts = String(raw || "").split(".");
  if (parts.length !== 3) return null;
  const [token, sessionId, mac] = parts;
  if (!token || !sessionId || !mac) return null;
  const expected = createHmac("sha256", shareGrantSecret()).update(`${token}.${sessionId}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { token, sessionId };
}

export function grantMatchesSession(raw: unknown, activeSession: string): "ok" | "moved" | "deny" {
  const grant = readShareGrant(raw);
  if (!grant || !activeSession) return "deny";
  return grant.sessionId === activeSession ? "ok" : "moved";
}

function sharePhone(src: Record<string, unknown>): string {
  const local = String(src.phoneLocal ?? "").trim();
  if (local) return joinPhone(src.phonePrefix || "51", local);
  return whatsappDigits(src.clientPhone || src.contactPhone).slice(0, 20);
}

function optionalOdooId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function normalizeShareDraft(raw: unknown): {
  docKind: "ruc" | "dni";
  ruc: string;
  dni: string;
  rucPending: boolean;
  clientName: string;
  clientCompany: string;
  clientPhone: string;
  clientEmail: string;
  contactName: string;
  street: string;
  district: string;
  province: string;
  department: string;
  sunatState: string;
  sunatCondition: string;
  customerId: string | null;
  odooPartnerId: number | null;
  odooContactId: number | null;
  clientNote: string;
  vendorWhatsapp: string;
  hours: number;
} {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const docKind = src.docKind === "dni" ? "dni" : "ruc";
  const customerId = String(src.customerId || "").trim() || null;
  let ruc = "";
  let dni = "";
  let rucPending = false;
  let clientCompany = "";
  let contactName = "";
  if (docKind === "dni") {
    dni = normalizeDni(src.dni) || "";
    if (!dni) throw new Error("Ingresa un DNI de 8 dígitos.");
    const firstName = String(src.firstName || "").trim().slice(0, 60);
    const lastName = String(src.lastName || "").trim().slice(0, 80);
    if (firstName.length < 2 || lastName.length < 2) throw new Error("Indica nombres y apellidos.");
    contactName = `${firstName} ${lastName}`.slice(0, 120);
    clientCompany = contactName;
    rucPending = true;
  } else {
    ruc = normalizeRuc(src.ruc) || "";
    if (!ruc || !isValidPeruRuc(ruc)) throw new Error("Valida un RUC peruano de 11 dígitos con SUNAT.");
    clientCompany = String(src.clientCompany || src.companyName || "").trim().slice(0, 160);
    if (clientCompany.length < 2) throw new Error("Falta la razón social. Busca el RUC en contactos o en SUNAT.");
    contactName = String(src.contactName || src.clientName || "").trim().slice(0, 120);
    if (contactName.length < 2) throw new Error("Indica el nombre de la persona que verá el catálogo.");
  }
  const clientEmail = String(src.clientEmail || "").trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw new Error("Indica el correo de la persona de contacto.");
  const clientPhone = sharePhone(src);
  if (clientPhone.length < 7) throw new Error("Indica el teléfono de la persona de contacto.");
  const vendorWhatsapp = whatsappDigits(src.vendorWhatsapp);
  if (vendorWhatsapp.length < 9) throw new Error("Indica el WhatsApp del comercial (mínimo 9 dígitos).");
  const shared = {
    clientPhone,
    clientEmail,
    street: String(src.street || "").trim().slice(0, 180),
    district: String(src.district || "").trim().slice(0, 80),
    province: String(src.province || "").trim().slice(0, 80),
    department: String(src.department || "").trim().slice(0, 80),
    sunatState: String(src.sunatState || "").trim().slice(0, 40),
    sunatCondition: String(src.sunatCondition || "").trim().slice(0, 40),
    customerId,
    odooPartnerId: optionalOdooId(src.odooPartnerId),
    odooContactId: optionalOdooId(src.odooContactId),
    clientNote: String(src.clientNote || "").trim().slice(0, 400),
    vendorWhatsapp,
    hours: clampShareHours(src.hours),
  };
  return {
    docKind,
    ruc,
    dni,
    rucPending,
    clientName: contactName,
    clientCompany,
    contactName,
    ...shared,
    sunatState: docKind === "dni" ? "" : shared.sunatState,
    sunatCondition: docKind === "dni" ? "" : shared.sunatCondition,
  };
}

export function deviceFromAgent(userAgent: string): string {
  const ua = String(userAgent || "").toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android|phone/.test(ua)) return "móvil";
  if (!ua) return "";
  return "escritorio";
}

export function clientFromAgent(userAgent: string): string {
  const ua = String(userAgent || "");
  if (!ua) return "";
  let browser = "Navegador";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";
  let os = "";
  if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad/i.test(ua)) os = "iOS";
  else if (/mac os/i.test(ua)) os = "Mac";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/linux/i.test(ua)) os = "Linux";
  return [browser, os].filter(Boolean).join(" · ");
}

export function shareStatus(
  row: { archivedAt?: Date | string | null; suspendedAt?: Date | string | null; expiresAt: Date | string },
  now = new Date(),
) {
  if (row.archivedAt) return "archivado" as const;
  if (row.suspendedAt) return "suspendido" as const;
  if (!shareIsLive(row.expiresAt, now)) return "vencido" as const;
  return "activo" as const;
}

/** Extender suma horas a un enlace vigente. Reactivar abre de nuevo uno vencido, contando desde ahora. */
export function planShareRenew(
  row: { archivedAt?: Date | string | null; suspendedAt?: Date | string | null; expiresAt: Date | string },
  hours: unknown,
  now = new Date(),
): { mode: "extend" | "reactivate"; hours: number; expiresAt: Date } {
  if (row.archivedAt) throw new Error("Este enlace está archivado.");
  if (row.suspendedAt) throw new Error("Este enlace está suspendido. Genera uno nuevo.");
  const span = clampShareHours(hours);
  if (shareIsLive(row.expiresAt, now)) {
    return { mode: "extend", hours: span, expiresAt: shareExpiresAt(new Date(row.expiresAt), span) };
  }
  return { mode: "reactivate", hours: span, expiresAt: shareExpiresAt(now, span) };
}

const FILTER_LABEL: Record<string, string> = {
  type: "tipo",
  cat: "condición",
  depot: "depósito",
  manufacturer: "fabricante",
  sort: "orden",
};

export function summarizeShareEvents(events: Array<{ kind: string; iso?: string | null; detail?: unknown; createdAt: Date | string; ip?: string; device?: string; userAgent?: string }>) {
  const opens: Array<{ at: string; ip: string; device: string; client: string }> = [];
  const filters = new Map<string, number>();
  const searches = new Map<string, number>();
  const units = new Map<string, number>();
  const imageCount = new Map<string, number>();
  const imageSlots = new Map<string, Set<string>>();
  const images = new Map<string, { iso: string; slot: string; count: number }>();
  const places = new Map<string, Array<{ ip: string; device: string; client: string }>>();
  for (const ev of events) {
    const detail = ev.detail && typeof ev.detail === "object" && !Array.isArray(ev.detail) ? (ev.detail as Record<string, unknown>) : {};
    const client = clientFromAgent(ev.userAgent || "");
    if (ev.kind === "open") {
      opens.push({ at: new Date(ev.createdAt).toISOString(), ip: ev.ip || "", device: ev.device || "", client });
    }
    if (ev.kind === "filter") {
      const label = Object.entries(FILTER_LABEL)
        .map(([key, name]) => (detail[key] ? `${name}: ${detail[key]}` : ""))
        .filter(Boolean)
        .join(" · ") || "filtro";
      filters.set(label, (filters.get(label) || 0) + 1);
    }
    if (ev.kind === "search") {
      const q = String(detail.q || "").trim().slice(0, 80);
      if (q) searches.set(q, (searches.get(q) || 0) + 1);
    }
    if (ev.iso && (ev.kind === "view_unit" || ev.kind === "view_image")) {
      const spot = { ip: ev.ip || "", device: ev.device || "", client };
      const prev = places.get(ev.iso) || [];
      const key = `${spot.ip}|${spot.device}|${spot.client}`;
      if (!prev.some((item) => `${item.ip}|${item.device}|${item.client}` === key)) prev.push(spot);
      places.set(ev.iso, prev.slice(0, 6));
    }
    if (ev.kind === "view_unit" && ev.iso) units.set(ev.iso, (units.get(ev.iso) || 0) + 1);
    if (ev.kind === "view_image" && ev.iso) {
      const slot = String(detail.slot ?? "");
      const key = `${ev.iso}:${slot}`;
      const prev = images.get(key);
      images.set(key, { iso: ev.iso, slot, count: (prev?.count || 0) + 1 });
      imageCount.set(ev.iso, (imageCount.get(ev.iso) || 0) + 1);
      const slots = imageSlots.get(ev.iso) || new Set<string>();
      slots.add(slot);
      imageSlots.set(ev.iso, slots);
    }
  }
  const byCount = (entries: Array<[string, number]>) => entries.sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  const seen = new Set<string>([...units.keys(), ...imageCount.keys()]);
  return {
    opens,
    filters: byCount([...filters.entries()]),
    searches: [...searches.entries()].sort((a, b) => b[1] - a[1]).map(([q, count]) => ({ q, count })),
    units: [...seen].map((iso) => {
      const views = units.get(iso) || 0;
      return {
        iso,
        count: views,
        views,
        images: imageCount.get(iso) || 0,
        distinctImages: imageSlots.get(iso)?.size || 0,
        returns: Math.max(0, views - 1),
        places: places.get(iso) || [],
      };
    }).sort((a, b) => b.views - a.views || b.images - a.images),
    images: [...images.values()].sort((a, b) => b.count - a.count),
  };
}

export function normalizeShareEvent(raw: unknown): { kind: ShareEventKind; iso: string | null; detail: Record<string, unknown> } {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const kind = SHARE_EVENT_KINDS.includes(src.kind as ShareEventKind) ? (src.kind as ShareEventKind) : "open";
  const iso = String(src.iso || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) || null;
  const detail = src.detail && typeof src.detail === "object" && !Array.isArray(src.detail) ? (src.detail as Record<string, unknown>) : {};
  return { kind, iso, detail };
}

export function shareExpiresAt(from: Date, hours: number): Date {
  return new Date(from.getTime() + clampShareHours(hours) * 3600 * 1000);
}

/** Portería usa 1 h (DNI) o 3 h (RUC). El alta comercial sigue acotada de 24 a 240. */
export function shareExpiresAtExact(from: Date, hours: number): Date {
  const n = Math.round(Number(hours));
  if (!Number.isFinite(n) || n < 1 || n > SHARE_HOURS_MAX) throw new Error("Vigencia inválida.");
  return new Date(from.getTime() + n * 3600 * 1000);
}

export function normalizeWalkIn(raw: unknown): {
  docKind: "ruc" | "dni";
  ruc: string;
  dni: string;
  contactName: string;
  clientEmail: string;
  clientPhone: string;
  hours: number;
} {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rucDigits = String(src.ruc || "").replace(/\D/g, "");
  const docKind = src.docKind === "dni" || !rucDigits ? "dni" : "ruc";
  const dni = normalizeDni(src.dni) || "";
  if (!dni) throw new Error("Ingresa tu DNI de 8 dígitos.");
  const firstName = String(src.firstName || "").trim().slice(0, 60);
  const lastName = String(src.lastName || "").trim().slice(0, 80);
  if (firstName.length < 2 || lastName.length < 2) throw new Error("Indica tus nombres y apellidos.");
  const clientEmail = String(src.clientEmail || "").trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw new Error("Indica tu correo electrónico.");
  const clientPhone = sharePhone(src);
  if (clientPhone.length < 7) throw new Error("Indica tu celular de WhatsApp.");
  let ruc = "";
  if (docKind === "ruc") {
    ruc = normalizeRuc(src.ruc) || "";
    if (!ruc || !isValidPeruRuc(ruc)) throw new Error("Ingresa un RUC peruano de 11 dígitos.");
  }
  return {
    docKind,
    ruc,
    dni,
    contactName: `${firstName} ${lastName}`.slice(0, 120),
    clientEmail,
    clientPhone,
    hours: docKind === "ruc" ? WALKIN_RUC_HOURS : WALKIN_DNI_HOURS,
  };
}

export function shareIsLive(expiresAt: Date | string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() > now.getTime();
}
