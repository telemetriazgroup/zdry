import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Prisma, Role, RiskGrade } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "./prisma.service";
import { DEFAULT_LAYOUT_RULES, DEFAULT_YARD_CONFIG } from "../domain/yard";
import { DEFAULT_PRICING_RULES, computeListPrices } from "../domain/pricing";
import { DEFAULT_VISIBILITY_RULES } from "../domain/visibility";
import { DEFAULT_PAYMENT_ACCOUNTS } from "../domain/payment-accounts";

const PASSWORD = process.env.SEED_PASSWORD || "Zdry123!";

const TYPES = [
  { code: "20GP", label: "20' Standard Dry", dims: "20'×8'×8'6\"", color: "#1971c2" },
  { code: "40GP", label: "40' Standard Dry", dims: "40'×8'×8'6\"", color: "#1971c2" },
  { code: "40HC", label: "40' High Cube", dims: "40'×8'×9'6\"", color: "#0c8599" },
  { code: "45HC", label: "45' High Cube", dims: "45'×8'×9'6\"", color: "#0c8599" },
  { code: "20OT", label: "20' Open Top", dims: "20'×8'×8'6\"", color: "#c9720b" },
  { code: "40OT", label: "40' Open Top", dims: "40'×8'×8'6\"", color: "#c9720b" },
  { code: "20FR", label: "20' Flat Rack", dims: "20'×8'×8'6\"", color: "#5c6370" },
  { code: "40FR", label: "40' Flat Rack", dims: "40'×8'×8'6\"", color: "#5c6370" },
  { code: "HT", label: "Hardtop Container", dims: "20'/40'×8'×8'6\"", color: "#495057" },
];

const CATEGORIES = [
  { code: "1TRIP", label: "Nuevo / 1-Trip", color: "#2f9e44" },
  { code: "CW", label: "Cargo Worthy", color: "#1971c2" },
  { code: "WWT", label: "Wind & Water Tight", color: "#0c8599" },
  { code: "ASIS", label: "As Is / Damaged", color: "#c9720b" },
];

const DEPOTS = [
  { name: "Patio Callao", city: "Callao", address: "Av. Néstor Gambetta 5500", dailyRateTeu: 1.6, lat: -12.0432, lng: -77.1469 },
  { name: "Patio Ventanilla", city: "Ventanilla", address: "Panamericana Norte km 25", dailyRateTeu: 1.3, lat: -11.8756, lng: -77.1281 },
  { name: "Patio Lurín", city: "Lurín", address: "Panamericana Sur km 35", dailyRateTeu: 1.1, lat: -12.2745, lng: -76.872 },
  { name: "Patio Paita", city: "Paita", address: "Zona Industrial Paita", dailyRateTeu: 1.0, lat: -5.0892, lng: -81.1144 },
];

const USERS: { email: string; name: string; role: Role }[] = [
  { email: "admin@zdry.pe", name: "Ana Admin", role: "admin" },
  { email: "gerente@zdry.pe", name: "Gabriel Gerente", role: "gerente" },
  { email: "vendedor@zdry.pe", name: "Valeria Vendedor", role: "vendedor" },
  { email: "compras@zdry.pe", name: "Carlos Compras", role: "compras" },
  { email: "almacen@zdry.pe", name: "Lucía Almacén", role: "almacen" },
];

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly log = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const hash = await argon2.hash(PASSWORD);

    for (const u of USERS) {
      await this.prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, active: true },
        create: { ...u, passwordHash: hash },
      });
    }

    for (const t of TYPES) {
      await this.prisma.containerType.upsert({
        where: { code: t.code },
        update: { label: t.label, dims: t.dims, color: t.color, protected: true },
        create: { ...t, protected: true },
      });
    }

    for (const c of CATEGORIES) {
      await this.prisma.category.upsert({
        where: { code: c.code },
        update: { label: c.label, color: c.color, protected: true },
        create: { ...c, protected: true },
      });
    }

    const depotCount = await this.prisma.depot.count();
    if (depotCount === 0) {
      await this.prisma.depot.createMany({ data: DEPOTS.map((d) => ({ ...d, protected: true })) });
    }

    if ((await this.prisma.customer.count()) === 0) {
      await this.prisma.customer.createMany({
        data: [
          { rucDni: "20123456789", companyName: "Logística Andina SAC", email: "compras@andina.pe", phone: "+51 999 111 222", risk: RiskGrade.A },
          { rucDni: "20987654321", companyName: "Minera del Sur", email: "logistica@mds.pe", phone: "+51 988 333 444", risk: RiskGrade.C },
        ],
      });
    }

    const providers = [
      { name: "CIMC", type: "Fabricante Contenedor", rate: 0, unit: "unidad" },
      { name: "Agente Aduanas Callao", type: "Agente Aduana", rate: 180, unit: "DAM" },
      { name: "Transporte Callao", type: "Transporte", rate: 0, unit: "viaje" },
      { name: "Almacén Extraportuario Callao", type: "Almacén Extraportuario", rate: 0, unit: "unidad" },
      { name: "Agente Portuario Callao", type: "Agente Portuario", rate: 0, unit: "servicio" },
    ];
    for (const p of providers) {
      const exists = await this.prisma.provider.findFirst({ where: { name: p.name } });
      if (!exists) await this.prisma.provider.create({ data: p });
    }

    await this.prisma.appSetting.upsert({
      where: { key: "layout_rules" },
      update: {},
      create: { key: "layout_rules", value: DEFAULT_LAYOUT_RULES as Prisma.InputJsonValue },
    });
    await this.prisma.appSetting.upsert({
      where: { key: "payment_accounts" },
      update: {},
      create: { key: "payment_accounts", value: DEFAULT_PAYMENT_ACCOUNTS as Prisma.InputJsonValue },
    });
    await this.prisma.appSetting.upsert({
      where: { key: "yard_config" },
      update: {},
      create: {
        key: "yard_config",
        value: {
          lados: [...DEFAULT_YARD_CONFIG.lados],
          rumas: DEFAULT_YARD_CONFIG.rumas,
          columnas: DEFAULT_YARD_CONFIG.columnas,
          niveles: DEFAULT_YARD_CONFIG.niveles,
        },
      },
    });

    if ((await this.prisma.pricingRule.count()) === 0) {
      await this.prisma.pricingRule.createMany({
        data: DEFAULT_PRICING_RULES.map((r) => ({
          scope: r.scope,
          target: r.target,
          marginPct: r.marginPct,
          maxDiscountPct: r.maxDiscountPct,
        })),
      });
    }
    if ((await this.prisma.visibilityRule.count()) === 0) {
      await this.prisma.visibilityRule.createMany({
        data: DEFAULT_VISIBILITY_RULES.map((r) => ({ scope: r.scope, target: r.target, show: r.show })),
      });
    }
    const services = [
      { name: "Pintado exterior", price: 180 },
      { name: "Transporte adicional (movimiento extra)", price: 220 },
      { name: "Sellado / precintado de seguridad", price: 35 },
      { name: "Reparación estética a pedido del cliente", price: 150 },
      { name: "Fumigación certificada", price: 90 },
      { name: "Instalación de accesorios (rejillas, ganchos)", price: 60 },
    ];
    for (const s of services) {
      const exists = await this.prisma.commercialService.findFirst({ where: { name: s.name } });
      if (!exists) await this.prisma.commercialService.create({ data: s });
    }

    const andina = await this.prisma.customer.findFirst({ where: { companyName: "Logística Andina SAC" } });
    if (andina) {
      await this.prisma.user.upsert({
        where: { email: "cliente@andina.pe" },
        update: { name: "Compras Andina", role: "cliente", active: true, customerId: andina.id },
        create: {
          email: "cliente@andina.pe",
          passwordHash: hash,
          name: "Compras Andina",
          role: "cliente",
          customerId: andina.id,
        },
      });
    }

    const pricing = await this.prisma.pricingRule.findMany();
    const rules = pricing.length
      ? pricing.map((r) => ({
          scope: r.scope,
          target: r.target,
          marginPct: Number(r.marginPct),
          maxDiscountPct: Number(r.maxDiscountPct),
        }))
      : DEFAULT_PRICING_RULES;
    const toPrice = await this.prisma.container.findMany({
      where: { intakeType: "compra", physicallyReceived: true, priceList: null },
    });
    for (const c of toPrice) {
      const p = computeListPrices(
        { iso: c.iso, type: c.type, cat: c.cat, manufacturer: c.manufacturer, fobCif: Number(c.fobCif) },
        rules,
      );
      await this.prisma.container.update({
        where: { iso: c.iso },
        data: { priceList: p.priceList, priceMin: p.priceMin },
      });
    }

    this.log.log(`Seed listo. Usuarios: ${USERS.map((u) => u.email).join(", ")}, cliente@andina.pe / clave ${PASSWORD}`);
  }
}
