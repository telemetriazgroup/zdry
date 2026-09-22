import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { OdooClient } from "../odoo/odoo.client";
import { listOdooLotChatter, openOdooLotPhoto, type OdooLotPhotoMeta } from "../odoo/odoo-lot-photos";
import { MAX_INSPECTION_PHOTO_BYTES } from "../domain/inspection-media";

export type CachedOdooPhoto = OdooLotPhotoMeta & { local: boolean };

type CacheTarget = {
  odooLotId: number;
  containerIso?: string | null;
  candidateId?: string | null;
};

export function presentCachedPhotos(
  rows: Array<{ odooAttId: number; originalName: string; mimeType: string; sizeBytes: number; kind: string }>,
): CachedOdooPhoto[] {
  return rows.map((r) => ({
    id: r.odooAttId,
    name: r.originalName,
    mimetype: r.mimeType,
    size: r.sizeBytes,
    kind: r.kind === "zdry_ref" ? "zdry_ref" : "inbox",
    local: true,
  }));
}

export async function listCachedOdooPhotos(prisma: PrismaService, odooLotId: number): Promise<CachedOdooPhoto[]> {
  const rows = await prisma.odooCachedPhoto.findMany({
    where: { odooLotId },
    orderBy: { createdAt: "asc" },
  });
  return presentCachedPhotos(rows);
}

export async function openCachedOdooPhoto(
  prisma: PrismaService,
  storage: StorageService,
  odooLotId: number,
  attId: string,
): Promise<{ buffer: Buffer; contentType: string; name: string } | null> {
  const row = await prisma.odooCachedPhoto.findUnique({
    where: { odooLotId_odooAttId: { odooLotId, odooAttId: Number(attId) } },
  });
  if (!row) return null;
  const obj = await storage.getBuffer(row.storageKey);
  return { buffer: obj.buffer, contentType: row.mimeType || obj.contentType || "image/jpeg", name: row.originalName };
}

async function persistOne(
  prisma: PrismaService,
  storage: StorageService,
  target: CacheTarget,
  meta: OdooLotPhotoMeta,
  buffer: Buffer,
  contentType: string,
) {
  const safeName = String(meta.name || "foto").replace(/[/\\]/g, "_").slice(0, 180);
  const ext = (contentType.split("/")[1] || "jpg").replace("jpeg", "jpg").slice(0, 8);
  const storageKey = `odoo-lots/${target.odooLotId}/photos/${meta.id}.${ext}`;
  await storage.put(storageKey, buffer, contentType || meta.mimetype || "image/jpeg");
  await prisma.odooCachedPhoto.upsert({
    where: { odooLotId_odooAttId: { odooLotId: target.odooLotId, odooAttId: meta.id } },
    update: {
      containerIso: target.containerIso || undefined,
      candidateId: target.candidateId || undefined,
      storageKey,
      mimeType: contentType || meta.mimetype || "image/jpeg",
      originalName: safeName,
      sizeBytes: buffer.length,
      kind: meta.kind,
      fetchedAt: new Date(),
    },
    create: {
      odooLotId: target.odooLotId,
      odooAttId: meta.id,
      containerIso: target.containerIso || null,
      candidateId: target.candidateId || null,
      storageKey,
      mimeType: contentType || meta.mimetype || "image/jpeg",
      originalName: safeName,
      sizeBytes: buffer.length,
      kind: meta.kind,
    },
  });
}

export async function cacheOdooLotPhotos(
  prisma: PrismaService,
  storage: StorageService,
  odoo: OdooClient,
  target: CacheTarget,
  onProgress?: (info: { current: number; total: number; name: string }) => Promise<void> | void,
): Promise<{ photos: CachedOdooPhoto[]; cached: number; skipped: number }> {
  const chatter = await listOdooLotChatter(odoo, target.odooLotId);
  const existing = await prisma.odooCachedPhoto.findMany({
    where: { odooLotId: target.odooLotId },
    select: { odooAttId: true },
  });
  const have = new Set(existing.map((r) => r.odooAttId));
  let cached = 0;
  let skipped = 0;
  let i = 0;
  const total = chatter.photos.length;
  for (const meta of chatter.photos) {
    i += 1;
    await onProgress?.({ current: i, total, name: meta.name });
    if (have.has(meta.id)) {
      if (target.containerIso || target.candidateId) {
        await prisma.odooCachedPhoto.updateMany({
          where: { odooLotId: target.odooLotId, odooAttId: meta.id },
          data: {
            ...(target.containerIso ? { containerIso: target.containerIso } : {}),
            ...(target.candidateId ? { candidateId: target.candidateId } : {}),
          },
        });
      }
      continue;
    }
    try {
      const obj = await openOdooLotPhoto(odoo, target.odooLotId, String(meta.id));
      if (obj.buffer.length > MAX_INSPECTION_PHOTO_BYTES) {
        skipped += 1;
        continue;
      }
      await persistOne(prisma, storage, target, meta, obj.buffer, obj.contentType);
      cached += 1;
    } catch {
      skipped += 1;
    }
  }
  const photos = await listCachedOdooPhotos(prisma, target.odooLotId);
  return { photos, cached, skipped };
}

export async function listOrCacheOdooPhotos(
  prisma: PrismaService,
  storage: StorageService,
  odoo: OdooClient,
  target: CacheTarget,
): Promise<CachedOdooPhoto[]> {
  const local = await listCachedOdooPhotos(prisma, target.odooLotId);
  if (local.length) return local;
  const pulled = await cacheOdooLotPhotos(prisma, storage, odoo, target);
  return pulled.photos;
}

export async function openOrCacheOdooPhoto(
  prisma: PrismaService,
  storage: StorageService,
  odoo: OdooClient,
  target: CacheTarget,
  attId: string,
): Promise<{ buffer: Buffer; contentType: string; name: string }> {
  const local = await openCachedOdooPhoto(prisma, storage, target.odooLotId, attId);
  if (local) return local;
  const obj = await openOdooLotPhoto(odoo, target.odooLotId, attId);
  if (obj.buffer.length <= MAX_INSPECTION_PHOTO_BYTES) {
    await persistOne(
      prisma,
      storage,
      target,
      {
        id: Number(attId),
        name: obj.name,
        mimetype: obj.contentType,
        size: obj.buffer.length,
        kind: "inbox",
      },
      obj.buffer,
      obj.contentType,
    );
  }
  return obj;
}
