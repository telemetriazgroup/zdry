/** Q3: PDF Perú v2 desde Odoo. No se clona el QWeb. */

export const PERU_V2_MARKERS = ["COTIZA", "COTIZACIÓN", "COTIZACION"] as const;

export function isPdfBuffer(buf: Buffer | Uint8Array | null | undefined): boolean {
  if (!buf || buf.length < 5) return false;
  return Buffer.from(buf.subarray(0, 5)).toString("latin1") === "%PDF-";
}

export function decodeOdooPdf(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw) && isPdfBuffer(raw)) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "result" in (raw as object)) {
    return decodeOdooPdf((raw as { result: unknown }).result);
  }
  if (Array.isArray(raw) && raw.length) {
    if (typeof raw[0] === "number") return Buffer.from(raw as number[]);
    return decodeOdooPdf(raw[0]);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("%PDF")) return Buffer.from(s, "binary");
    const b64 = s.replace(/\s/g, "");
    const buf = Buffer.from(b64, "base64");
    if (isPdfBuffer(buf)) return buf;
    throw new Error("Odoo no devolvió un PDF válido.");
  }
  throw new Error("Odoo no devolvió un PDF.");
}

export function pdfLatinHaystack(buf: Buffer): string {
  return Buffer.from(buf).toString("latin1");
}

export function pdfLooksLikePeruV2(buf: Buffer, saleName?: string | null): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!isPdfBuffer(buf)) missing.push("%PDF");
  const hay = pdfLatinHaystack(buf).toUpperCase();
  if (!PERU_V2_MARKERS.some((m) => hay.includes(m.toUpperCase()))) missing.push("COTIZACIÓN");
  const name = String(saleName || "").trim();
  if (name && !hay.includes(name.toUpperCase()) && !pdfLatinHaystack(buf).includes(name)) missing.push("name");
  return { ok: missing.length === 0, missing };
}

export function presupuestoFilename(saleName?: string | null, quoteNumber?: string | null): string {
  const n = String(saleName || quoteNumber || "cotizacion").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `Presupuesto - ${n}.pdf`;
}

export function quotePdfStorageKey(quoteId: string, saleName?: string | null): string {
  const slug = String(saleName || quoteId).replace(/[^\w.-]+/g, "_");
  return `quotes/${quoteId}/presupuesto-${slug}.pdf`;
}

export function cronogramaFilename(saleName?: string | null, quoteNumber?: string | null): string {
  const n = String(saleName || quoteNumber || "cronograma").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `Cronograma - ${n}.pdf`;
}

export function cronogramaStorageKey(quoteId: string, saleName?: string | null): string {
  const slug = String(saleName || quoteId).replace(/[^\w.-]+/g, "_");
  return `quotes/${quoteId}/cronograma-${slug}.pdf`;
}

export function quoteMailBody(saleName: string, quoteNumber: string): string {
  return `<p>Adjuntamos su cotización <b>${saleName || quoteNumber}</b> (formato Perú – Presupuesto/Pedido versión 2).</p>`;
}
