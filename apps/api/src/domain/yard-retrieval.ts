import { PrismaService } from "../prisma/prisma.service";
import { readMovementPolicy, retrievalReference, type MovementPolicy } from "./freight-stub";
import { asBayHalf, ghostsWithSupport, movesToReach, normalizeYardPlan } from "./yard-plan";

type YardRow = {
  iso: string;
  depotId: string;
  lado: string | null;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
};

export async function retrievalByIso(prisma: PrismaService, rows: YardRow[], policy?: MovementPolicy) {
  const active = policy || (await readMovementPolicy(prisma));
  const depotIds = [...new Set(rows.filter((row) => row.lado).map((row) => row.depotId))];
  const result = new Map<string, ReturnType<typeof retrievalReference>>();
  if (!depotIds.length) return { policy: active, byIso: result };
  const [settings, occupants] = await Promise.all([
    prisma.appSetting.findMany({ where: { key: { in: depotIds.map((id) => `yard_plan:${id}`) } } }),
    prisma.container.findMany({
      where: { depotId: { in: depotIds }, lado: { not: null }, archivedAt: null },
      select: { iso: true, depotId: true, lado: true, ruma: true, columna: true, nivel: true, type: true, bayHalf: true },
    }),
  ]);
  for (const depotId of depotIds) {
    const stored = normalizeYardPlan(settings.find((row) => row.key === `yard_plan:${depotId}`)?.value);
    const stacked = occupants
      .filter((item) => item.depotId === depotId && item.lado && item.ruma && item.columna && item.nivel)
      .map((item) => ({
        zoneName: item.lado || "",
        row: item.ruma || 0,
        col: item.columna || 0,
        level: item.nivel || 0,
        iso: item.iso,
        type: item.type,
        half: asBayHalf(item.bayHalf),
      }));
    const ghosts = ghostsWithSupport(stored.zones, stored.ghosts, stacked);
    for (const unit of stacked) {
      const moves = movesToReach(stored.zones, ghosts, stacked, unit.zoneName, unit.row, unit.col, unit.level, unit.iso, unit.half, unit.type).total;
      result.set(unit.iso, retrievalReference(moves, active));
    }
  }
  for (const row of rows) {
    if (row.lado === "PASILLO") result.set(row.iso, retrievalReference(0, active));
  }
  return { policy: active, byIso: result };
}
