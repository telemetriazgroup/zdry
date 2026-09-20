import { PrismaService } from "../prisma/prisma.service";
import {
  assimilateLogCsv,
  dayEnd,
  dayStart,
  errorDetail,
  isStaleRunning,
  presentAssimilateRun,
  type AssimilateLogDraft,
} from "../domain/odoo-assimilate-log";
import type { Prisma } from "@prisma/client";

export class AssimilateLogStore {
  constructor(private readonly prisma: PrismaService) {}

  async start(kind: string, startedBy?: string | null) {
    const stale = await this.prisma.odooAssimilateRun.findMany({
      where: { status: "running" },
      orderBy: { startedAt: "desc" },
      take: 5,
    });
    for (const row of stale) {
      if (isStaleRunning(row.startedAt)) {
        await this.prisma.odooAssimilateRun.update({
          where: { id: row.id },
          data: { status: "error", endedAt: new Date(), message: "Pasada interrumpida (quedó colgada)." },
        });
      }
    }
    return this.prisma.odooAssimilateRun.create({
      data: { kind, startedBy: startedBy || null, status: "running" },
    });
  }

  async currentRunning() {
    const row = await this.prisma.odooAssimilateRun.findFirst({
      where: { status: "running" },
      orderBy: { startedAt: "desc" },
    });
    if (!row) return null;
    if (isStaleRunning(row.startedAt)) {
      await this.prisma.odooAssimilateRun.update({
        where: { id: row.id },
        data: { status: "error", endedAt: new Date(), message: "Pasada interrumpida (quedó colgada)." },
      });
      return null;
    }
    return row;
  }

  async add(runId: string | null | undefined, draft: AssimilateLogDraft) {
    if (!runId) return null;
    const row = await this.prisma.odooAssimilateLog.create({
      data: {
        runId,
        level: draft.level,
        step: draft.step,
        iso: draft.iso || "",
        serialRaw: draft.serialRaw || "",
        odooLotId: draft.odooLotId ?? null,
        product: (draft.product || "").slice(0, 240),
        message: (draft.message || "").slice(0, 800),
        detail: (draft.detail || "").slice(0, 8000),
      },
    });
    const field = draft.level === "error" ? "errorCount" : draft.level === "warn" ? "skipCount" : draft.level === "ok" ? "okCount" : null;
    if (field) {
      await this.prisma.odooAssimilateRun.update({
        where: { id: runId },
        data: { [field]: { increment: 1 } },
      });
    }
    return row;
  }

  async fail(runId: string | null | undefined, err: unknown, step = "error") {
    const { message, detail } = errorDetail(err);
    await this.add(runId, { level: "error", step, message, detail });
    if (runId) {
      await this.prisma.odooAssimilateRun.update({
        where: { id: runId },
        data: { status: "error", endedAt: new Date(), message },
      });
    }
  }

  async finish(runId: string | null | undefined, message: string, status: "done" | "error" | "cancelled" = "done") {
    if (!runId) return;
    await this.prisma.odooAssimilateRun.update({
      where: { id: runId },
      data: { status, endedAt: new Date(), message },
    });
  }

  async cancelRunning(reason: string) {
    const rows = await this.prisma.odooAssimilateRun.findMany({ where: { status: "running" } });
    for (const row of rows) {
      await this.add(row.id, { level: "warn", step: "reset", message: reason });
      await this.finish(row.id, reason, "cancelled");
    }
    return rows.map((r) => r.id);
  }

  private entryWhere(opts: { runId?: string; level?: string; from?: string; to?: string; currentId?: string | null }): Prisma.OdooAssimilateLogWhereInput {
    const from = dayStart(opts.from);
    const to = dayEnd(opts.to);
    const ranged = Boolean(from || to);
    return {
      ...(opts.level && opts.level !== "all" ? { level: opts.level } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(!ranged && (opts.runId || opts.currentId) ? { runId: opts.runId || opts.currentId || undefined } : {}),
    };
  }

  async present(opts: { runId?: string; level?: string; take?: number; from?: string; to?: string } = {}) {
    const take = Math.min(Math.max(Number(opts.take) || 5, 5), 800);
    const runs = await this.prisma.odooAssimilateRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 });
    const current = opts.runId ? runs.find((r) => r.id === opts.runId) || (await this.prisma.odooAssimilateRun.findUnique({ where: { id: opts.runId } })) : runs[0] || null;
    const where = this.entryWhere({ ...opts, currentId: current?.id });
    const [entries, total] = await Promise.all([
      this.prisma.odooAssimilateLog.findMany({ where, orderBy: [{ createdAt: "desc" }], take }),
      this.prisma.odooAssimilateLog.count({ where }),
    ]);
    return {
      runs: runs.map(presentAssimilateRun),
      current: current ? presentAssimilateRun(current) : null,
      from: opts.from || "",
      to: opts.to || "",
      total,
      take,
      entries: entries.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        level: e.level,
        step: e.step,
        iso: e.iso,
        serialRaw: e.serialRaw,
        odooLotId: e.odooLotId,
        product: e.product,
        message: e.message,
        detail: e.detail,
      })),
    };
  }

  async exportCsv(opts: { runId?: string; level?: string; from?: string; to?: string } = {}) {
    const runs = await this.prisma.odooAssimilateRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 });
    const current = opts.runId ? await this.prisma.odooAssimilateRun.findUnique({ where: { id: opts.runId } }) : runs[0] || null;
    const where = this.entryWhere({ ...opts, currentId: current?.id });
    const entries = await this.prisma.odooAssimilateLog.findMany({
      where,
      orderBy: [{ createdAt: "asc" }],
      take: 5000,
    });
    const csv = assimilateLogCsv(
      entries.map((e) => ({
        createdAt: e.createdAt.toISOString(),
        level: e.level,
        step: e.step,
        iso: e.iso,
        serialRaw: e.serialRaw,
        odooLotId: e.odooLotId,
        product: e.product,
        message: e.message,
        detail: e.detail,
      })),
    );
    const from = opts.from || "inicio";
    const to = opts.to || "hoy";
    return { csv, filename: `diario-asimilacion-${from}_${to}.csv`, count: entries.length };
  }
}
