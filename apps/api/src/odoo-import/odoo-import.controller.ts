import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, StreamableFile } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { OdooImportService } from "./odoo-import.service";
import { QuoteIssueService } from "./quote-issue.service";

@Controller("odoo-import")
@Roles("superadmin", "admin")
export class OdooImportController {
  constructor(
    private readonly svc: OdooImportService,
    private readonly quotes: QuoteIssueService,
  ) {}

  @Get("quote-issue")
  quoteIssue() {
    return this.quotes.get();
  }

  @Put("quote-issue")
  putQuoteIssue(@Body() body: Record<string, unknown>) {
    return this.quotes.put(body);
  }

  @Post("quote-issue/resolve")
  resolveQuoteIssue() {
    return this.quotes.resolve();
  }

  @Get("probe")
  @Roles("superadmin", "admin")
  probe() {
    return this.svc.probe();
  }

  @Get("referential")
  @Roles("superadmin", "admin")
  referential() {
    return this.svc.referential();
  }

  @Get("lot-selects")
  lotSelects(@Query("refresh") refresh?: string) {
    return this.svc.lotSelects({ refresh: refresh === "1" || refresh === "true" });
  }

  @Get("progress")
  progress() {
    return this.svc.progress();
  }

  @Get("log")
  log(
    @Query("runId") runId?: string,
    @Query("level") level?: string,
    @Query("take") take?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.svc.assimilateLog({ runId, level, take: take ? Number(take) : 5, from, to });
  }

  @Get("log/export")
  async exportLog(
    @Query("runId") runId?: string,
    @Query("level") level?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const out = await this.svc.exportAssimilateLog({ runId, level, from, to });
    return new StreamableFile(Buffer.from(out.csv, "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${out.filename.replace(/"/g, "")}"`,
    });
  }

  @Get("candidates")
  candidates(@Query("status") status?: string) {
    return this.svc.list(status);
  }

  @Get("candidates/:id")
  getOne(@Param("id") id: string, @Query("refresh") refresh?: string) {
    return this.svc.getOne(id, { refresh: refresh === "1" || refresh === "true" });
  }

  @Get("candidates/:id/expediente")
  expediente(@Param("id") id: string, @Query("refresh") refresh?: string) {
    return this.svc.expedienteOf(id, { refresh: refresh === "1" || refresh === "true" });
  }

  @Post("candidates/:id/notes")
  addNote(@Param("id") id: string, @Body() body: { body?: string }, @CurrentUser() user: AuthUser) {
    return this.svc.addExpedienteNote(id, body.body || "", user);
  }

  @Patch("candidates/:id/mo-line")
  patchMoLine(
    @Param("id") id: string,
    @Body() body: { key?: string; unitCost?: number; clear?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.svc.patchMoLine(id, body, user, req.ip);
  }

  @Patch("candidates/:id/mo-overhead")
  patchMoOverhead(
    @Param("id") id: string,
    @Body() body: { days?: number; aguaPerDay?: number; herramientasPerDay?: number; adminPerDay?: number; maquinaria?: number; reset?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.svc.patchMoOverhead(id, body, user, req.ip);
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

  @Get("watch")
  watch() {
    return this.svc.watchState();
  }

  @Put("watch")
  setWatch(@Body() body: { mode?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.setWatchMode(body?.mode === "auto" ? "auto" : "manual", user, req.ip);
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

  @Post("resync")
  @Roles("superadmin", "admin")
  resync(@Body() body: { confirm?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.resyncAssimilated(user, body.confirm || "", req.ip);
  }

  @Post("candidates/:id/ignore")
  ignore(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.svc.ignore(id, user, req.ip);
  }
}
