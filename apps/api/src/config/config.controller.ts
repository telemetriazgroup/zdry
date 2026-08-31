import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LayoutRules, normalizeLayoutRules } from "../domain/yard";

export const CONFIG_SECTIONS = [
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
        status: s.id === "yard-columns" ? ("live" as const) : ("stub" as const),
      })),
      note: "Las reglas de columna de patio (Sprint 3) ya se editan aquí. El resto entra en el Sprint 9.",
    };
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
}
