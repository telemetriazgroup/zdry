import { BadRequestException, Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/auth.types";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LayoutRules, normalizeLayoutRules } from "../domain/yard";
import { CATALOG_COPY_KEY, normalizeCatalogCopy } from "../domain/catalog-copy";
import { ACQUISITION_REFS_KEY, DEFAULT_ACQUISITION_REFS, effectiveAcquisitionRefs, normalizeAcquisitionRefs } from "../domain/pricing";
import { EvaluationService } from "../evaluation/evaluation.service";
import { ACTIVE_MASTER } from "../domain/masters";

export const CONFIG_SECTIONS = [
  { id: "catalog-copy", title: "Textos del catálogo", blurb: "Editor de la página pública: hero, pasos, pie y legales. Así lo ve el cliente." },
  { id: "watermark", title: "Marca de agua del catálogo", blurb: "Logo que se repite sobre las fotos públicas. Si no subes uno, se usa zg_marca.png." },
  { id: "visibility", title: "Visibilidad de precios", blurb: "Reglas jerárquicas global → tipo → fabricante → unidad." },
  { id: "acquisition-refs", title: "Costos de referencia", blurb: "Base USD por tipo y condición para calcular la lista (neto + margen)." },
  { id: "freight", title: "Tarifario de fletes", blurb: "Zonas, terrenos, márgenes min/rec/premium, vehículos." },
  { id: "rentals", title: "Reglas de alquiler", blurb: "Depreciación, márgenes, descuento por plazo y riesgo A–D." },
  { id: "providers", title: "Proveedores", blurb: "Lectura; el alta vive en Personas." },
  { id: "evaluation", title: "Evaluación de unidades", blurb: "Conceptos (piso, techo, y los que agregues) y niveles (excelente, bueno, pésimo…) que usa patio y recepción." },
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
    private readonly evaluation: EvaluationService,
  ) {}

  @Get("sections")
  sections() {
    return {
      sections: CONFIG_SECTIONS.map((s) => ({
        ...s,
        status: ["catalog-copy", "watermark", "yard-columns", "visibility", "acquisition-refs", "commercial-services", "depot-services", "evaluation"].includes(s.id)
          ? ("live" as const)
          : s.id === "freight"
            ? ("partial" as const)
            : ("stub" as const),
      })),
      note: "Visibilidad, servicios comerciales y reglas de columna ya se editan aquí. El tarifario de flete completo entra en el Sprint 7/9; el stub de zonas ya cotiza en el cierre.",
    };
  }

  @Get("catalog-copy")
  @Roles("admin", "gerente", "superadmin")
  async getCatalogCopy() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CATALOG_COPY_KEY } });
    return normalizeCatalogCopy(row?.value);
  }

  @Put("catalog-copy")
  @Roles("admin", "gerente", "superadmin")
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

  @Get("acquisition-refs")
  async getAcquisitionRefs() {
    const [row, types, categories] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { key: ACQUISITION_REFS_KEY } }),
      this.prisma.containerType.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.category.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
    ]);
    const stored = normalizeAcquisitionRefs(row?.value);
    return {
      refs: effectiveAcquisitionRefs(stored),
      stored: stored.length > 0,
      types: types.map((t) => ({ code: t.code, label: t.label })),
      categories: categories.map((c) => ({ code: c.code, label: c.label })),
      defaults: DEFAULT_ACQUISITION_REFS,
    };
  }

  @Put("acquisition-refs")
  async putAcquisitionRefs(
    @Body() body: { refs?: { type?: string; cat?: string | null; amount?: number }[] },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const refs = normalizeAcquisitionRefs(body.refs);
    if (!refs.length) throw new BadRequestException("Indica al menos una referencia de costo por tipo.");
    const value = refs as unknown as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({
      where: { key: ACQUISITION_REFS_KEY },
      update: { value },
      create: { key: ACQUISITION_REFS_KEY, value },
    });
    await this.audit.log({ user, action: "update", entity: "AppSetting", entityId: ACQUISITION_REFS_KEY, after: { count: refs.length }, ip: req.ip });
    return this.getAcquisitionRefs();
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

  @Get("depot-concepts")
  @Roles("admin")
  depotConcepts() {
    return this.prisma.depotCostConcept.findMany({ orderBy: [{ system: "desc" }, { label: "asc" }] }).then((rows) =>
      rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    );
  }

  @Post("depot-concepts")
  @Roles("admin")
  async createDepotConcept(
    @Body() body: { key?: string; label?: string; amount?: number },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const label = String(body.label || "").trim();
    if (label.length < 2) throw new BadRequestException("Indica el nombre del concepto.");
    const key = String(body.key || label)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || `c_${Date.now()}`;
    const amount = Math.max(0, Number(body.amount) || 0);
    const row = await this.prisma.depotCostConcept.create({
      data: { key, label, amount, system: false, active: true },
    });
    await this.audit.log({ user, action: "create", entity: "DepotCostConcept", entityId: row.id, after: { key, label, amount }, ip: req.ip });
    return { ...row, amount: Number(row.amount) };
  }

  @Put("depot-concepts/:id")
  @Roles("admin")
  async updateDepotConcept(
    @Param("id") id: string,
    @Body() body: { label?: string; amount?: number; active?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const data: { label?: string; amount?: number; active?: boolean } = {};
    if (body.label !== undefined) data.label = String(body.label).trim();
    if (body.amount !== undefined) data.amount = Math.max(0, Number(body.amount) || 0);
    if (body.active !== undefined) data.active = !!body.active;
    const row = await this.prisma.depotCostConcept.update({ where: { id }, data });
    await this.audit.log({ user, action: "update", entity: "DepotCostConcept", entityId: id, after: data, ip: req.ip });
    return { ...row, amount: Number(row.amount) };
  }

  @Get("evaluation")
  async evaluationCatalog() {
    await this.evaluation.ensureDefaults();
    const [concepts, levels] = await Promise.all([this.evaluation.adminConcepts(), this.evaluation.adminLevels()]);
    return { concepts, levels };
  }

  @Post("evaluation/concepts")
  createEvalConcept(@Body() body: { label?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.evaluation.createConcept(body.label || "", user, req.ip);
  }

  @Put("evaluation/concepts/:id")
  updateEvalConcept(
    @Param("id") id: string,
    @Body() body: { label?: string; sortOrder?: number; active?: boolean; archived?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.evaluation.updateConcept(id, body, user, req.ip);
  }

  @Post("evaluation/levels")
  createEvalLevel(@Body() body: { label?: string; color?: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.evaluation.createLevel(body, user, req.ip);
  }

  @Put("evaluation/levels/:id")
  updateEvalLevel(
    @Param("id") id: string,
    @Body() body: { label?: string; color?: string; sortOrder?: number; active?: boolean; archived?: boolean },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.evaluation.updateLevel(id, body, user, req.ip);
  }
}
