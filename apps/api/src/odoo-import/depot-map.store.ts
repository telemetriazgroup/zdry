import { PrismaService } from "../prisma/prisma.service";
import {
  defaultPatioCode,
  OPERATIONAL_PATIOS,
  warehouseFromLocation,
  type PatioCode,
} from "../domain/odoo-warehouse";

export async function ensureOperationalDepots(prisma: PrismaService) {
  for (const p of OPERATIONAL_PATIOS) {
    const found = await prisma.depot.findFirst({
      where: {
        archivedAt: null,
        OR: [{ code: p.code }, { name: { equals: p.name, mode: "insensitive" } }],
      },
    });
    if (found) {
      if (!found.code) {
        await prisma.depot.update({
          where: { id: found.id },
          data: { code: p.code, protected: true },
        });
      }
      continue;
    }
    await prisma.depot.create({
      data: {
        code: p.code,
        name: p.name,
        city: p.city,
        address: p.address,
        dailyRateTeu: 1,
        protected: true,
      },
    });
  }
}

export async function depotByCode(prisma: PrismaService, code: PatioCode | string) {
  return prisma.depot.findFirst({ where: { code, archivedAt: null } });
}

export async function depotForOdooLocation(prisma: PrismaService, locationName: string | null | undefined) {
  await ensureOperationalDepots(prisma);
  const warehouse = warehouseFromLocation(locationName);
  const patio = defaultPatioCode(warehouse);
  if (patio) {
    const d = await depotByCode(prisma, patio);
    if (d) return { depot: d, warehouse };
  }
  const fallback =
    (await prisma.depot.findFirst({ where: { archivedAt: null, code: { not: null } }, orderBy: { name: "asc" } })) ||
    (await prisma.depot.findFirst({ where: { archivedAt: null }, orderBy: { name: "asc" } }));
  if (!fallback) throw new Error("No hay depósitos ZDRY. Corre el seed.");
  return { depot: fallback, warehouse };
}

export async function backfillWarehouseAndDepots(prisma: PrismaService) {
  await ensureOperationalDepots(prisma);
  const cands = await prisma.odooLotCandidate.findMany({
    where: { OR: [{ odooWarehouse: null }, { odooWarehouse: "" }] },
    select: { id: true, locationName: true },
  });
  for (const c of cands) {
    const w = warehouseFromLocation(c.locationName);
    if (w) await prisma.odooLotCandidate.update({ where: { id: c.id }, data: { odooWarehouse: w } });
  }
  const units = await prisma.container.findMany({
    where: { odooLocation: { not: null } },
    select: { iso: true, odooLocation: true, odooWarehouse: true, depotId: true, depot: { select: { code: true, name: true } } },
  });
  const piura = await depotByCode(prisma, "piura");
  const pending = await depotByCode(prisma, "callao_pendiente");
  for (const u of units) {
    const w = u.odooWarehouse || warehouseFromLocation(u.odooLocation);
    const data: { odooWarehouse?: string; depotId?: string } = {};
    if (w && w !== u.odooWarehouse) data.odooWarehouse = w;
    const depotName = (u.depot?.name || "").toLowerCase();
    const isGeneric = !u.depot?.code || depotName.includes("existencia") || depotName === "patio callao";
    if (w === "PIURA" && piura && u.depotId !== piura.id && isGeneric) data.depotId = piura.id;
    if (w === "ZGROU" && pending && isGeneric && u.depotId !== pending.id) data.depotId = pending.id;
    if (Object.keys(data).length) await prisma.container.update({ where: { iso: u.iso }, data });
  }
}
