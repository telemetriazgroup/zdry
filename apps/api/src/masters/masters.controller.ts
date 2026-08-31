import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { masterListWhere } from "../domain/masters";

@Controller("masters")
export class MastersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("types")
  types(@Query("includeArchived") includeArchived?: string) {
    return this.prisma.containerType.findMany({
      where: masterListWhere(includeArchived),
      orderBy: { code: "asc" },
    });
  }

  @Post("types")
  @Roles("admin")
  async createType(
    @Body() body: { code?: string; label?: string; dims?: string; color?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const code = (body.code || "").trim().toUpperCase();
    if (!code || !body.label) throw new BadRequestException("Código y etiqueta son obligatorios");
    const row = await this.prisma.containerType.create({
      data: { code, label: body.label, dims: body.dims || "—", color: body.color || "#1971c2" },
    });
    await this.audit.log({ user, action: "create", entity: "ContainerType", entityId: row.code, after: row as object, ip: req.ip });
    return row;
  }

  @Put("types/:code")
  @Roles("admin")
  async updateType(
    @Param("code") code: string,
    @Body() body: { label?: string; dims?: string; color?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.prisma.containerType.findUnique({ where: { code } });
    if (!before) throw new BadRequestException("Tipo no existe");
    const row = await this.prisma.containerType.update({
      where: { code },
      data: {
        label: body.label ?? before.label,
        dims: body.dims ?? before.dims,
        color: body.color ?? before.color,
      },
    });
    await this.audit.log({ user, action: "update", entity: "ContainerType", entityId: code, before: before as object, after: row as object, ip: req.ip });
    return row;
  }

  @Delete("types/:code")
  @Roles("admin")
  async archiveType(@Param("code") code: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.archive("containerType", code, user, req);
  }

  @Post("types/:code/restore")
  @Roles("admin")
  async restoreType(@Param("code") code: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.restore("containerType", code, user, req);
  }

  @Get("categories")
  categories(@Query("includeArchived") includeArchived?: string) {
    return this.prisma.category.findMany({
      where: masterListWhere(includeArchived),
      orderBy: { code: "asc" },
    });
  }

  @Post("categories")
  @Roles("admin")
  async createCategory(
    @Body() body: { code?: string; label?: string; color?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const code = (body.code || "").trim().toUpperCase();
    if (!code || !body.label) throw new BadRequestException("Código y etiqueta son obligatorios");
    const row = await this.prisma.category.create({
      data: { code, label: body.label, color: body.color || "#1971c2" },
    });
    await this.audit.log({ user, action: "create", entity: "Category", entityId: row.code, after: row as object, ip: req.ip });
    return row;
  }

  @Put("categories/:code")
  @Roles("admin")
  async updateCategory(
    @Param("code") code: string,
    @Body() body: { label?: string; color?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.prisma.category.findUnique({ where: { code } });
    if (!before) throw new BadRequestException("Condición no existe");
    const row = await this.prisma.category.update({
      where: { code },
      data: {
        label: body.label ?? before.label,
        color: body.color ?? before.color,
      },
    });
    await this.audit.log({ user, action: "update", entity: "Category", entityId: code, before: before as object, after: row as object, ip: req.ip });
    return row;
  }

  @Delete("categories/:code")
  @Roles("admin")
  async archiveCategory(@Param("code") code: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.archive("category", code, user, req);
  }

  @Post("categories/:code/restore")
  @Roles("admin")
  async restoreCategory(@Param("code") code: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.restore("category", code, user, req);
  }

  @Get("depots")
  depots(@Query("includeArchived") includeArchived?: string) {
    return this.prisma.depot.findMany({
      where: masterListWhere(includeArchived),
      orderBy: { name: "asc" },
    });
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
  async archiveDepot(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.archive("depot", id, user, req);
  }

  @Post("depots/:id/restore")
  @Roles("admin")
  async restoreDepot(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.restore("depot", id, user, req);
  }

  private async archive(kind: "depot" | "containerType" | "category", id: string, user: AuthUser, req: Request) {
    if (kind === "depot") {
      const row = await this.prisma.depot.findUnique({ where: { id } });
      if (!row) throw new BadRequestException("Depósito no existe");
      if (row.archivedAt) throw new BadRequestException("Ya está archivado.");
      const updated = await this.prisma.depot.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.log({ user, action: "archive", entity: "Depot", entityId: id, before: row as object, after: updated as object, ip: req.ip });
      return updated;
    }
    if (kind === "containerType") {
      const row = await this.prisma.containerType.findUnique({ where: { code: id } });
      if (!row) throw new BadRequestException("Tipo no existe");
      if (row.archivedAt) throw new BadRequestException("Ya está archivado.");
      const updated = await this.prisma.containerType.update({ where: { code: id }, data: { archivedAt: new Date() } });
      await this.audit.log({ user, action: "archive", entity: "ContainerType", entityId: id, before: row as object, after: updated as object, ip: req.ip });
      return updated;
    }
    const row = await this.prisma.category.findUnique({ where: { code: id } });
    if (!row) throw new BadRequestException("Condición no existe");
    if (row.archivedAt) throw new BadRequestException("Ya está archivada.");
    const updated = await this.prisma.category.update({ where: { code: id }, data: { archivedAt: new Date() } });
    await this.audit.log({ user, action: "archive", entity: "Category", entityId: id, before: row as object, after: updated as object, ip: req.ip });
    return updated;
  }

  private async restore(kind: "depot" | "containerType" | "category", id: string, user: AuthUser, req: Request) {
    if (kind === "depot") {
      const row = await this.prisma.depot.findUnique({ where: { id } });
      if (!row) throw new BadRequestException("Depósito no existe");
      const updated = await this.prisma.depot.update({ where: { id }, data: { archivedAt: null } });
      await this.audit.log({ user, action: "restore", entity: "Depot", entityId: id, before: row as object, after: updated as object, ip: req.ip });
      return updated;
    }
    if (kind === "containerType") {
      const row = await this.prisma.containerType.findUnique({ where: { code: id } });
      if (!row) throw new BadRequestException("Tipo no existe");
      const updated = await this.prisma.containerType.update({ where: { code: id }, data: { archivedAt: null } });
      await this.audit.log({ user, action: "restore", entity: "ContainerType", entityId: id, before: row as object, after: updated as object, ip: req.ip });
      return updated;
    }
    const row = await this.prisma.category.findUnique({ where: { code: id } });
    if (!row) throw new BadRequestException("Condición no existe");
    const updated = await this.prisma.category.update({ where: { code: id }, data: { archivedAt: null } });
    await this.audit.log({ user, action: "restore", entity: "Category", entityId: id, before: row as object, after: updated as object, ip: req.ip });
    return updated;
  }
}
