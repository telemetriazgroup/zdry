import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { SuperadminService } from "./superadmin.service";

@Controller("superadmin")
@Roles("superadmin")
export class SuperadminController {
  constructor(private readonly svc: SuperadminService) {}

  @Get("odoo")
  odoo() {
    return this.svc.odooStatus();
  }

  @Get("odoo-links")
  odooLinks() {
    return this.svc.listOdooLinks();
  }

  @Put("odoo-links/:userId")
  setOdooBypass(
    @Param("userId") userId: string,
    @Body() body: { bypass?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.svc.setOdooBypass(userId, !!body.bypass, user, req.ip);
  }

  @Put("odoo")
  saveOdoo(
    @Body() body: { mode?: "staging" | "production"; activate?: boolean; enabled?: boolean; url?: string; db?: string; user?: string; apiKey?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.svc.saveOdoo(body, user, req.ip);
  }

  @Get("backups")
  backups() {
    return this.svc.listBackups();
  }

  @Post("backups")
  createBackup(@Body() body: { label?: string }, @CurrentUser() user: AuthUser) {
    return this.svc.createBackup(body.label || "Respaldo manual del sistema", "manual_system", user);
  }

  @Post("backups/:id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.restore(id, user, req.ip);
  }

  @Post("wipe")
  wipe(@Body() body: { confirm?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.wipe(body.confirm || "", user, req.ip);
  }
}
