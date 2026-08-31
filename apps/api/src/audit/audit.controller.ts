import { Controller, Get } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

@Controller("audit")
@Roles("admin")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() _user: AuthUser) {
    const rows = await this.prisma.auditLog.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true, name: true, role: true } } },
    });
    return rows;
  }
}
