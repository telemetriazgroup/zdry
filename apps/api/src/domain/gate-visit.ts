export const VISIT_MOTIVES = ["cargar", "descargar"] as const;
export type VisitMotive = (typeof VISIT_MOTIVES)[number];

export function normalizePlate(raw: string) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function parseMotive(v: unknown): VisitMotive | null {
  const t = String(v || "").trim().toLowerCase();
  return (VISIT_MOTIVES as readonly string[]).includes(t) ? (t as VisitMotive) : null;
}

export function visitIsLocked(linkedAt: Date | string | null | undefined) {
  return !!linkedAt;
}

export function canPublicEditVisit(linkedAt: Date | string | null | undefined) {
  return !visitIsLocked(linkedAt);
}

export function shortVisitCode(token: string) {
  return String(token || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

export type VisitPhotoStatus = "none" | "pending" | "approved" | "rejected";

export function visitPhotoStatus(row: {
  unitPhotoKey?: string | null;
  unitPhotoApprovedAt?: Date | string | null;
  unitPhotoRejectedAt?: Date | string | null;
}): VisitPhotoStatus {
  if (!row.unitPhotoKey) return "none";
  if (row.unitPhotoApprovedAt) return "approved";
  if (row.unitPhotoRejectedAt) return "rejected";
  return "pending";
}
