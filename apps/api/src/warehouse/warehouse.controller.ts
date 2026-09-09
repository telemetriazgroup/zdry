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
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { hideOdooFor, hideOdooIdsFor, hideRatesFor, WarehouseService } from "./warehouse.service";
import { MAX_INSPECTION_VIDEO_BYTES } from "../domain/inspection-media";

@Controller("warehouse")
@Roles("admin", "almacen", "coordinador")
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get("meta")
  meta(@CurrentUser() user: AuthUser) {
    return this.warehouse.meta(user);
  }

  @Get("iso")
  validateIso(@Query("code") code: string) {
    return this.warehouse.validateIso(code || "");
  }

  @Get("pending")
  pending(@CurrentUser() user: AuthUser) {
    return this.warehouse.pending(user);
  }

  @Get("campo")
  campo(@Query("q") q?: string) {
    return this.warehouse.campoQueue(q || "");
  }

  @Get("daily")
  daily(@Query("date") date?: string) {
    return this.warehouse.dailyActivity(date);
  }

  @Post("options")
  @Roles("admin", "coordinador")
  addOption(
    @Body() body: { kind?: "color" | "manufacturer" | "document"; value?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const kind = body.kind === "manufacturer" ? "manufacturer" : body.kind === "document" ? "document" : "color";
    return this.warehouse.addCatalogOption(kind, body.value || "", user, req.ip);
  }

  @Post("emergency")
  emergency(
    @Body() body: { iso?: string; depotId?: string; type?: string; cat?: string; note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.emergencyIntake(body, user, req.ip);
  }

  @Post("intake")
  @Roles("admin", "coordinador")
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
      enableCampo?: boolean;
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.intake(body, user, req.ip);
  }

  @Get("units/:iso")
  getUnit(@Param("iso") iso: string, @CurrentUser() user: AuthUser) {
    return this.warehouse.getUnit(iso, {
      hideOdoo: hideOdooFor(user.role),
      hideOdooIds: hideOdooIdsFor(user.role),
      hideRates: hideRatesFor(user.role),
    });
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
      odooDua?: string;
      originCountry?: string;
      material?: string;
      conditionFloor?: string | null;
      conditionRoof?: string | null;
      conditionDoors?: string | null;
      conditionPaint?: string | null;
      conditionWalls?: string | null;
      roofHole?: boolean | null;
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.patchUnit(iso, body, user, req.ip);
  }

  @Post("units/:iso/ratings")
  setRating(
    @Param("iso") iso: string,
    @Body() body: { conceptId?: string; levelId?: string; reason?: string; note?: string; source?: "patio" | "recepcion" | "catalogo" },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.setUnitRating(iso, body, user, req.ip);
  }

  @Post("units/:iso/enable-campo")
  @Roles("admin", "coordinador")
  enableCampo(@Param("iso") iso: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.enableCampo(iso, user, req.ip);
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

  @Post("units/:iso/captures")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INSPECTION_VIDEO_BYTES },
    }),
  )
  uploadCapture(
    @Param("iso") iso: string,
    @Body("note") note: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.uploadCapture(iso, file, note || "", user, req.ip);
  }

  @Get("units/:iso/captures/:id")
  async openCapture(@Param("iso") iso: string, @Param("id") id: string) {
    const obj = await this.warehouse.openCapture(iso, id);
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "application/octet-stream",
      length: obj.contentLength,
      disposition: `inline; filename="${(obj.name || "toma").replace(/"/g, "")}"`,
    });
  }

  @Post("units/:iso/captures/:id/assign")
  @Roles("admin", "coordinador")
  assignCapture(
    @Param("iso") iso: string,
    @Param("id") id: string,
    @Body() body: { slot?: string | number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.assignCapture(iso, id, String(body.slot ?? ""), user, req.ip);
  }

  @Post("units/:iso/activity")
  @Roles("admin", "coordinador")
  activity(
    @Param("iso") iso: string,
    @Body() body: { conceptKey?: string; conceptId?: string; note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.registerActivity(iso, body, user, req.ip);
  }

  @Post("units/:iso/documents")
  @Roles("admin", "coordinador")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INSPECTION_VIDEO_BYTES },
    }),
  )
  uploadDocument(
    @Param("iso") iso: string,
    @Body("concept") concept: string,
    @Body("note") note: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.uploadDocument(iso, file, concept || "", note || "", user, req.ip);
  }

  @Patch("units/:iso/documents/:id")
  @Roles("admin", "coordinador")
  updateDocument(
    @Param("iso") iso: string,
    @Param("id") id: string,
    @Body() body: { concept?: string; note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.updateDocument(iso, id, body, user, req.ip);
  }

  @Delete("units/:iso/documents/:id")
  @Roles("admin", "coordinador")
  deleteDocument(
    @Param("iso") iso: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.deleteDocument(iso, id, user, req.ip);
  }

  @Get("units/:iso/documents/:id")
  @Roles("admin", "coordinador")
  async openDocument(@Param("iso") iso: string, @Param("id") id: string) {
    const obj = await this.warehouse.openDocument(iso, id);
    return new StreamableFile(obj.stream, {
      type: obj.contentType || "application/octet-stream",
      length: obj.contentLength,
      disposition: `inline; filename="${(obj.name || "documento").replace(/"/g, "")}"`,
    });
  }

  @Get("units/:iso/odoo-photos")
  @Roles("admin", "coordinador")
  listOdooPhotos(@Param("iso") iso: string) {
    return this.warehouse.listOdooPhotos(iso);
  }

  @Get("units/:iso/odoo-photos/:attId")
  @Roles("admin", "coordinador")
  async openOdooPhoto(@Param("iso") iso: string, @Param("attId") attId: string) {
    const obj = await this.warehouse.openOdooPhoto(iso, attId);
    return new StreamableFile(obj.buffer, {
      type: obj.contentType,
      disposition: `inline; filename="${obj.name.replace(/"/g, "")}"`,
    });
  }

  @Post("units/:iso/odoo-photos/:attId/assign")
  @Roles("admin", "coordinador")
  assignOdooPhoto(
    @Param("iso") iso: string,
    @Param("attId") attId: string,
    @Body() body: { slot?: string | number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.assignOdooPhoto(iso, attId, String(body.slot ?? ""), user, req.ip);
  }

  @Post("units/:iso/regularize")
  regularize(@Param("iso") iso: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.regularize(iso, user, req.ip);
  }

  @Post("units/:iso/iso-review")
  acceptIsoReview(
    @Param("iso") iso: string,
    @Body() body: { note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.acceptIsoReview(iso, body.note || "", user, req.ip);
  }

  @Post("units/:iso/archive")
  @Roles("admin", "coordinador")
  archive(
    @Param("iso") iso: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.archive(iso, body.reason || "", user, req.ip);
  }

  @Post("units/:iso/confirm")
  @Roles("admin", "coordinador")
  confirm(@Param("iso") iso: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.confirm(iso, user, req.ip);
  }

  @Post("units/:iso/gate")
  @Roles("admin", "coordinador")
  gate(
    @Param("iso") iso: string,
    @Body() body: { field?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.toggleGate(iso, body.field || "", user, req.ip);
  }

  @Post("units/:iso/service")
  @Roles("admin", "coordinador")
  service(
    @Param("iso") iso: string,
    @Body() body: { key?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.registerService(iso, body.key || "", user, req.ip);
  }
}
