import { Body, Controller, Get, Param, Patch, Post, Query, Req, StreamableFile } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { OdooImportService } from "./odoo-import.service";

@Controller("odoo-import")
@Roles("superadmin", "admin")
export class OdooImportController {
  constructor(private readonly svc: OdooImportService) {}

  @Get("probe")
  @Roles("superadmin", "admin")
  probe() {
    return this.svc.probe();
  }

  @Get("candidates")
  candidates(@Query("status") status?: string) {
    return this.svc.list(status);
  }

  @Get("candidates/:id")
  getOne(@Param("id") id: string, @Query("refresh") refresh?: string) {
    return this.svc.getOne(id, { refresh: refresh === "1" || refresh === "true" });
  }

  @Get("candidates/:id/photos")
  photos(@Param("id") id: string) {
    return this.svc.listPhotos(id);
  }

  @Get("candidates/:id/photos/:attId")
  async openPhoto(@Param("id") id: string, @Param("attId") attId: string) {
    const obj = await this.svc.openPhoto(id, attId);
    return new StreamableFile(obj.buffer, {
      type: obj.contentType,
      disposition: `inline; filename="${obj.name.replace(/"/g, "")}"`,
    });
  }

  @Patch("candidates/:id")
  patch(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.patch(id, body, user, req.ip);
  }

  @Post("candidates/:id/flush")
  flushOne(@Param("id") id: string) {
    return this.svc.flushWritebacks(id);
  }

  @Post("sync")
  sync(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.sync(user, req.ip);
  }

  @Post("assimilate")
  assimilate(@Body() body: { ids?: string[] }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.assimilate(body.ids || [], user, req.ip);
  }

  @Post("reset")
  @Roles("superadmin", "admin")
  reset(@Body() body: { confirm?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.resetModule(user, body.confirm || "", req.ip);
  }

  @Post("candidates/:id/ignore")
  ignore(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.ignore(id, user, req.ip);
  }
}
