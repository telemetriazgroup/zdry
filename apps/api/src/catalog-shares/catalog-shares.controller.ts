import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
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
  @Roles("superadmin", "vendedor")
  list(@CurrentUser() user: AuthUser) {
    return this.shares.list(user);
  }

  @Post()
  @Roles("superadmin", "vendedor")
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.shares.create(body, user, req.ip);
  }

  @Get("mine/:id")
  @Roles("superadmin", "vendedor")
  one(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.shares.getOne(id, user);
  }
}
