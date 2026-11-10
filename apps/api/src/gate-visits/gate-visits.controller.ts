import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Request } from "express";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { GateVisitsService } from "./gate-visits.service";
import { DriverRegistryService } from "./driver-registry.service";
import { clientOrigin } from "../domain/client-origin";
import { MAX_INSPECTION_PHOTO_BYTES } from "../domain/inspection-media";

type VisitBody = {
  publicToken?: string;
  siteId?: string;
  motiveId?: string;
  motiveDetail?: string;
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
  observations?: string;
  iso?: string;
};

const photoUpload = FileInterceptor("file", {
  storage: memoryStorage(),
  limits: { fileSize: MAX_INSPECTION_PHOTO_BYTES },
});

@Controller("gate-visits")
export class GateVisitsController {
  constructor(
    private readonly visits: GateVisitsService,
    private readonly registry: DriverRegistryService,
  ) {}

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
  @Get("public/options")
  publicOptions() {
    return this.registry.publicOptions();
  }

  @Public()
  @Post("public/photo")
  @UseInterceptors(photoUpload)
  uploadPublicPhoto(
    @Body("tractorPlate") tractorPlate: string,
    @Body("publicToken") publicToken: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.visits.uploadPublicPhoto(tractorPlate || "", file, clientOrigin(req), publicToken || "");
  }

  @Roles("admin", "almacen", "coordinador")
  @Get()
  list(@Query("filter") filter?: "pending" | "linked" | "all" | "archived", @Query("status") status?: string) {
    return this.visits.list(filter || "pending", status || "");
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
  @Get("masters")
  masters() {
    return this.registry.catalog(true);
  }

  @Roles("admin", "coordinador")
  @Post("sites")
  addSite(@Body() body: { name?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.registry.addSite(body.name || "", user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Patch("sites/:id")
  patchSite(
    @Param("id") id: string,
    @Body() body: { active?: boolean; replyPhone?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.patchSite(id, body, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post("motives")
  addMotive(@Body() body: { name?: string; asksDetail?: boolean }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.registry.addMotive(body.name || "", !!body.asksDetail, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Patch("motives/:id")
  patchMotive(
    @Param("id") id: string,
    @Body() body: { active?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.patchMotive(id, body, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post("recipients")
  addRecipient(
    @Body() body: { siteId?: string; kind?: string; destination?: string; label?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.addRecipient(body.siteId || "", body.kind || "", body.destination || "", body.label || "", user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Delete("recipients/:id")
  removeRecipient(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.registry.removeRecipient(id, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post("warehouses")
  addWarehouse(
    @Body() body: { siteId?: string; name?: string; mapUrl?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.addWarehouse(body.siteId || "", body.name || "", body.mapUrl || "", user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Patch("warehouses/:id")
  patchWarehouse(
    @Param("id") id: string,
    @Body() body: { active?: boolean; mapUrl?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.patchWarehouse(id, body, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post("templates")
  saveTemplate(
    @Body() body: { key?: "confirm" | "location"; value?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.saveTemplate(body.key === "location" ? "location" : "confirm", body.value || "", user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post("import")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  importExcel(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!file?.buffer?.length) throw new BadRequestException("Selecciona el Excel de conductores.");
    return this.registry.importWorkbook(file.buffer, user, req.ip);
  }

  @Roles("admin", "almacen", "coordinador")
  @Get(":id")
  async detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const row = await this.registry.detail(id);
    if (user.role === "almacen") {
      return { ...row, notices: [], statusEvents: [] };
    }
    return row;
  }

  @Roles("admin", "coordinador")
  @Post(":id/status")
  changeStatus(
    @Param("id") id: string,
    @Body() body: { status?: string; sendConfirm?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.changeStatus(id, body.status || "", !!body.sendConfirm, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/driver")
  driverMessage(
    @Param("id") id: string,
    @Body() body: { kind?: "confirmacion" | "ubicacion"; warehouseId?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.sendDriver(id, body.kind === "ubicacion" ? "ubicacion" : "confirmacion", body.warehouseId || "", user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/notices/:noticeId/retry")
  retryNotice(
    @Param("id") id: string,
    @Param("noticeId") noticeId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.registry.retryNotice(id, noticeId, user, req.ip);
  }

  @Roles("admin", "coordinador")
  @Post(":id/photo/archive")
  archivePhoto(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.archivePhoto(id, user, req.ip);
  }

  @Roles("admin")
  @Post(":id/photo/restore")
  restorePhoto(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.visits.restorePhoto(id, user, req.ip);
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
