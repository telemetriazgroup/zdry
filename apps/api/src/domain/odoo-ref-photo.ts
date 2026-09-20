export const ZDRY_REF_DESC = "zdry_ref";
export const ZDRY_SYNC_CONTEXT = { zdry_sync: true } as const;
export const ODOO_REF_MAX_EDGE = 1600;

export type ZdryRefAttachment = {
  id: number;
  name?: string;
  description?: string;
};

export function normalizeIsoForRef(iso: string): string {
  return String(iso || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export function zdryRefAttachmentName(iso: string): string {
  return `zdry_ref_${normalizeIsoForRef(iso)}.jpg`;
}

export function isZdryRefAttachment(att: { name?: unknown; description?: unknown }): boolean {
  const desc = String(att.description || "").trim();
  const name = String(att.name || "");
  return desc === ZDRY_REF_DESC || /^zdry_ref_/i.test(name);
}

/** Por nombre: tras message_post Odoo mueve el adjunto a mail.message. */
export function zdryRefSearchDomain(lotId: number, iso: string): unknown[] {
  return [
    "|",
    ["name", "=", zdryRefAttachmentName(iso)],
    "&",
    "&",
    ["description", "=", ZDRY_REF_DESC],
    ["res_model", "=", "stock.lot"],
    ["res_id", "=", lotId],
  ];
}

export function plainChatterBody(text: string): string {
  return String(text || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<\s*\/?\s*p\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isZdryRefNoteBody(body: string): boolean {
  return /referencia fotogr[aá]fica zdry/i.test(plainChatterBody(body));
}

export function zdryRefMessagePostKw(body: string, attachmentId: number) {
  return {
    body: plainChatterBody(body),
    message_type: "comment" as const,
    attachment_ids: [attachmentId],
  };
}

export function pickZdryRefIdsToUnlink(existing: ZdryRefAttachment[], keepId?: number): number[] {
  return existing
    .filter((a) => isZdryRefAttachment(a))
    .map((a) => Number(a.id))
    .filter((id) => id > 0 && id !== keepId);
}

/** Crea primero, luego unlink de los zdry_ref anteriores. Tras dos reemplazos queda 1. */
export function applyZdryRefReplace(
  existing: ZdryRefAttachment[],
  created: ZdryRefAttachment,
): ZdryRefAttachment[] {
  const drop = new Set(pickZdryRefIdsToUnlink(existing, created.id));
  return [...existing.filter((a) => !drop.has(Number(a.id))), created];
}

export function planNineSlotsOneRef(slotsFilled: number): { uploads: number; staysInZdry: number } {
  const n = Math.max(0, Math.min(9, slotsFilled));
  return { uploads: n > 0 ? 1 : 0, staysInZdry: Math.max(0, n - 1) };
}

export function canPublishOdooRef(photo: { source?: string | null } | null | undefined): {
  ok: boolean;
  message?: string;
} {
  if (!photo) return { ok: false, message: "No hay foto en esa casilla." };
  if (String(photo.source || "zdry") === "odoo") {
    return { ok: false, message: "Esta foto vino del inbox de Odoo; no se vuelve a subir." };
  }
  return { ok: true };
}

export function zdryRefMessageBody(iso: string, slot: number, label: string): string {
  const casilla = Number.isInteger(slot) ? slot + 1 : slot;
  return `Referencia fotográfica ZDRY actualizada (${normalizeIsoForRef(iso)}, casilla ${casilla}: ${label}).`;
}
