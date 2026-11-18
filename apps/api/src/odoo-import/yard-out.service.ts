import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  FENCE_SIDE,
  compactStack,
  fenceDepthOf,
  fenceSideIndex,
  normalizeYardPlan,
  type StackSeat,
  type YardGhost,
  type YardPlan,
} from "../domain/yard-plan";
import { yardOutMoves } from "../domain/yard-out-history";

const AISLE = "PASILLO";
const YARD_OUT_CHECK_MS = 10 * 60 * 1000;
const SWEEP_LIMIT = 400;

type SweepResult = { found: number; cleared: number; moved: number; failed: number; busy?: boolean };

type SeatRow = { iso: string; nivel: number | null; bayHalf: string | null; type: string };

/**
 * Cuando Odoo registra un OUT, el patio no espera el despacho manual.
 * Guarda cómo estaba la columna y baja los que quedaron encima.
 */
@Injectable()
export class YardOutService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(YardOutService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, YARD_OUT_CHECK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Cada 10 minutos, con los OUT que ZDRY ya tiene. No consulta Odoo. */
  private async tick() {
    try {
      const result = await this.settleDepartedSeats();
      if (result.cleared || result.failed) {
        this.log.log(`patios: ${result.cleared} salidas, ${result.moved} bajaron, ${result.failed} pendientes`);
      }
    } catch (error) {
      this.log.warn(`patios: ${(error as Error).message}`);
    }
  }

  /** Equipos con OUT anotado que siguen ocupando un puesto. Baja la columna.
   * Una pasada deja un solo historial por depósito, con el patio de antes. */
  async settleDepartedSeats(source: "manual" | "periodico" = "periodico"): Promise<SweepResult> {
    if (this.busy) return { found: 0, cleared: 0, moved: 0, failed: 0, busy: true };
    this.busy = true;
    try {
      const rows = await this.prisma.container.findMany({
        where: {
          demo: false,
          archivedAt: null,
          lado: { not: null },
          OR: [
            { gateOut: true },
            { status: "Vendido", commercialStatus: "vendido" },
          ],
        },
        select: { iso: true, depotId: true },
        orderBy: [{ depotId: "asc" }, { lado: "asc" }, { ruma: "asc" }, { columna: "asc" }, { nivel: "asc" }],
        take: SWEEP_LIMIT,
      });
      const groups = new Map<string, string[]>();
      for (const row of rows) {
        const list = groups.get(row.depotId) || [];
        list.push(row.iso);
        groups.set(row.depotId, list);
      }
      let cleared = 0;
      let moved = 0;
      let failed = 0;
      for (const [depotId, isos] of groups) {
        const before = await this.captureDepot(depotId);
        for (const iso of isos) {
          try {
            const result = await this.collapseAfterOut(iso, "registrado en ZDRY", { record: false });
            if (result.cleared) cleared += 1;
            moved += result.moved;
          } catch (error) {
            failed += 1;
            this.log.warn(`${iso}: ${(error as Error).message}`);
          }
        }
        await this.remember(depotId, source, before);
      }
      return { found: rows.length, cleared, moved, failed };
    } finally {
      this.busy = false;
    }
  }

  async listUpdates(depotId: string) {
    const updates = await this.prisma.yardOutUpdate.findMany({
      where: { depotId },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, source: true, leftCount: true, dropCount: true, moves: true, createdAt: true },
    });
    return { updates };
  }

  async readUpdate(depotId: string, id: string) {
    return this.prisma.yardOutUpdate.findFirst({ where: { id, depotId } });
  }

  async collapseAfterOut(iso: string, picking: string, options?: { record?: boolean }) {
    const code = String(iso || "").trim().toUpperCase();
    if (!code) return { moved: 0, cleared: false };
    const unit = await this.prisma.container.findUnique({ where: { iso: code } });
    if (!unit || unit.demo || !unit.lado) return { moved: 0, cleared: false };
    const record = options?.record !== false;
    const before = record ? await this.captureDepot(unit.depotId) : null;
    const result = unit.lado === AISLE
      ? await this.clearAisle(unit.iso, unit.depotId, picking)
      : await this.collapseStacked(unit, picking);
    if (before && result.cleared) await this.remember(unit.depotId, "odoo", before);
    return result;
  }

  private async clearAisle(iso: string, depotId: string, picking: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.clearSeat(tx, iso, depotId);
      await tx.containerHistory.create({
        data: {
          iso,
          type: "Salida Odoo",
          detail: `OUT ${picking || "OUT"}, sin usar despacho. Estaba en el pasillo y salió del patio.`,
        },
      });
    });
    return { moved: 0, cleared: true };
  }

  private async collapseStacked(
    unit: { iso: string; depotId: string; lado: string | null; ruma: number | null; columna: number | null; nivel: number | null },
    picking: string,
  ) {
    const note = picking || "OUT";
    return this.prisma.$transaction(async (tx) => {
      const plan = await this.readPlan(tx, unit.depotId);
      if (unit.lado === FENCE_SIDE) return this.collapseFence(tx, unit, plan, note);
      return this.collapseZone(tx, unit, plan, note);
    });
  }

  private async captureDepot(depotId: string) {
    const seats = await this.prisma.container.findMany({
      where: { depotId, archivedAt: null, demo: false, lado: { not: null } },
      select: { iso: true, type: true, lado: true, ruma: true, columna: true, nivel: true, bayHalf: true, status: true },
    });
    const row = await this.prisma.appSetting.findUnique({ where: { key: `yard_plan:${depotId}` } });
    return { seats, plan: normalizeYardPlan(row?.value) };
  }

  private async remember(depotId: string, source: string, before: { seats: Array<{ iso: string; lado: string | null; ruma: number | null; columna: number | null; nivel: number | null; bayHalf: string | null }>; plan: YardPlan }) {
    try {
      const after = await this.captureDepot(depotId);
      const moves = yardOutMoves(before.seats, after.seats);
      if (!moves.length) return;
      await this.prisma.yardOutUpdate.create({
        data: {
          depotId,
          source,
          leftCount: moves.filter((move) => move.kind === "salida").length,
          dropCount: moves.filter((move) => move.kind === "baja").length,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
          moves: moves as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.log.warn(`historial ${depotId}: ${(error as Error).message}`);
    }
  }

  private async readPlan(tx: Prisma.TransactionClient, depotId: string): Promise<YardPlan> {
    const row = await tx.appSetting.findUnique({ where: { key: `yard_plan:${depotId}` } });
    return normalizeYardPlan(row?.value);
  }

  private async savePlan(tx: Prisma.TransactionClient, depotId: string, plan: YardPlan) {
    await tx.appSetting.upsert({
      where: { key: `yard_plan:${depotId}` },
      update: { value: plan },
      create: { key: `yard_plan:${depotId}`, value: plan },
    });
  }

  private async collapseZone(
    tx: Prisma.TransactionClient,
    unit: { iso: string; depotId: string; lado: string | null; ruma: number | null; columna: number | null; nivel: number | null },
    plan: YardPlan,
    picking: string,
  ) {
    if (!unit.lado || !unit.ruma || !unit.columna || !unit.nivel) {
      await this.clearSeat(tx, unit.iso, unit.depotId);
      return { moved: 0, cleared: true };
    }
    const mates = await tx.container.findMany({
      where: {
        depotId: unit.depotId,
        lado: unit.lado,
        ruma: unit.ruma,
        columna: unit.columna,
        archivedAt: null,
        nivel: { not: null },
      },
      select: { iso: true, nivel: true, bayHalf: true, type: true },
    });
    const zone = plan.zones.find((item) => item.name === unit.lado);
    const ghosts = zone
      ? plan.ghosts.filter((ghost) => ghost.zoneId === zone.id && ghost.row === unit.ruma && ghost.col === unit.columna)
      : [];
    const seats: StackSeat[] = [
      ...mates.map((mate) => ({ id: `c:${mate.iso}`, level: mate.nivel || 0 })),
      ...ghosts.map((ghost, index) => ({ id: `g:${index}`, level: ghost.level })),
    ];
    const shifts = compactStack(seats, [`c:${unit.iso}`]);
    const before = columnText(mates, ghosts);
    await this.clearSeat(tx, unit.iso, unit.depotId);
    const moved = await this.applyContainerDrops(tx, unit, mates, shifts, picking);
    const nextGhosts = ghosts.map((ghost, index) => {
      const shift = shifts.find((item) => item.id === `g:${index}`);
      return shift ? { ...ghost, level: shift.to } : ghost;
    });
    if (zone && ghostLevelsChanged(ghosts, nextGhosts)) {
      const rest = plan.ghosts.filter((ghost) => !(ghost.zoneId === zone.id && ghost.row === unit.ruma && ghost.col === unit.columna));
      await this.savePlan(tx, unit.depotId, { ...plan, ghosts: [...rest, ...nextGhosts] });
    }
    const afterMates = mates
      .filter((mate) => mate.iso !== unit.iso)
      .map((mate) => {
        const shift = shifts.find((item) => item.id === `c:${mate.iso}`);
        return { ...mate, nivel: shift?.to ?? mate.nivel };
      });
    const afterGhosts = nextGhosts;
    await tx.containerHistory.create({
      data: {
        iso: unit.iso,
        type: "Salida Odoo",
        detail: patioDetail(unit.lado, unit.ruma, unit.columna, unit.iso, picking, before, columnText(afterMates, afterGhosts)),
      },
    });
    return { moved, cleared: true };
  }

  private async collapseFence(
    tx: Prisma.TransactionClient,
    unit: { iso: string; depotId: string; lado: string | null; ruma: number | null; columna: number | null; nivel: number | null },
    plan: YardPlan,
    picking: string,
  ) {
    if (!unit.ruma || !unit.columna || !unit.nivel) {
      await this.clearSeat(tx, unit.iso, unit.depotId);
      return { moved: 0, cleared: true };
    }
    const side = plan.perimeter.sides[fenceSideIndex(unit.ruma)];
    const depth = fenceDepthOf(unit.ruma);
    const mates = await tx.container.findMany({
      where: {
        depotId: unit.depotId,
        lado: FENCE_SIDE,
        ruma: unit.ruma,
        columna: unit.columna,
        archivedAt: null,
        nivel: { not: null },
      },
      select: { iso: true, nivel: true, bayHalf: true, type: true },
    });
    const cells = side
      ? plan.perimeter.cells.filter((cell) => cell.sideId === side.id && cell.slot === unit.columna && (cell.row || 1) === depth)
      : [];
    const unknown = cells.filter((cell) => cell.unknown || cell.iso === "DESCONOCIDO" || !mates.some((mate) => mate.iso === cell.iso));
    const seats: StackSeat[] = [
      ...mates.map((mate) => ({ id: `c:${mate.iso}`, level: mate.nivel || 0 })),
      ...unknown.map((cell, index) => ({ id: `f:${index}`, level: cell.level })),
    ];
    const shifts = compactStack(seats, [`c:${unit.iso}`]);
    const before = columnText(mates, unknown.map((cell) => ({ code: cell.iso || "DESCONOCIDO", level: cell.level })));
    await this.clearSeat(tx, unit.iso, unit.depotId);
    const moved = await this.applyContainerDrops(tx, unit, mates, shifts, picking);
    if (side) {
      const kept = cells.filter((cell) => cell.iso !== unit.iso);
      const nextCells = kept.map((cell) => {
        const mate = mates.find((item) => item.iso === cell.iso);
        if (mate) {
          const shift = shifts.find((item) => item.id === `c:${mate.iso}`);
          return shift ? { ...cell, level: shift.to } : cell;
        }
        const index = unknown.indexOf(cell);
        const shift = shifts.find((item) => item.id === `f:${index}`);
        return shift ? { ...cell, level: shift.to } : cell;
      });
      const rest = plan.perimeter.cells.filter((cell) => !(cell.sideId === side.id && cell.slot === unit.columna && (cell.row || 1) === depth));
      await this.savePlan(tx, unit.depotId, { ...plan, perimeter: { ...plan.perimeter, cells: [...rest, ...nextCells] } });
    }
    const afterMates = mates
      .filter((mate) => mate.iso !== unit.iso)
      .map((mate) => {
        const shift = shifts.find((item) => item.id === `c:${mate.iso}`);
        return { ...mate, nivel: shift?.to ?? mate.nivel };
      });
    await tx.containerHistory.create({
      data: {
        iso: unit.iso,
        type: "Salida Odoo",
        detail: patioDetail("Cerco", unit.ruma, unit.columna, unit.iso, picking, before, columnText(afterMates, [])),
      },
    });
    return { moved, cleared: true };
  }

  private async applyContainerDrops(
    tx: Prisma.TransactionClient,
    unit: { iso: string; depotId: string; lado: string | null; ruma: number | null; columna: number | null },
    mates: SeatRow[],
    shifts: Array<{ id: string; from: number; to: number }>,
    picking: string,
  ) {
    const drops = shifts.filter((shift) => shift.id.startsWith("c:") && shift.from !== shift.to);
    let moved = 0;
    for (const shift of drops) {
      const mateIso = shift.id.slice(2);
      const mate = mates.find((item) => item.iso === mateIso);
      if (!mate || !unit.lado || !unit.ruma || !unit.columna) continue;
      await tx.containerPosition.updateMany({
        where: { iso: mateIso, closedAt: null },
        data: { closedAt: new Date() },
      });
      await tx.container.update({
        where: { iso: mateIso },
        data: { nivel: shift.to },
      });
      await tx.containerPosition.create({
        data: { iso: mateIso, depotId: unit.depotId, lado: unit.lado, ruma: unit.ruma, columna: unit.columna, nivel: shift.to },
      });
      await tx.containerHistory.create({
        data: {
          iso: mateIso,
          type: "Movimiento",
          detail: `Bajó del nivel ${shift.from} al ${shift.to} porque ${unit.iso} salió por OUT ${picking}. El patio quedó con la columna actualizada.`,
        },
      });
      moved += 1;
    }
    return moved;
  }

  private async clearSeat(tx: Prisma.TransactionClient, iso: string, depotId: string) {
    await tx.containerPosition.updateMany({
      where: { iso, closedAt: null },
      data: { closedAt: new Date() },
    });
    await tx.container.update({
      where: { iso },
      data: { lado: null, ruma: null, columna: null, nivel: null, bayHalf: null },
    });
    void depotId;
  }
}

function columnText(mates: Array<{ iso?: string; nivel: number | null; type?: string }>, ghosts: Array<{ code?: string; level: number }>) {
  const lines = [
    ...mates.map((mate) => ({ level: mate.nivel || 0, name: mate.iso || "—" })),
    ...ghosts.map((ghost) => ({ level: ghost.level, name: ghost.code || "DESCONOCIDO" })),
  ].filter((line) => line.level >= 1);
  lines.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  if (!lines.length) return "vacía";
  return lines.map((line) => `n${line.level} ${line.name}`).join(", ");
}

function ghostLevelsChanged(before: YardGhost[], after: YardGhost[]) {
  return before.some((ghost, index) => ghost.level !== after[index]?.level);
}

function patioDetail(lado: string, ruma: number, columna: number, iso: string, picking: string, before: string, after: string) {
  return `OUT ${picking}, sin usar despacho. Patio antes en ${lado} fila ${ruma} columna ${columna}: ${before}. Patio ahora, sin ${iso}: ${after}.`;
}
