import { BadRequestException, Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { RiskGrade, Role } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";

@Controller("people")
@Roles("admin")
export class PeopleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("customers")
  async customers() {
    return this.prisma.customer.findMany({ where: await this.prisma.hideDemo(), orderBy: { companyName: "asc" } });
  }

  @Post("customers")
  async createCustomer(
    @Body() body: { rucDni?: string; companyName?: string; email?: string; phone?: string; risk?: RiskGrade },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!body.rucDni || !body.companyName) throw new BadRequestException("RUC/DNI y empresa son obligatorios");
    const row = await this.prisma.customer.create({
      data: {
        rucDni: body.rucDni,
        companyName: body.companyName,
        email: body.email || "",
        phone: body.phone || "",
        risk: body.risk || "B",
      },
    });
    await this.audit.log({ user, action: "create", entity: "Customer", entityId: row.id, after: row as object, ip: req.ip });
    return row;
  }

  @Put("customers/:id")
  async updateCustomer(
    @Param("id") id: string,
    @Body() body: { rucDni?: string; companyName?: string; email?: string; phone?: string; risk?: RiskGrade },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.prisma.customer.findUnique({ where: { id } });
    if (!before) throw new BadRequestException("Cliente no existe");
    const row = await this.prisma.customer.update({
      where: { id },
      data: {
        rucDni: body.rucDni ?? before.rucDni,
        companyName: body.companyName ?? before.companyName,
        email: body.email ?? before.email,
        phone: body.phone ?? before.phone,
        risk: body.risk ?? before.risk,
      },
    });
    await this.audit.log({ user, action: "update", entity: "Customer", entityId: id, before: before as object, after: row as object, ip: req.ip });
    return row;
  }

  @Get("providers")
  providers() {
    return this.prisma.provider.findMany({ orderBy: { name: "asc" } });
  }

  @Post("providers")
  async createProvider(
    @Body() body: { name?: string; type?: string; rate?: number; unit?: string; email?: string; phone?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!body.name || !body.type) throw new BadRequestException("Nombre y tipo son obligatorios");
    const row = await this.prisma.provider.create({
      data: {
        name: body.name,
        type: body.type,
        rate: body.rate ?? 0,
        unit: body.unit || "unidad",
        email: body.email,
        phone: body.phone,
      },
    });
    await this.audit.log({ user, action: "create", entity: "Provider", entityId: row.id, after: row as object, ip: req.ip });
    return row;
  }

  @Get("collaborators")
  async collaborators() {
    const rows = await this.prisma.user.findMany({
      where: await this.prisma.hideDemo(),
      orderBy: { name: "asc" },
    });
    return rows.map(({ passwordHash, refreshTokenHash, ...u }) => u);
  }

  @Post("collaborators")
  async createCollaborator(
    @Body() body: { email?: string; name?: string; role?: Role; password?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!body.email || !body.name || !body.role) throw new BadRequestException("Email, nombre y rol son obligatorios");
    const password = body.password || process.env.SEED_PASSWORD || "Zdry123!";
    const row = await this.prisma.user.create({
      data: {
        email: body.email.trim().toLowerCase(),
        name: body.name,
        role: body.role,
        passwordHash: await argon2.hash(password),
      },
    });
    await this.audit.log({
      user,
      action: "create",
      entity: "User",
      entityId: row.id,
      after: { email: row.email, role: row.role, name: row.name },
      ip: req.ip,
    });
    const { passwordHash: _, refreshTokenHash: __, ...safe } = row;
    return safe;
  }

  @Post("collaborators/:id/password")
  async resetPassword(
    @Param("id") id: string,
    @Body() body: { password?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const password = body.password || "";
    if (password.length < 8) throw new BadRequestException("La clave debe tener al menos 8 caracteres.");
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row) throw new BadRequestException("Usuario no encontrado.");
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await argon2.hash(password) } });
    await this.audit.log({ user, action: "reset_password", entity: "User", entityId: id, ip: req.ip });
    return { ok: true };
  }
}
