/** Fotos de inspección (slots 0–8) y video 360 opcional. */

export const MAX_INSPECTION_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_INSPECTION_VIDEO_BYTES = 40 * 1024 * 1024;

const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const VIDEO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function sniffInspectionPhotoMime(buf: Buffer): string {
  if (buf.length < 12) throw new Error("Archivo vacío o demasiado corto.");
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("Solo se aceptan imágenes (JPG, PNG, WEBP, GIF).");
}

export function sniffInspectionVideoMime(buf: Buffer): string {
  if (buf.length < 12) throw new Error("Video vacío o demasiado corto.");
  if (buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  throw new Error("Solo se aceptan videos MP4 o WEBM.");
}

export function extForInspectionMime(mime: string): string {
  return PHOTO_EXT[mime] || VIDEO_EXT[mime] || "bin";
}
