export const YEAR_MIN = 1980;

export function parseBuildYear(
  v: unknown,
  now = new Date().getFullYear(),
): { ok: true; year: number | null } | { ok: false; message: string } {
  if (v === null || v === undefined || v === "") return { ok: true, year: null };
  const raw = String(v).trim();
  if (!raw) return { ok: true, year: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, message: `El año debe estar entre ${YEAR_MIN} y ${now}.` };
  }
  const year = Math.round(n);
  if (year < YEAR_MIN || year > now) {
    return { ok: false, message: `El año debe estar entre ${YEAR_MIN} y ${now}.` };
  }
  return { ok: true, year };
}
