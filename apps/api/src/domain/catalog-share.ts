import { randomBytes } from "crypto";
import { whatsappDigits } from "./catalog-commerce";

export const SHARE_HOURS_MIN = 48;
export const SHARE_HOURS_MAX = 120;
export const SHARE_HOUR_OPTIONS = [48, 72, 96, 120] as const;

export const SHARE_EVENT_KINDS = ["open", "view_unit", "whatsapp", "cart", "search"] as const;
export type ShareEventKind = (typeof SHARE_EVENT_KINDS)[number];

export function clampShareHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 72;
  return Math.min(SHARE_HOURS_MAX, Math.max(SHARE_HOURS_MIN, Math.round(n)));
}

export function newShareToken(): string {
  return randomBytes(12).toString("hex");
}

export function normalizeShareDraft(raw: unknown): {
  clientName: string;
  clientCompany: string;
  clientPhone: string;
  clientNote: string;
  vendorWhatsapp: string;
  hours: number;
} {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const clientName = String(src.clientName || "").trim().slice(0, 120);
  if (clientName.length < 2) throw new Error("Indica el nombre del cliente.");
  const vendorWhatsapp = whatsappDigits(src.vendorWhatsapp);
  if (vendorWhatsapp.length < 9) throw new Error("Indica el WhatsApp del comercial (mínimo 9 dígitos).");
  return {
    clientName,
    clientCompany: String(src.clientCompany || "").trim().slice(0, 160),
    clientPhone: whatsappDigits(src.clientPhone).slice(0, 20),
    clientNote: String(src.clientNote || "").trim().slice(0, 400),
    vendorWhatsapp,
    hours: clampShareHours(src.hours),
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
