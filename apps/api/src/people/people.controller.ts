import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { RiskGrade, Role } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";

const STAFF_ROLES: Role[] = ["admin", "gerente", "vendedor", "compras", "coordinador", "almacen"];

function assertStaffRole(role: Role) {
  if (role === "superadmin") throw new BadRequestException("El rol superadmin no se asigna desde Personas.");
  if (!STAFF_ROLES.includes(role)) throw new BadRequestException("Rol no permitido para colaboradores.");
}

function publicUser<T extends { passwordHash?: string; refreshTokenHash?: string | null }>(row: T) {
  const { passwordHash: _h, refreshTokenHash: _r, ...safe } = row;
  return safe;
}

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
      where: { ...(await this.prisma.hideDemo()), role: { not: "superadmin" } },
      orderBy: { name: "asc" },
    });
    return rows.map((u) => publicUser(u));
  }

  @Post("collaborators")
  async createCollaborator(
    @Body() body: { email?: string; name?: string; role?: Role; password?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!body.email || !body.name || !body.role) throw new BadRequestException("Email, nombre y rol son obligatorios");
    assertStaffRole(body.role);
    const email = body.email.trim().toLowerCase();
    const clash = await this.prisma.user.findUnique({ where: { email } });
    if (clash) throw new ConflictException("Ya existe una cuenta con ese correo.");
    const password = body.password || process.env.SEED_PASSWORD || "Zdry123!";
    const row = await this.prisma.user.create({
      data: {
        email,
        name: body.name.trim(),
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
    return publicUser(row);
  }

  @Put("collaborators/:id")
  async updateCollaborator(
    @Param("id") id: string,
    @Body() body: { email?: string; name?: string; role?: Role; active?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new BadRequestException("Usuario no encontrado.");
    if (before.role === "superadmin") throw new BadRequestException("No se puede editar el superadmin aquí.");

    const name = (body.name ?? before.name).trim();
    const email = (body.email ?? before.email).trim().toLowerCase();
    const role = body.role ?? before.role;
    const active = body.active ?? before.active;
    if (!name) throw new BadRequestException("El nombre es obligatorio.");
    if (!email) throw new BadRequestException("El email es obligatorio.");
    assertStaffRole(role);

    if (id === user.id) {
      if (!active) throw new BadRequestException("No puedes desactivar tu propia cuenta.");
      if (before.role === "admin" && role !== "admin") {
        throw new BadRequestException("No puedes quitarte el rol de administrador.");
      }
    }

    const losingAdmin = before.role === "admin" && before.active && (role !== "admin" || !active);
    if (losingAdmin) {
      const otherAdmins = await this.prisma.user.count({
        where: { role: "admin", active: true, id: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException("Debe quedar al menos un administrador activo.");
      }
    }

    if (email !== before.email) {
      const clash = await this.prisma.user.findUnique({ where: { email } });
      if (clash) throw new ConflictException("Ya existe una cuenta con ese correo.");
    }

    const row = await this.prisma.user.update({
      where: { id },
      data: { name, email, role, active },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "User",
      entityId: id,
      before: { email: before.email, role: before.role, name: before.name, active: before.active },
      after: { email: row.email, role: row.role, name: row.name, active: row.active },
      ip: req.ip,
    });
    return publicUser(row);
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
    if (row.role === "superadmin") throw new BadRequestException("No se puede restablecer la clave del superadmin aquí.");
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await argon2.hash(password) } });
    await this.audit.log({ user, action: "reset_password", entity: "User", entityId: id, ip: req.ip });
    return { ok: true };
  }
}
