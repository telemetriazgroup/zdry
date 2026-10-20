/** Odoo manda la fecha-hora en GMT, sin zona. Lima es GMT−5 todo el año. Una fecha sin hora no se mueve. */
export function odooInstantToLima(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value || value === "false") return "";
  if (!/[T ]\d{2}:\d{2}/.test(value)) return value;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const zoned = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const instant = new Date(zoned);
  if (Number.isNaN(instant.getTime())) return value;
  const lima = new Date(instant.getTime() - 5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${lima.getUTCFullYear()}-${pad(lima.getUTCMonth() + 1)}-${pad(lima.getUTCDate())} ${pad(lima.getUTCHours())}:${pad(lima.getUTCMinutes())}:${pad(lima.getUTCSeconds())}`;
}
