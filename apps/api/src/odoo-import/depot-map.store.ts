import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  defaultPatioCode,
  OPERATIONAL_PATIOS,
  planWarehouseMove,
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

export async function applyWarehouseMove(prisma: PrismaService, iso: string, locationName: string) {
  const row = await prisma.container.findUnique({
    where: { iso },
    select: {
      iso: true,
      odooWarehouse: true,
      odooLocation: true,
      depotId: true,
      depot: { select: { code: true, name: true } },
    },
  });
  const from = String(row?.odooWarehouse || "").toUpperCase();
  if (!row) return { warehouseChanged: false, from: "", to: "", warehouse: "", locationUpdated: false };
  const plan = planWarehouseMove({ locationName, odooWarehouse: row.odooWarehouse });
  const locationUpdated = String(row.odooLocation || "") !== String(locationName || "");
  const data: Prisma.ContainerUpdateInput = {};
  if (locationUpdated && locationName) data.odooLocation = locationName;
  if (plan.warehouse && plan.warehouse !== from) data.odooWarehouse = plan.warehouse;
  let depotName = row.depot?.name || "";
  if (plan.depotCode && plan.depotCode !== row.depot?.code) {
    await ensureOperationalDepots(prisma);
    const depot = await depotByCode(prisma, plan.depotCode);
    if (depot && depot.id !== row.depotId) {
      data.depot = { connect: { id: depot.id } };
      data.lado = null;
      data.ruma = null;
      data.columna = null;
      data.nivel = null;
      depotName = depot.name;
    }
  }
  if (Object.keys(data).length) await prisma.container.update({ where: { iso }, data });
  if (plan.warehouseChanged) {
    await prisma.containerHistory.create({
      data: {
        iso,
        type: "Traslado Odoo",
        detail: `Plaza de costo ${from || "sin plaza"} → ${plan.warehouse} (${locationName}). Patio: ${depotName}. Los extras de almacén se recalculan con ${plan.warehouse}.`,
      },
    });
  }
  return {
    warehouseChanged: plan.warehouseChanged,
    from,
    to: plan.warehouse,
    warehouse: plan.warehouse,
    locationUpdated,
  };
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
