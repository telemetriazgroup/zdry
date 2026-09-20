import { NotFoundException } from "@nestjs/common";
import { isZdryRefAttachment } from "../domain/odoo-ref-photo";
import { OdooClient } from "./odoo.client";

export type OdooLotPhotoMeta = {
  id: number;
  name: string;
  mimetype: string;
  size: number;
  kind: "zdry_ref" | "inbox";
};

export type OdooLotNote = {
  id: number;
  body: string;
  author: string | null;
  date: string | null;
};

export function stripOdooHtml(html: unknown): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function notesFromMailRecords(rows: Record<string, unknown>[]): OdooLotNote[] {
  const out: OdooLotNote[] = [];
  for (const m of rows || []) {
    const body = stripOdooHtml(m.body);
    if (!body) continue;
    const author = Array.isArray(m.author_id) ? String(m.author_id[1] || "").trim() : "";
    out.push({
      id: Number(m.id),
      body: body.slice(0, 4000),
      author: author || null,
      date: m.date ? String(m.date) : null,
    });
  }
  return out;
}

export async function listOdooLotChatter(
  odoo: OdooClient,
  lotId: number,
): Promise<{ photos: OdooLotPhotoMeta[]; notes: OdooLotNote[] }> {
  try {
    const attached = await odoo.searchRead(
      "ir.attachment",
      ["&", ["res_model", "=", "stock.lot"], ["res_id", "=", lotId]],
      ["id", "name", "mimetype", "file_size", "checksum", "description"],
      { limit: 24 },
    );
    const messages = await odoo.searchRead(
      "mail.message",
      [
        ["model", "=", "stock.lot"],
        ["res_id", "=", lotId],
      ],
      ["id", "attachment_ids", "date", "author_id", "body", "message_type"],
      { limit: 80, order: "date desc" },
    );
    const extraIds = messages.flatMap((m) => (Array.isArray(m.attachment_ids) ? (m.attachment_ids as number[]) : []));
    const extra = extraIds.length
      ? await odoo.searchRead("ir.attachment", [["id", "in", extraIds]], ["id", "name", "mimetype", "file_size", "checksum", "description"], {
          limit: 24,
        })
      : [];
    const seen = new Set<number>();
    const photos = [...attached, ...extra]
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
        kind: (isZdryRefAttachment(a) ? "zdry_ref" : "inbox") as OdooLotPhotoMeta["kind"],
      }));
    return { photos, notes: notesFromMailRecords(messages) };
  } catch {
    return { photos: [], notes: [] };
  }
}

export async function listOdooLotPhotos(odoo: OdooClient, lotId: number): Promise<OdooLotPhotoMeta[]> {
  return (await listOdooLotChatter(odoo, lotId)).photos;
}

export async function listOdooLotNotes(odoo: OdooClient, lotId: number): Promise<OdooLotNote[]> {
  return (await listOdooLotChatter(odoo, lotId)).notes;
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
