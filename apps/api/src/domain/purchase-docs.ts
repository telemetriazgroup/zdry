/** Tipos de documento de una factura de compra — PDF e imágenes. */

export const PURCHASE_DOC_KINDS = [
  { key: "factura", label: "Factura" },
  { key: "bl", label: "BL / Conocimiento de embarque" },
  { key: "manifiesto", label: "Manifiesto" },
  { key: "packing_list", label: "Packing list" },
  { key: "dam", label: "DAM" },
  { key: "otro", label: "Otro" },
] as const;

export type PurchaseDocKind = (typeof PURCHASE_DOC_KINDS)[number]["key"];

export const PURCHASE_DOC_KIND_KEYS = PURCHASE_DOC_KINDS.map((k) => k.key);

export const MAX_PURCHASE_DOCS = 10;
export const MAX_PURCHASE_DOC_BYTES = 15 * 1024 * 1024;

const MIME_BY_SNIFF: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isPurchaseDocKind(raw: string): raw is PurchaseDocKind {
  return (PURCHASE_DOC_KIND_KEYS as string[]).includes(raw);
}

export function sniffPurchaseDocMime(buf: Buffer): string {
  if (buf.length < 12) throw new Error("Archivo vacío o demasiado corto.");
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("Solo se aceptan PDF o imágenes (JPG, PNG, WEBP, GIF).");
}

export function extForMime(mime: string): string {
  return MIME_BY_SNIFF[mime] || "bin";
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isPdfMime(mime: string): boolean {
  return mime === "application/pdf";
}
