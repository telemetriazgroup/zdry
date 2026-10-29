import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { CatalogSharesService } from "./catalog-shares.service";

function requestOrigin(req: Request) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

@Controller("catalog-shares")
export class CatalogSharesController {
  constructor(private readonly shares: CatalogSharesService) {}

  @Public()
  @Get("commerce")
  commerce() {
    return this.shares.commerce();
  }

  @Get()
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  list(@CurrentUser() user: AuthUser, @Query("archived") archived?: string) {
    return this.shares.list(user, archived === "1" || archived === "true");
  }

  @Get("vendors")
  @Roles("superadmin", "admin", "ejecutivo")
  vendors() {
    return this.shares.vendorChoices();
  }

  @Get("report")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  report(@CurrentUser() user: AuthUser, @Query("archived") archived?: string) {
    return this.shares.report(user, archived === "1" || archived === "true");
  }

  @Public()
  @Post("public/ruc")
  publicRuc(@Body() body: { ruc?: string }, @Req() req: Request) {
    return this.shares.publicLookupRuc(String(body?.ruc || ""), req.ip, requestOrigin(req));
  }

  @Public()
  @Post("public/register")
  publicRegister(@Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.shares.publicRegister(body, req.ip, requestOrigin(req));
  }

  @Post("ruc")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  lookupRuc(@Body() body: { ruc?: string }) {
    return this.shares.lookupRuc(String(body?.ruc || ""));
  }

  @Post("dni")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  lookupDni(@Body() body: { dni?: string }) {
    return this.shares.lookupDni(String(body?.dni || ""));
  }

  @Post()
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.create(body, user, req.ip, requestOrigin(req));
  }

  @Post(":id/suspend")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  suspend(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.suspend(id, user, req.ip);
  }

  @Post(":id/renew")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  renew(@Param("id") id: string, @Body() body: { hours?: number }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.renew(id, body?.hours, user, req.ip);
  }

  @Post(":id/add-ruc")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  addRuc(@Param("id") id: string, @Body() body: { ruc?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.addRuc(id, String(body?.ruc || ""), user, req.ip);
  }

  @Post(":id/edit")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  edit(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.edit(id, body, user, req.ip);
  }

  @Post(":id/archive")
  @Roles("superadmin")
  archive(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.archive(id, user, req.ip);
  }

  @Get("mine/:id")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  one(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.shares.getOne(id, user);
  }
}
