import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { WarehouseService } from "./warehouse.service";

@Controller("yard")
@Roles("admin", "almacen")
export class YardController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Post("place")
  place(
    @Body() body: { iso?: string; depotId?: string; lado?: string; ruma?: number; columna?: number; nivel?: number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.warehouse.place(body, user, req.ip);
  }

  @Post("compact")
  compact(@Body() body: { depotId?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.warehouse.compact(body.depotId || "", user, req.ip);
  }

  @Get(":depotId/suggest")
  suggest(@Param("depotId") depotId: string, @Query("iso") iso: string) {
    return this.warehouse.suggest(depotId, iso || "");
  }

  @Get(":depotId")
  layout(@Param("depotId") depotId: string) {
    return this.warehouse.yardLayout(depotId);
  }
}
