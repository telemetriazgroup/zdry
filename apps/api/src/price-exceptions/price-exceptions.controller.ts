import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { PriceExceptionsService } from "./price-exceptions.service";

@Controller("price-exceptions")
export class PriceExceptionsController {
  constructor(private readonly exceptions: PriceExceptionsService) {}

  @Get()
  @Roles("superadmin", "admin", "vendedor")
  list(@CurrentUser() user: AuthUser) {
    return this.exceptions.list(user);
  }

  @Post()
  @Roles("superadmin", "admin", "vendedor")
  create(
    @Body() body: { iso?: string; requestedPrice?: number; clientName?: string; clientCompany?: string; ruc?: string; reason?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.exceptions.create(body, user, req.ip);
  }

  @Post(":id/approve")
  @Roles("admin")
  approve(
    @Param("id") id: string,
    @Body() body: { approvedPrice?: number; note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.exceptions.approve(id, body, user, req.ip);
  }

  @Post(":id/reject")
  @Roles("admin")
  reject(@Param("id") id: string, @Body() body: { note?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.exceptions.reject(id, body, user, req.ip);
  }
}
