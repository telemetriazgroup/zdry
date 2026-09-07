import { readFile } from "fs/promises";
import { join } from "path";
import Jimp from "jimp";

/** Formato de la galería pública (ficha cliente). */
export const PUBLIC_PHOTO_W = 1600;
export const PUBLIC_PHOTO_H = 1000;
const CANVAS_BG = 0xeef1f6ff;

export function defaultWatermarkPath() {
  return join(__dirname, "..", "assets", "zg_marca.png");
}

let defaultMark: Buffer | null | undefined;

export async function loadDefaultWatermark(): Promise<Buffer | null> {
  if (defaultMark !== undefined) return defaultMark;
  try {
    defaultMark = await readFile(defaultWatermarkPath());
  } catch {
    defaultMark = null;
  }
  return defaultMark;
}

function punchBlack(logo: Jimp) {
  logo.scan(0, 0, logo.getWidth(), logo.getHeight(), function (_x, _y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    if (r < 28 && g < 28 && b < 28) this.bitmap.data[idx + 3] = 0;
  });
}

let overlayCache: { key: string; img: Jimp } | null = null;

async function tiledOverlay(mark: Buffer) {
  const key = `${mark.length}:${mark[0]}:${mark[mark.length - 1]}`;
  if (overlayCache?.key === key) return overlayCache.img;
  const sheet = new Jimp(PUBLIC_PHOTO_W, PUBLIC_PHOTO_H, 0x00000000);
  await tileMark(sheet, mark);
  overlayCache = { key, img: sheet };
  return sheet;
}

async function tileMark(canvas: Jimp, mark: Buffer) {
  const raw = await Jimp.read(mark);
  const target = Math.max(110, Math.round(canvas.getWidth() * 0.18));
  raw.resize(target, Jimp.AUTO);
  punchBlack(raw);
  raw.opacity(0.2);
  const w = canvas.getWidth();
  const h = canvas.getHeight();
  const lw = raw.getWidth();
  const lh = raw.getHeight();
  const stepX = lw + Math.round(lw * 0.55);
  const stepY = lh + Math.round(lh * 0.85);
  for (let row = 0, y = 12; y < h; y += stepY, row += 1) {
    const ox = row % 2 ? Math.round(stepX / 2) : 12;
    for (let x = ox; x < w; x += stepX) {
      canvas.composite(raw, x, y);
    }
  }
}

export function isPortraitSize(width: number, height: number) {
  return height > width;
}

function placeOnPublicCanvas(src: Jimp) {
  const canvas = new Jimp(PUBLIC_PHOTO_W, PUBLIC_PHOTO_H, CANVAS_BG);
  if (!isPortraitSize(src.getWidth(), src.getHeight())) {
    src.resize(PUBLIC_PHOTO_W, PUBLIC_PHOTO_H);
    canvas.composite(src, 0, 0);
    return canvas;
  }
  const scale = Math.min(PUBLIC_PHOTO_W / src.getWidth(), PUBLIC_PHOTO_H / src.getHeight());
  const nw = Math.max(1, Math.round(src.getWidth() * scale));
  const nh = Math.max(1, Math.round(src.getHeight() * scale));
  src.resize(nw, nh);
  canvas.composite(src, Math.round((PUBLIC_PHOTO_W - nw) / 2), Math.round((PUBLIC_PHOTO_H - nh) / 2));
  return canvas;
}

export async function applyCatalogWatermark(photo: Buffer, mark?: Buffer | null) {
  const src = await Jimp.read(photo);
  const canvas = placeOnPublicCanvas(src);

  const logo = mark?.length ? mark : await loadDefaultWatermark();
  if (logo?.length) {
    try {
      canvas.composite(await tiledOverlay(logo), 0, 0);
    } catch {
      /* logo inválido: la foto igual sale al formato de la ficha */
    }
  }

  const buffer = await canvas.quality(86).getBufferAsync(Jimp.MIME_JPEG);
  return { buffer, mime: "image/jpeg" as const, width: PUBLIC_PHOTO_W, height: PUBLIC_PHOTO_H };
}
