import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../auth/auth.types";

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
}
