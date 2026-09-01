import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { CatalogMediaService } from "./catalog-media.service";
import { MAX_INSPECTION_VIDEO_BYTES } from "../domain/inspection-media";

@Controller("catalog-media")
@Roles("admin", "almacen", "compras", "gerente")
export class CatalogMediaController {
  constructor(private readonly media: CatalogMediaService) {}

  @Get("meta")
  meta() {
    return this.media.meta();
  }

  @Get()
  list() {
    return this.media.list();
  }

  @Get(":iso/history/:id")
  async historyPhoto(@Param("iso") iso: string, @Param("id") id: string) {
    const obj = await this.media.openHistoryPhoto(iso, id);
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "application/octet-stream",
      length: obj.contentLength,
      disposition: "inline",
    });
  }

  @Get(":iso/photos/:slot")
  async photo(@Param("iso") iso: string, @Param("slot") slot: string) {
    const obj = await this.media.openPhoto(iso, slot);
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "application/octet-stream",
      length: obj.contentLength,
      disposition: "inline",
    });
  }

  @Get(":iso")
  get(@Param("iso") iso: string) {
    return this.media.get(iso);
  }

  @Patch(":iso")
  patch(
    @Param("iso") iso: string,
    @Body() body: { inspectionNotes?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.media.patchNotes(iso, body.inspectionNotes || "", user, req.ip);
  }

  @Post(":iso/photos")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INSPECTION_VIDEO_BYTES },
    }),
  )
  upload(
    @Param("iso") iso: string,
    @Body("slot") slot: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.media.upload(iso, slot, file, user, req.ip);
  }

  @Post(":iso/photos/:slot/reject")
  @Roles("admin", "gerente")
  rejectPhoto(
    @Param("iso") iso: string,
    @Param("slot") slot: string,
    @Body() body: { note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.media.rejectPhoto(iso, Number(slot), body.note || "", user, req.ip);
  }

  @Post(":iso/history/:id/restore")
  @Roles("admin", "gerente")
  restorePhoto(
    @Param("iso") iso: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.media.restorePhoto(iso, id, user, req.ip);
  }

  @Post(":iso/approve")
  @Roles("admin", "gerente")
  approve(@Param("iso") iso: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.media.approve(iso, user, req.ip);
  }

  @Post(":iso/hide")
  @Roles("admin", "gerente")
  hide(@Param("iso") iso: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.media.hide(iso, user, req.ip);
  }
}
