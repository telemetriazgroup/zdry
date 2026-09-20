import { Body, Controller, Get, Param, Post, Query, StreamableFile } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { DryStatsService } from "./dry-stats.service";

@Controller("dry-stats")
@Roles("superadmin")
export class DryStatsController {
  constructor(private readonly svc: DryStatsService) {}

  @Get()
  get(@Query("year") year?: string, @Query("kind") kind?: string) {
    return this.svc.present({ year, kind });
  }

  @Get("hydrate")
  hydrate() {
    return this.svc.hydrateStatus();
  }

  @Get("deals")
  deals(
    @Query("year") year?: string,
    @Query("kind") kind?: string,
    @Query("pipeline") pipeline?: string,
    @Query("vendor") vendor?: string,
    @Query("month") month?: string,
    @Query("q") q?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    return this.svc.list({
      year,
      kind,
      pipeline,
      vendor,
      month,
      q,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get("deals/:id/files/:fileId")
  async file(@Param("id") id: string, @Param("fileId") fileId: string) {
    const obj = await this.svc.openFile(id, fileId);
    return new StreamableFile(obj.buffer, {
      type: obj.contentType,
      disposition: `inline; filename="${obj.name.replace(/"/g, "")}"`,
    });
  }

  @Get("deals/:id")
  one(@Param("id") id: string) {
    return this.svc.one(id);
  }

  @Post("import")
  importOdoo(@CurrentUser() user: AuthUser) {
    return this.svc.importFromOdoo(user);
  }

  @Post("hydrate")
  startHydrate(@CurrentUser() user: AuthUser) {
    return this.svc.startHydrate(user);
  }

  @Post("baseline")
  baseline(@CurrentUser() user: AuthUser, @Body() body: { label?: string }) {
    return this.svc.markBaseline(user, body.label);
  }
}
