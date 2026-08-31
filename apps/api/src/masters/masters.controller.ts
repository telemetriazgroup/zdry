import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";

@Controller("masters")
export class MastersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("types")
  types() {
    return this.prisma.containerType.findMany({ orderBy: { code: "asc" } });
  }

  @Post("types")
  @Roles("admin")
  async createType(@Body() body: { code?: string; label?: string; dims?: string; color?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const code = (body.code || "").trim().toUpperCase();
    if (!code || !body.label) throw new BadRequestException("Código y etiqueta son obligatorios");
    const row = await this.prisma.containerType.create({
      data: { code, label: body.label, dims: body.dims || "—", color: body.color || "#1971c2" },
    });
    await this.audit.log({ user, action: "create", entity: "ContainerType", entityId: row.code, after: row as object, ip: req.ip });
    return row;
  }

  @Delete("types/:code")
  @Roles("admin")
  async deleteType(@Param("code") code: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const row = await this.prisma.containerType.findUnique({ where: { code } });
    if (!row) throw new BadRequestException("Tipo no existe");
    const inUse = await this.prisma.container.count({ where: { type: code } });
    if (row.protected || inUse) throw new BadRequestException("No se puede eliminar un tipo de catálogo en uso / protegido");
    await this.prisma.containerType.delete({ where: { code } });
    await this.audit.log({ user, action: "delete", entity: "ContainerType", entityId: code, before: row as object, ip: req.ip });
    return { ok: true };
  }

  @Get("categories")
  categories() {
    return this.prisma.category.findMany({ orderBy: { code: "asc" } });
  }

  @Post("categories")
  @Roles("admin")
  async createCategory(@Body() body: { code?: string; label?: string; color?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const code = (body.code || "").trim().toUpperCase();
    if (!code || !body.label) throw new BadRequestException("Código y etiqueta son obligatorios");
    const row = await this.prisma.category.create({
      data: { code, label: body.label, color: body.color || "#1971c2" },
    });
    await this.audit.log({ user, action: "create", entity: "Category", entityId: row.code, after: row as object, ip: req.ip });
    return row;
  }

  @Delete("categories/:code")
  @Roles("admin")
  async deleteCategory(@Param("code") code: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const row = await this.prisma.category.findUnique({ where: { code } });
    if (!row) throw new BadRequestException("Categoría no existe");
    const inUse = await this.prisma.container.count({ where: { cat: code } });
    if (row.protected || inUse) throw new BadRequestException("No se puede eliminar una condición protegida");
    await this.prisma.category.delete({ where: { code } });
    await this.audit.log({ user, action: "delete", entity: "Category", entityId: code, before: row as object, ip: req.ip });
    return { ok: true };
  }

  @Get("depots")
  depots() {
    return this.prisma.depot.findMany({ orderBy: { name: "asc" } });
  }

  @Post("depots")
  @Roles("admin")
  async createDepot(
    @Body() body: { name?: string; city?: string; address?: string; dailyRateTeu?: number; lat?: number; lng?: number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!body.name || !body.city || !body.address) throw new BadRequestException("Nombre, ciudad y dirección son obligatorios");
    const row = await this.prisma.depot.create({
      data: {
        name: body.name,
        city: body.city,
        address: body.address,
        dailyRateTeu: body.dailyRateTeu ?? 1,
        lat: body.lat,
        lng: body.lng,
      },
    });
    await this.audit.log({ user, action: "create", entity: "Depot", entityId: row.id, after: row as object, ip: req.ip });
    return row;
  }

  @Put("depots/:id")
  @Roles("admin")
  async updateDepot(
    @Param("id") id: string,
    @Body() body: { name?: string; city?: string; address?: string; dailyRateTeu?: number; lat?: number; lng?: number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.prisma.depot.findUnique({ where: { id } });
    if (!before) throw new BadRequestException("Depósito no existe");
    const row = await this.prisma.depot.update({
      where: { id },
      data: {
        name: body.name ?? before.name,
        city: body.city ?? before.city,
        address: body.address ?? before.address,
        dailyRateTeu: body.dailyRateTeu ?? before.dailyRateTeu,
        lat: body.lat ?? before.lat,
        lng: body.lng ?? before.lng,
      },
    });
    await this.audit.log({ user, action: "update", entity: "Depot", entityId: id, before: before as object, after: row as object, ip: req.ip });
    return row;
  }

  @Delete("depots/:id")
  @Roles("admin")
  async deleteDepot(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const row = await this.prisma.depot.findUnique({ where: { id } });
    if (!row) throw new BadRequestException("Depósito no existe");
    const inUse = await this.prisma.container.count({ where: { depotId: id } });
    if (row.protected || inUse) throw new BadRequestException("No se puede eliminar un depósito en uso / protegido");
    await this.prisma.depot.delete({ where: { id } });
    await this.audit.log({ user, action: "delete", entity: "Depot", entityId: id, before: row as object, ip: req.ip });
    return { ok: true };
  }
}
