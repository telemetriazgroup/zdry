import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { CatalogSharesService } from "./catalog-shares.service";

@Controller("catalog-shares")
export class CatalogSharesController {
  constructor(private readonly shares: CatalogSharesService) {}

  @Public()
  @Get("commerce")
  commerce() {
    return this.shares.commerce();
  }

  @Get()
  @Roles("superadmin", "admin", "vendedor")
  list(@CurrentUser() user: AuthUser, @Query("archived") archived?: string) {
    return this.shares.list(user, archived === "1" || archived === "true");
  }

  @Post("ruc")
  @Roles("superadmin", "admin", "vendedor")
  lookupRuc(@Body() body: { ruc?: string }) {
    return this.shares.lookupRuc(String(body?.ruc || ""));
  }

  @Post()
  @Roles("superadmin", "admin", "vendedor")
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.create(body, user, req.ip);
  }

  @Post(":id/suspend")
  @Roles("superadmin", "admin", "vendedor")
  suspend(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.suspend(id, user, req.ip);
  }

  @Post(":id/renew")
  @Roles("superadmin", "admin", "vendedor")
  renew(@Param("id") id: string, @Body() body: { hours?: number }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.renew(id, body?.hours, user, req.ip);
  }

  @Post(":id/edit")
  @Roles("superadmin", "admin", "vendedor")
  edit(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.edit(id, body, user, req.ip);
  }

  @Post(":id/archive")
  @Roles("superadmin", "admin", "vendedor")
  archive(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.archive(id, user, req.ip);
  }

  @Get("mine/:id")
  @Roles("superadmin", "admin", "vendedor")
  one(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.shares.getOne(id, user);
  }
}
