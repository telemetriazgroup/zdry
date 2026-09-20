import Jimp from "jimp";
import { ODOO_REF_MAX_EDGE } from "./odoo-ref-photo";

/** JPEG de cara Odoo: recorte de peso, sin watermark de catálogo. */
export async function toOdooRefJpeg(buffer: Buffer): Promise<Buffer> {
  const img = await Jimp.read(buffer);
  if (img.getWidth() > ODOO_REF_MAX_EDGE || img.getHeight() > ODOO_REF_MAX_EDGE) {
    img.scaleToFit(ODOO_REF_MAX_EDGE, ODOO_REF_MAX_EDGE);
  }
  return img.quality(82).getBufferAsync(Jimp.MIME_JPEG);
}
