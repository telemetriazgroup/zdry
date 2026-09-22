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

  async list(from?: string, to?: string, take = 2000) {
    const range = auditDateRange(from, to);
    const where: Prisma.AuditLogWhereInput = {};
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
    };
  }
}
