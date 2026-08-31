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
  @Roles("admin")
  status() {
    return this.demo.status();
  }

  @Post("activate")
  @Roles("admin")
  activate(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.activate(user, req.ip);
  }

  @Post("production")
  @Roles("admin")
  production(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.toProduction(user, req.ip);
  }

  @Post("reload")
  @Roles("admin")
  reload(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.reload(user, req.ip);
  }

  @Post("purge")
  @Roles("admin")
  purge(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.purge(user, req.ip);
  }

  @Get("backups")
  @Roles("admin")
  backups() {
    return this.demo.listBackups();
  }

  @Post("backups")
  @Roles("admin")
  createBackup(@CurrentUser() user: AuthUser) {
    return this.demo.createBackup("Respaldo manual", "manual", user);
  }

  @Post("backups/:id/restore")
  @Roles("admin")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.restore(id, user, req.ip);
  }
}
