import { Body, Controller, Get, Headers, Param, Post, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { CommercialService } from "./commercial.service";

@Controller("commercial")
export class CommercialController {
  constructor(private readonly commercial: CommercialService) {}

  @Get("equipo")
  @Roles("superadmin", "admin", "ejecutivo")
  team(@CurrentUser() user: AuthUser) {
    return this.commercial.team(user);
  }

  @Put("equipo")
  @Roles("superadmin", "admin")
  save(
    @Body() body: { vendorId?: string; executiveId?: string; enabled?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.commercial.saveDesk(body, user, req.ip);
  }

  @Get("hilos")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  threads(@CurrentUser() user: AuthUser) {
    return this.commercial.listThreads(user);
  }

  @Get("hilos/:id")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  thread(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.commercial.readThread(id, user);
  }

  @Post("hilos/:id/precio")
  @Roles("superadmin", "admin", "vendedor", "ejecutivo")
  offer(
    @Param("id") id: string,
    @Body() body: { useList?: boolean; price?: number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.commercial.offer(id, body, user, req.ip);
  }

  @Post("hilos/:id/ok")
  @Roles("superadmin", "admin", "vendedor")
  ok(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.commercial.confirm(id, user, req.ip);
  }

  @Public()
  @Post("respuesta")
  inbound(@Body() body: { referencia?: string; telefono?: string; texto?: string }, @Headers("x-salida-clave") clave?: string) {
    return this.commercial.inbound(body, String(clave || ""));
  }
}
