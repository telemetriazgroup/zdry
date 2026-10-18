import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../auth/auth.types";

const MAX_ROWS = 5000;

export function auditDateRange(from?: string | null, to?: string | null) {
  const ok = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const start = ok(from);
  const end = ok(to);
  return {
    from: start ? new Date(`${start}T00:00:00-05:00`) : null,
    to: end ? new Date(`${end}T23:59:59.999-05:00`) : null,
    fromDay: start,
    toDay: end,
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    user?: AuthUser | null;
    action: string;
    entity: string;
    entityId?: string | null;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    ip?: string | null;
  }) {
    await this.prisma.auditLog.create({
      data: {
        userId: input.user?.impersonator?.id ?? input.user?.id ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        ip: input.ip ?? null,
        ...(input.before !== undefined ? { before: input.before } : {}),
        ...(input.after !== undefined
          ? {
              after: input.user?.impersonator
                ? ({
                    ...(typeof input.after === "object" && input.after && !Array.isArray(input.after) ? input.after : { value: input.after }),
                    _as: { id: input.user.id, email: input.user.email, name: input.user.name, role: input.user.role },
                  } as Prisma.InputJsonValue)
                : input.after,
            }
          : {}),
      },
    });
  }

  async list(from?: string, to?: string, take = 2000, viewer?: Pick<AuthUser, "role"> | null) {
    const range = auditDateRange(from, to);
    const where: Prisma.AuditLogWhereInput = {};
    if (viewer?.role === "admin") {
      where.NOT = { user: { role: "superadmin" } };
    }
    if (range.from || range.to) {
      where.createdAt = {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      };
    }
    const limit = Math.min(MAX_ROWS, Math.max(1, Number(take) || 2000));
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true, name: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      from: range.fromDay,
      to: range.toDay,
      total,
      truncated: total > rows.length,
      rows,
      hidesSuperadmin: viewer?.role === "admin",
    };
  }

  async commercialActivity() {
    const vendors = await this.prisma.user.findMany({
      where: { role: "vendedor", active: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    const ids = vendors.map((row) => row.id);
    if (!ids.length) return { vendors: [], topUnits: [] };
    const [loginGroups, shares, events] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ["userId"],
        where: { action: "login", userId: { in: ids } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.catalogShare.findMany({
        where: { vendorId: { in: ids } },
        select: { id: true, vendorId: true, clientName: true, clientCompany: true, archivedAt: true },
      }),
      this.prisma.catalogShareEvent.findMany({
        where: { kind: { in: ["open", "view_unit"] }, share: { vendorId: { in: ids } } },
        select: { kind: true, iso: true, shareId: true, share: { select: { vendorId: true } } },
      }),
    ]);
    const logins = new Map(loginGroups.map((row) => [row.userId, { count: row._count._all, last: row._max.createdAt }]));
    const top = new Map<string, number>();
    const rows = vendors.map((vendor) => {
      const ownShares = shares.filter((share) => share.vendorId === vendor.id);
      const shareIds = new Set(ownShares.map((share) => share.id));
      const ownEvents = events.filter((event) => shareIds.has(event.shareId));
      const opened = new Set(ownEvents.filter((event) => event.kind === "open").map((event) => event.shareId));
      const units = new Map<string, number>();
      for (const event of ownEvents) {
        if (event.kind !== "view_unit" || !event.iso) continue;
        units.set(event.iso, (units.get(event.iso) || 0) + 1);
        top.set(event.iso, (top.get(event.iso) || 0) + 1);
      }
      const access = logins.get(vendor.id);
      return {
        id: vendor.id,
        name: vendor.name,
        email: vendor.email,
        logins: access?.count || 0,
        lastLogin: access?.last || null,
        clients: ownShares.length,
        activeClients: ownShares.filter((share) => !share.archivedAt).length,
        clientsViewed: opened.size,
        topUnits: [...units.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([iso, views]) => ({ iso, views })),
      };
    });
    return {
      vendors: rows,
      topUnits: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([iso, views]) => ({ iso, views })),
    };
  }
}
