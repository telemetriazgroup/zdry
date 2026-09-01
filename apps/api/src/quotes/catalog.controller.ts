import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { QuotesService } from "./quotes.service";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly quotes: QuotesService) {}

  @Public()
  @Get()
  list(
    @Query("q") q?: string,
    @Query("type") type?: string,
    @Query("cat") cat?: string,
    @Query("depot") depot?: string,
    @Query("manufacturer") manufacturer?: string,
    @Query("year") year?: string,
    @Query("sort") sort?: string,
    @Query("page") page?: string,
  ) {
    return this.quotes.catalogList({ q, type, cat, depot, manufacturer, year, sort, page });
  }

  @Public()
  @Get("meta")
  meta() {
    return this.quotes.catalogMeta();
  }

  @Public()
  @Get("copy")
  copy() {
    return this.quotes.catalogCopy();
  }

  @Public()
  @Get("freight")
  freight(@Query("zoneId") zoneId: string, @Query("types") types: string, @Query("vehicle") vehicle?: string) {
    return this.quotes.freightPreview(zoneId, (types || "").split(",").filter(Boolean), vehicle);
  }

  @Public()
  @Get("services")
  services() {
    return this.quotes.commercialServices();
  }

  @Post("quotes")
  @Roles("cliente", "admin", "gerente", "vendedor")
  requestQuote(
    @Body()
    body: {
      isos?: string[];
      kind?: string;
      customerId?: string;
      companyName?: string;
      email?: string;
      rucDni?: string;
      phone?: string;
      name?: string;
    },
    @CurrentUser() user: AuthUser | undefined,
    @Req() req: Request,
  ) {
    return this.quotes.requestQuote(body, user, req.ip);
  }

  @Public()
  @Get(":iso/photos/:slot")
  photo(@Param("iso") iso: string, @Param("slot") slot: string) {
    return this.quotes.catalogPhoto(iso, parseInt(slot, 10));
  }

  @Public()
  @Get(":iso/video")
  video(@Param("iso") iso: string) {
    return this.quotes.catalogVideo(iso);
  }

  @Public()
  @Get(":iso")
  unit(@Param("iso") iso: string) {
    return this.quotes.catalogUnit(iso);
  }
}
