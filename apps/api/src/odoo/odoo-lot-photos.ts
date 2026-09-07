import { NotFoundException } from "@nestjs/common";
import { OdooClient } from "./odoo.client";

export type OdooLotPhotoMeta = {
  id: number;
  name: string;
  mimetype: string;
  size: number;
};

export async function listOdooLotPhotos(odoo: OdooClient, lotId: number): Promise<OdooLotPhotoMeta[]> {
  try {
    const attached = await odoo.searchRead(
      "ir.attachment",
      ["&", ["res_model", "=", "stock.lot"], ["res_id", "=", lotId]],
      ["id", "name", "mimetype", "file_size", "checksum"],
      { limit: 24 },
    );
    const messages = await odoo.searchRead(
      "mail.message",
      [
        ["model", "=", "stock.lot"],
        ["res_id", "=", lotId],
      ],
      ["id", "attachment_ids", "date", "author_id", "body"],
      { limit: 30 },
    );
    const extraIds = messages.flatMap((m) => (Array.isArray(m.attachment_ids) ? (m.attachment_ids as number[]) : []));
    const extra = extraIds.length
      ? await odoo.searchRead("ir.attachment", [["id", "in", extraIds]], ["id", "name", "mimetype", "file_size", "checksum"], {
          limit: 24,
        })
      : [];
    const seen = new Set<number>();
    return [...attached, ...extra]
      .filter((a) => {
        const n = Number(a.id);
        if (seen.has(n)) return false;
        seen.add(n);
        const mime = String(a.mimetype || "");
        return mime.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(String(a.name || ""));
      })
      .map((a) => ({
        id: Number(a.id),
        name: String(a.name || "foto"),
        mimetype: String(a.mimetype || "image/jpeg"),
        size: Number(a.file_size) || 0,
      }));
  } catch {
    return [];
  }
}

export async function openOdooLotPhoto(odoo: OdooClient, lotId: number, attId: string) {
  const recs = await odoo.read("ir.attachment", [Number(attId)], ["name", "mimetype", "datas", "res_model", "res_id"]);
  const rec = recs?.[0];
  if (!rec?.datas) throw new NotFoundException("Adjunto no encontrado.");
  const resId = Number(rec.res_id);
  if (rec.res_model === "stock.lot" && resId && resId !== lotId) {
    throw new NotFoundException("Adjunto no pertenece a este lote.");
  }
  const buf = Buffer.from(String(rec.datas), "base64");
  return { buffer: buf, contentType: String(rec.mimetype || "image/jpeg"), name: String(rec.name || "foto") };
}

export function limaDayRange(ymd?: string) {
  const day =
    ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)
      ? ymd
      : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  return {
    date: day,
    start: new Date(`${day}T00:00:00-05:00`),
    end: new Date(`${day}T23:59:59.999-05:00`),
  };
}
