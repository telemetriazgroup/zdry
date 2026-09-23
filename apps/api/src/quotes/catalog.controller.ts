import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import { CatalogAccessGuard } from "./catalog-access.guard";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { QuotesService } from "./quotes.service";
import { CatalogSharesService } from "../catalog-shares/catalog-shares.service";

@Controller("catalog")
export class CatalogController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly shares: CatalogSharesService,
  ) {}

  @Public()
  @UseGuards(CatalogAccessGuard)
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
  @UseGuards(CatalogAccessGuard)
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
  @Get("share/:token")
  share(@Param("token") token: string) {
    return this.shares.publicByToken(token);
  }

  @Public()
  @Post("share/:token/unlock")
  unlock(
    @Param("token") token: string,
    @Body() body: { code?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.shares.unlock(token, body?.code, res);
  }

  @Public()
  @Post("share/:token/events")
  shareEvent(@Param("token") token: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return this.shares.recordEvent(token, body, {
      ip: forwarded || req.ip || "",
      userAgent: String(req.headers["user-agent"] || ""),
    });
  }

  @Public()
  @UseGuards(CatalogAccessGuard)
  @Get("freight")
  freight(@Query("zoneId") zoneId: string, @Query("types") types: string, @Query("vehicle") vehicle?: string) {
    return this.quotes.freightPreview(zoneId, (types || "").split(",").filter(Boolean), vehicle);
  }

  @Public()
  @UseGuards(CatalogAccessGuard)
  @Get("services")
  services() {
    return this.quotes.commercialServices();
  }

  @Public()
  @Get("watermark")
  watermark() {
    return this.quotes.catalogWatermark();
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
      dispatchPlace?: string;
    },
    @CurrentUser() user: AuthUser | undefined,
    @Req() req: Request,
  ) {
    return this.quotes.requestQuote(body, user, req.ip);
  }

  @Public()
  @UseGuards(CatalogAccessGuard)
  @Get(":iso/photos/:slot")
  photo(@Param("iso") iso: string, @Param("slot") slot: string) {
    return this.quotes.catalogPhoto(iso, parseInt(slot, 10));
  }

  @Public()
  @UseGuards(CatalogAccessGuard)
  @Get(":iso/video")
  video(@Param("iso") iso: string) {
    return this.quotes.catalogVideo(iso);
  }

  @Public()
  @UseGuards(CatalogAccessGuard)
  @Get(":iso")
  unit(@Param("iso") iso: string) {
    return this.quotes.catalogUnit(iso);
  }
}
