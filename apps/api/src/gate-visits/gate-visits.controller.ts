import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Request } from "express";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { GateVisitsService } from "./gate-visits.service";
import { clientOrigin } from "../domain/client-origin";
import { MAX_INSPECTION_PHOTO_BYTES } from "../domain/inspection-media";

type VisitBody = {
  tractorPlate?: string;
  company?: string;
  ruc?: string;
  driverName?: string;
  visitAt?: string;
  license?: string;
  motive?: string;
  trailerPlate?: string;
  phone?: string;
  equipmentCode?: string;
  iso?: string;
};

const photoUpload = FileInterceptor("file", {
  storage: memoryStorage(),
  limits: { fileSize: MAX_INSPECTION_PHOTO_BYTES },
});

@Controller("gate-visits")
export class GateVisitsController {
  constructor(private readonly visits: GateVisitsService) {}

  @Public()
  @Get("by-plate/:plate/photo")
  async publicPhoto(@Param("plate") plate: string) {
    const obj = await this.visits.openPublicPhoto(plate || "");
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "image/jpeg",
      length: obj.contentLength,
      disposition: `inline; filename="${(obj.name || "unidad.jpg").replace(/"/g, "")}"`,
    });
  }

  @Public()
  @Get("by-plate/:plate")
  byPlate(@Param("plate") plate: string, @Req() req: Request) {
    return this.visits.byPlate(plate || "", clientOrigin(req));
  }

  @Public()
  @Get("ticket/:token/photo")
  async tokenPhoto(@Param("token") token: string) {
    const obj = await this.visits.openTokenPhoto(token || "");
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "image/jpeg",
      length: obj.contentLength,
      disposition: `inline; filename="${(obj.name || "unidad.jpg").replace(/"/g, "")}"`,
    });
  }

  @Public()
  @Get("ticket/:token")
  byToken(@Param("token") token: string) {
    return this.visits.byToken(token || "");
  }

  @Public()
  @Post("public")
  upsertPublic(@Body() body: VisitBody, @Req() req: Request) {
    return this.visits.upsertPublic(body, clientOrigin(req));
  }

  @Public()
  @Post("public/photo")
  @UseInterceptors(photoUpload)
  uploadPublicPhoto(
    @Body("tractorPlate") tractorPlate: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.visits.uploadPublicPhoto(tractorPlate || "", file, clientOrigin(req));
  }

  @Roles("admin", "coordinador")
  @Get()
  list(@Query("filter") filter?: "pending" | "linked" | "all" | "archived") {
    return this.visits.list(filter || "pending");
  }

  @Roles("admin", "coordinador")
  @Get("access-logs")
  accessLogs() {
    return this.visits.accessLogs();
  }

  @Roles("admin", "almacen", "coordinador")
  @Get("arrivals")
  arrivals() {
    return this.visits.arrivals();
  }

  @Roles("admin", "almacen", "coordinador")
  @Get("lookup")
  lookup(@Query("q") q?: string) {
    return this.visits.lookup(q || "");
  }

  @Roles("admin", "coordinador")
  @Post()
  create(@Body() body: VisitBody, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.createStaff(body, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: VisitBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.visits.updateStaff(id, body, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.remove(id, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/archive")
  archive(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.visits.archive(id, body.reason || "", user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.restore(id, user, req.ip);
  }

  @Roles("admin", "almacen", "coordinador")
  @Get(":id/photo")
  async staffPhoto(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const obj = await this.visits.openPhoto(id, user);
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "image/jpeg",
      length: obj.contentLength,
      disposition: `inline; filename="${(obj.name || "unidad.jpg").replace(/"/g, "")}"`,
    });
  }

  @Roles("admin", "coordinador")
  @Post(":id/photo")
  @UseInterceptors(photoUpload)
  uploadStaffPhoto(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.visits.uploadStaffPhoto(id, file, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/photo/approve")
  approvePhoto(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.reviewPhoto(id, true, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/photo/reject")
  rejectPhoto(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.reviewPhoto(id, false, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/link")
  link(
    @Param("id") id: string,
    @Body() body: { iso?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.visits.link(id, body.iso || "", user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/unlink")
  unlink(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.unlink(id, user, req.ip);
  }
}
