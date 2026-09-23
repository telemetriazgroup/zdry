import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { whatsappDigits } from "./catalog-commerce";
import { isValidPeruRuc, normalizeRuc } from "./ruc-sunat";

export const SHARE_HOURS_MIN = 24;
export const SHARE_HOURS_MAX = 240;
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

export function signShareGrant(token: string): string {
  const mac = createHmac("sha256", shareGrantSecret()).update(token).digest("base64url");
  return `${token}.${mac}`;
}

export function readShareGrant(raw: unknown): string | null {
  const value = String(raw || "");
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const token = value.slice(0, i);
  const mac = value.slice(i + 1);
  const expected = createHmac("sha256", shareGrantSecret()).update(token).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

export function normalizeShareDraft(raw: unknown): {
  ruc: string;
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
  clientNote: string;
  vendorWhatsapp: string;
  hours: number;
} {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ruc = normalizeRuc(src.ruc);
  if (!ruc || !isValidPeruRuc(ruc)) throw new Error("Valida un RUC peruano de 11 dígitos con SUNAT.");
  const clientCompany = String(src.clientCompany || src.companyName || "").trim().slice(0, 160);
  if (clientCompany.length < 2) throw new Error("Falta la razón social de SUNAT. Vuelve a validar el RUC.");
  const contactName = String(src.contactName || src.clientName || "").trim().slice(0, 120);
  if (contactName.length < 2) throw new Error("Indica el nombre de la persona que verá el catálogo.");
  const clientEmail = String(src.clientEmail || "").trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw new Error("Indica el correo de la persona de contacto.");
  const clientPhone = whatsappDigits(src.clientPhone || src.contactPhone).slice(0, 20);
  if (clientPhone.length < 7) throw new Error("Indica el teléfono de la persona de contacto.");
  const vendorWhatsapp = whatsappDigits(src.vendorWhatsapp);
  if (vendorWhatsapp.length < 9) throw new Error("Indica el WhatsApp del comercial (mínimo 9 dígitos).");
  const customerId = String(src.customerId || "").trim() || null;
  return {
    ruc,
    clientName: contactName,
    clientCompany,
    clientPhone,
    clientEmail,
    contactName,
    street: String(src.street || "").trim().slice(0, 180),
    district: String(src.district || "").trim().slice(0, 80),
    province: String(src.province || "").trim().slice(0, 80),
    department: String(src.department || "").trim().slice(0, 80),
    sunatState: String(src.sunatState || "").trim().slice(0, 40),
    sunatCondition: String(src.sunatCondition || "").trim().slice(0, 40),
    customerId,
    clientNote: String(src.clientNote || "").trim().slice(0, 400),
    vendorWhatsapp,
    hours: clampShareHours(src.hours),
  };
}

export function deviceFromAgent(userAgent: string): string {
  const ua = String(userAgent || "").toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android|phone/.test(ua)) return "móvil";
  if (!ua) return "";
  return "escritorio";
}

export function shareStatus(row: { suspendedAt?: Date | string | null; expiresAt: Date | string }, now = new Date()) {
  if (row.suspendedAt) return "suspendido" as const;
  if (!shareIsLive(row.expiresAt, now)) return "vencido" as const;
  return "activo" as const;
}

export function summarizeShareEvents(events: Array<{ kind: string; iso?: string | null; detail?: unknown; createdAt: Date | string; ip?: string; device?: string }>) {
  const opens: Array<{ at: string; ip: string; device: string }> = [];
  const filters = new Map<string, number>();
  const searches = new Map<string, number>();
  const units = new Map<string, number>();
  const images = new Map<string, { iso: string; slot: string; count: number }>();
  for (const ev of events) {
    const detail = ev.detail && typeof ev.detail === "object" && !Array.isArray(ev.detail) ? (ev.detail as Record<string, unknown>) : {};
    if (ev.kind === "open") {
      opens.push({ at: new Date(ev.createdAt).toISOString(), ip: ev.ip || "", device: ev.device || "" });
    }
    if (ev.kind === "filter") {
      const label = ["type", "cat", "depot", "manufacturer", "sort"]
        .map((key) => (detail[key] ? `${key}: ${detail[key]}` : ""))
        .filter(Boolean)
        .join(" · ") || "filtro";
      filters.set(label, (filters.get(label) || 0) + 1);
    }
    if (ev.kind === "search") {
      const q = String(detail.q || "").trim().slice(0, 80);
      if (q) searches.set(q, (searches.get(q) || 0) + 1);
    }
    if (ev.kind === "view_unit" && ev.iso) units.set(ev.iso, (units.get(ev.iso) || 0) + 1);
    if (ev.kind === "view_image" && ev.iso) {
      const slot = String(detail.slot ?? "");
      const key = `${ev.iso}:${slot}`;
      const prev = images.get(key);
      images.set(key, { iso: ev.iso, slot, count: (prev?.count || 0) + 1 });
    }
  }
  const byCount = (entries: Array<[string, number]>) => entries.sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  return {
    opens,
    filters: byCount([...filters.entries()]),
    searches: [...searches.entries()].sort((a, b) => b[1] - a[1]).map(([q, count]) => ({ q, count })),
    units: [...units.entries()].sort((a, b) => b[1] - a[1]).map(([iso, count]) => ({ iso, count })),
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

export function shareIsLive(expiresAt: Date | string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() > now.getTime();
}
