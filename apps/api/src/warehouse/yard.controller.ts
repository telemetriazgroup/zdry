import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { WarehouseService } from "./warehouse.service";

@Controller("yard")
@Roles("admin", "almacen", "coordinador")
export class YardController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Post("plan")
  savePlan(
    @Body() body: { depotId?: string; zones?: unknown; aisles?: unknown; ghosts?: unknown },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.saveYardPlan(body.depotId || "", body, user, req.ip);
  }

  @Post("ghost")
  ghost(
    @Body() body: { depotId?: string; zoneId?: string; row?: number; col?: number; level?: number; occupied?: boolean; code?: string; typeCode?: string; color?: string; note?: string; half?: string; split?: boolean; merge?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.setYardGhost(body, user, req.ip);
  }

  @Post("release")
  release(
    @Body() body: { iso?: string; depotId?: string; regularize?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.release(body.iso || "", body.depotId || "", user, req.ip, body.regularize === true);
  }

  @Post("aisle")
  aisle(
    @Body() body: { iso?: string; depotId?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.holdInAisle(body.iso || "", body.depotId || "", user, req.ip);
  }

  @Get("history/:iso")
  history(@Param("iso") iso: string, @Query("depotId") depotId?: string) {
    return this.warehouse.movementHistory(iso, depotId || "");
  }

  @Post("fence")
  fence(
    @Body() body: { depotId?: string; sideId?: string; slot?: number; level?: number; iso?: string; wall?: boolean; move?: boolean; half?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.assignFence(body, user, req.ip);
  }

  @Post("exit")
  exit(
    @Body() body: { depotId?: string; iso?: string; destination?: string; note?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.registerExit(body, user, req.ip);
  }

  @Post("exit/:id/cancel")
  cancelExit(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.cancelExit(id, user, req.ip);
  }

  @Post("place")
  place(
    @Body() body: { iso?: string; depotId?: string; lado?: string; ruma?: number; columna?: number; nivel?: number; half?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.place(body, user, req.ip);
  }

  @Post("compact")
  compact(@Body() body: { depotId?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.compact(body.depotId || "", user, req.ip);
  }

  @Post("rumas")
  loadRumas(
    @Body() body: { depotId?: string; template?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.loadRumaTemplate(body.depotId || "", body.template || "", user, req.ip);
  }

  @Post("scenario")
  loadScenario(
    @Body() body: { depotId?: string; scenario?: string; withPerimeter?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.loadDemoScenario(body.depotId || "", body.scenario || "", body.withPerimeter === true, user, req.ip);
  }

  @Post("reset")
  reset(@Body() body: { depotId?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.resetDepot(body.depotId || "", user, req.ip);
  }

  @Get(":depotId/suggest")
  suggest(@Param("depotId") depotId: string, @Query("iso") iso: string) {
    return this.warehouse.suggest(depotId, iso || "");
  }

  @Get(":depotId")
  layout(@Param("depotId") depotId: string, @CurrentUser() user: AuthUser) {
    return this.warehouse.yardLayout(depotId, user);
  }
}
