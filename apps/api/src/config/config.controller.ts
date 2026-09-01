import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LayoutRules, normalizeLayoutRules } from "../domain/yard";
import { CATALOG_COPY_KEY, normalizeCatalogCopy } from "../domain/catalog-copy";

export const CONFIG_SECTIONS = [
  { id: "catalog-copy", title: "Textos del catálogo", blurb: "Editor de la página pública: hero, pasos, pie y legales. Así lo ve el cliente." },
  { id: "visibility", title: "Visibilidad de precios", blurb: "Reglas jerárquicas global → tipo → fabricante → unidad." },
  { id: "freight", title: "Tarifario de fletes", blurb: "Zonas, terrenos, márgenes min/rec/premium, vehículos." },
  { id: "rentals", title: "Reglas de alquiler", blurb: "Depreciación, márgenes, descuento por plazo y riesgo A–D." },
  { id: "providers", title: "Proveedores", blurb: "Lectura; el alta vive en Personas." },
  { id: "depot-services", title: "Servicios propios del depósito", blurb: "Gate in/out, reparación, lavado, movimiento interno." },
  { id: "commercial-services", title: "Servicios comerciales", blurb: "Precio fijo para cotización; nunca texto libre." },
  { id: "extra-concepts", title: "Conceptos de costos adicionales", blurb: "Catálogo que usa Compras." },
  { id: "yard-columns", title: "Reglas de columna de patio", blurb: "Min/max nivel, agrupar por condición o fabricante." },
  { id: "ops-discounts", title: "Descuentos operativos", blurb: "Días libres y movimientos libres." },
  { id: "fleet", title: "Flota de camiones", blurb: "Alta de unidades propias; sin doble asignación el mismo día." },
];

const LAYOUT_RULES_KEY = "layout_rules";

@Controller("config")
@Roles("admin", "gerente")
export class ConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("sections")
  sections() {
    return {
      sections: CONFIG_SECTIONS.map((s) => ({
        ...s,
        status: ["catalog-copy", "yard-columns", "visibility", "commercial-services"].includes(s.id)
          ? ("live" as const)
          : s.id === "freight"
            ? ("partial" as const)
            : ("stub" as const),
      })),
      note: "Visibilidad, servicios comerciales y reglas de columna ya se editan aquí. El tarifario de flete completo entra en el Sprint 7/9; el stub de zonas ya cotiza en el cierre.",
    };
  }

  @Get("catalog-copy")
  async getCatalogCopy() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CATALOG_COPY_KEY } });
    return normalizeCatalogCopy(row?.value);
  }

  @Put("catalog-copy")
  async putCatalogCopy(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const value = normalizeCatalogCopy(body);
    await this.prisma.appSetting.upsert({
      where: { key: CATALOG_COPY_KEY },
      update: { value: value as object },
      create: { key: CATALOG_COPY_KEY, value: value as object },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "AppSetting",
      entityId: CATALOG_COPY_KEY,
      after: { heroTitle: value.heroTitle },
      ip: req.ip,
    });
    return value;
  }

  @Get("yard-columns")
  async getYardColumns() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: LAYOUT_RULES_KEY } });
    return normalizeLayoutRules(row?.value);
  }

  @Put("yard-columns")
  async putYardColumns(@Body() body: Partial<LayoutRules>, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const current = await this.getYardColumns();
    const value = normalizeLayoutRules({ ...current, ...body });
    await this.prisma.appSetting.upsert({
      where: { key: LAYOUT_RULES_KEY },
      update: { value },
      create: { key: LAYOUT_RULES_KEY, value },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "AppSetting",
      entityId: LAYOUT_RULES_KEY,
      after: value as object,
      ip: req.ip,
    });
    return value;
  }

  @Get("visibility")
  async getVisibility() {
    return this.prisma.visibilityRule.findMany({ orderBy: { createdAt: "asc" } });
  }

  @Put("visibility")
  async putVisibility(
    @Body() body: { rules?: { scope: string; target?: string | null; show: boolean }[] },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const rules = body.rules || [];
    await this.prisma.$transaction([
      this.prisma.visibilityRule.deleteMany(),
      ...rules.map((r) =>
        this.prisma.visibilityRule.create({
          data: { scope: r.scope, target: r.target ?? null, show: !!r.show },
        }),
      ),
    ]);
    await this.audit.log({ user, action: "update", entity: "VisibilityRule", after: { count: rules.length }, ip: req.ip });
    return this.getVisibility();
  }

  @Get("pricing")
  async getPricing() {
    return this.prisma.pricingRule.findMany({ orderBy: { createdAt: "asc" } });
  }

  @Put("pricing")
  async putPricing(
    @Body() body: { rules?: { scope: string; target?: string | null; marginPct: number; maxDiscountPct: number }[] },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const rules = body.rules || [];
    await this.prisma.$transaction([
      this.prisma.pricingRule.deleteMany(),
      ...rules.map((r) =>
        this.prisma.pricingRule.create({
          data: {
            scope: r.scope,
            target: r.target ?? null,
            marginPct: r.marginPct,
            maxDiscountPct: r.maxDiscountPct,
          },
        }),
      ),
    ]);
    await this.audit.log({ user, action: "update", entity: "PricingRule", after: { count: rules.length }, ip: req.ip });
    return this.getPricing();
  }

  @Get("commercial-services")
  commercialServices() {
    return this.prisma.commercialService.findMany({ orderBy: { name: "asc" } });
  }
}
