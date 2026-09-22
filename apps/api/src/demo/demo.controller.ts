import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { Public } from "../auth/public.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { DemoService } from "./demo.service";

@Controller("demo")
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Public()
  @Get("public-status")
  publicStatus() {
    return this.demo.publicStatus();
  }

  @Get()
  @Roles("superadmin")
  status() {
    return this.demo.status();
  }

  @Post("activate")
  @Roles("superadmin")
  activate(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.activate(user, req.ip);
  }

  @Post("production")
  @Roles("superadmin")
  production(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.toProduction(user, req.ip);
  }

  @Post("reload")
  @Roles("superadmin")
  reload(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.reload(user, req.ip);
  }

  @Post("purge")
  @Roles("superadmin")
  purge(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.purge(user, req.ip);
  }

  @Get("backups")
  @Roles("superadmin")
  backups() {
    return this.demo.listBackups();
  }

  @Post("backups")
  @Roles("superadmin")
  createBackup(@CurrentUser() user: AuthUser) {
    return this.demo.createBackup("Respaldo manual", "manual", user);
  }

  @Post("backups/:id/restore")
  @Roles("superadmin")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.restore(id, user, req.ip);
  }
}
