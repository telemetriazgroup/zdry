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
import { Prisma } from "@prisma/client";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { masterListWhere } from "../domain/masters";
import { ACQUISITION_REFS_KEY, normalizeAcquisitionRefs, normalizeSafetyMarginRules, SAFETY_MARGIN_KEY } from "../domain/pricing";
import { parseTypeMerge, retargetTypeRows } from "../domain/type-merge";
import { refreshRulePrices } from "../odoo-import/acquisition-overlay.store";

@Controller("masters")
export class MastersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("types")
  async types(@Query("includeArchived") includeArchived?: string) {
    const [rows, grouped] = await Promise.all([
      this.prisma.containerType.findMany({
        where: masterListWhere(includeArchived),
        orderBy: { code: "asc" },
      }),
      this.prisma.container.groupBy({ by: ["type"], _count: { _all: true } }),
    ]);
    const counts = new Map(grouped.map((row) => [row.type, row._count._all]));
    return rows.map((row) => ({ ...row, unitCount: counts.get(row.code) || 0 }));
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

  @Post("types/merge")
  @Roles("admin")
  async mergeTypes(
    @Body() body: { keep?: string; absorb?: string | string[] },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const { keep, absorb } = parseTypeMerge(body);
    if (!keep || !absorb.length) throw new BadRequestException("Elige el tipo que queda y al menos otro para archivar.");
    const codes = [keep, ...absorb];
    const rows = await this.prisma.containerType.findMany({ where: { code: { in: codes } } });
    const byCode = new Map(rows.map((row) => [row.code, row]));
    if (!byCode.has(keep)) throw new BadRequestException("El tipo que queda no existe.");
    const missing = absorb.filter((code) => !byCode.has(code));
    if (missing.length) throw new BadRequestException(`No existe el tipo ${missing.join(", ")}.`);

    const units = await this.prisma.container.findMany({
      where: { type: { in: absorb } },
      select: { iso: true, type: true },
    });
    await this.prisma.container.updateMany({ where: { type: { in: absorb } }, data: { type: keep } });
    for (let i = 0; i < units.length; i += 400) {
      const chunk = units.slice(i, i + 400);
      await this.prisma.containerHistory.createMany({
        data: chunk.map((unit) => ({
          iso: unit.iso,
          type: "Tipo",
          detail: `Tipo fusionado de ${unit.type} a ${keep} por ${user.name}. ${unit.type} quedó archivado. No cambia el producto en Odoo.`,
        })),
      });
    }
    const candidates = await this.prisma.odooLotCandidate.updateMany({
      where: { zdryType: { in: absorb } },
      data: { zdryType: keep },
    });
    await this.retargetScopeRules(this.prisma.pricingRule, absorb, keep);
    await this.retargetScopeRules(this.prisma.visibilityRule, absorb, keep);
    await this.retargetSetting(
      ACQUISITION_REFS_KEY,
      (value) => retargetTypeRows(
        normalizeAcquisitionRefs(value),
        "type",
        absorb,
        keep,
        (row) => `${row.type}|${row.cat || ""}`,
      ),
    );
    await this.retargetSetting(
      SAFETY_MARGIN_KEY,
      (value) => retargetTypeRows(
        normalizeSafetyMarginRules(value),
        "type",
        absorb,
        keep,
        (row) => `${row.type || ""}|${row.cat || ""}|${row.supplier || ""}|${row.origin || ""}|${row.warehouse || ""}`,
      ),
    );
    const archivedAt = new Date();
    await this.prisma.containerType.updateMany({
      where: { code: { in: absorb }, archivedAt: null },
      data: { archivedAt },
    });
    if (byCode.get(keep)?.archivedAt) {
      await this.prisma.containerType.update({ where: { code: keep }, data: { archivedAt: null } });
    }
    const prices = await refreshRulePrices(this.prisma);
    const left = await this.prisma.container.count({ where: { type: { in: absorb } } });
    await this.audit.log({
      user,
      action: "merge",
      entity: "ContainerType",
      entityId: keep,
      before: { absorb },
      after: { keep, movedUnits: units.length, movedCandidates: candidates.count, leftOnArchived: left },
      ip: req.ip,
    });
    return {
      keep,
      archived: absorb,
      movedUnits: units.length,
      movedCandidates: candidates.count,
      leftOnArchived: left,
      pricesRecalculated: prices.updated,
    };
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

  private async retargetScopeRules(
    model: {
      findMany(args: { where: { scope: string; target: { in: string[] } } }): Promise<Array<{ id: string; target: string | null }>>;
      update(args: { where: { id: string }; data: { target: string } }): Promise<unknown>;
      deleteMany(args: { where: { id: { in: string[] } } }): Promise<unknown>;
    },
    absorb: string[],
    keep: string,
  ) {
    const rows = await model.findMany({ where: { scope: "type", target: { in: [keep, ...absorb] } } });
    const absorbed = rows.filter((row) => row.target && absorb.includes(row.target));
    if (!absorbed.length) return;
    if (rows.some((row) => row.target === keep)) {
      await model.deleteMany({ where: { id: { in: absorbed.map((row) => row.id) } } });
      return;
    }
    await model.update({ where: { id: absorbed[0].id }, data: { target: keep } });
    if (absorbed.length > 1) {
      await model.deleteMany({ where: { id: { in: absorbed.slice(1).map((row) => row.id) } } });
    }
  }

  private async retargetSetting(key: string, map: (value: unknown) => unknown) {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!row) return;
    await this.prisma.appSetting.update({
      where: { key },
      data: { value: map(row.value) as Prisma.InputJsonValue },
    });
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
