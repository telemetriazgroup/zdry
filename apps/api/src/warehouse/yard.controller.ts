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
    @Body() body: { depotId?: string; zoneId?: string; row?: number; col?: number; level?: number; occupied?: boolean; code?: string; typeCode?: string; color?: string; note?: string; half?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.setYardGhost(body, user, req.ip);
  }

  @Post("release")
  release(
    @Body() body: { iso?: string; depotId?: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.release(body.iso || "", body.depotId || "", user, req.ip);
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
