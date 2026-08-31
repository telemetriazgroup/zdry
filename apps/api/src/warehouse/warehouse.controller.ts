import {
  Body,
  Controller,
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
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { WarehouseService } from "./warehouse.service";
import { MAX_INSPECTION_VIDEO_BYTES } from "../domain/inspection-media";

@Controller("warehouse")
@Roles("admin", "almacen")
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get("meta")
  meta() {
    return this.warehouse.meta();
  }

  @Get("iso")
  validateIso(@Query("code") code: string) {
    return this.warehouse.validateIso(code || "");
  }

  @Get("pending")
  pending() {
    return this.warehouse.pending();
  }

  @Post("intake")
  intake(
    @Body()
    body: {
      category?: string;
      iso?: string;
      type?: string;
      cat?: string;
      depotId?: string;
      customerId?: string;
      discount?: number;
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.intake(body, user, req.ip);
  }

  @Get("units/:iso")
  getUnit(@Param("iso") iso: string) {
    return this.warehouse.getUnit(iso);
  }

  @Patch("units/:iso")
  patchUnit(
    @Param("iso") iso: string,
    @Body()
    body: {
      tareKg?: number;
      mgwKg?: number;
      color?: string;
      cat?: string;
      year?: number | null;
      manufacturer?: string;
      inspectionNotes?: string;
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.patchUnit(iso, body, user, req.ip);
  }

  @Post("units/:iso/photos")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INSPECTION_VIDEO_BYTES },
    }),
  )
  uploadPhoto(
    @Param("iso") iso: string,
    @Body("slot") slot: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.uploadMedia(iso, slot, file, user, req.ip);
  }

  @Get("units/:iso/photos/:slot")
  async openPhoto(@Param("iso") iso: string, @Param("slot") slot: string) {
    const obj = await this.warehouse.openPhoto(iso, slot);
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "application/octet-stream",
      length: obj.contentLength,
    });
  }

  @Post("units/:iso/confirm")
  confirm(@Param("iso") iso: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.confirm(iso, user, req.ip);
  }

  @Post("units/:iso/gate")
  gate(
    @Param("iso") iso: string,
    @Body() body: { field?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.toggleGate(iso, body.field || "", user, req.ip);
  }

  @Post("units/:iso/service")
  service(
    @Param("iso") iso: string,
    @Body() body: { key?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.registerService(iso, body.key || "", user, req.ip);
  }
}
