export const VISIT_MOTIVES = ["cargar", "descargar"] as const;
export type VisitMotive = (typeof VISIT_MOTIVES)[number];

export function normalizePlate(raw: string) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function displayPlate(raw: string) {
  return String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

export function parseMotive(v: unknown): VisitMotive | null {
  const t = String(v || "").trim().toLowerCase();
  return (VISIT_MOTIVES as readonly string[]).includes(t) ? (t as VisitMotive) : null;
}

export function visitIsLocked(status: string | null | undefined) {
  return String(status || "REGISTRADO") !== "REGISTRADO";
}

export function canPublicEditVisit(status: string | null | undefined) {
  return !visitIsLocked(status);
}

export function shortVisitCode(token: string) {
  return String(token || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

export type VisitPhotoStatus = "none" | "visible" | "archived" | "rejected";

export function visitPhotoStatus(row: {
  unitPhotoKey?: string | null;
  unitPhotoArchivedAt?: Date | string | null;
  unitPhotoRejectedAt?: Date | string | null;
}): VisitPhotoStatus {
  if (!row.unitPhotoKey) return "none";
  if (row.unitPhotoArchivedAt) return "archived";
  if (row.unitPhotoRejectedAt) return "rejected";
  return "visible";
}
