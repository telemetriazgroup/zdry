import { gzipSync, gunzipSync } from "zlib";
import { randomUUID } from "crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, RiskGrade } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser } from "../auth/auth.types";
import { computeListPrices, DEFAULT_PRICING_RULES } from "../domain/pricing";
import {
  bestSlotFor,
  DEFAULT_LAYOUT_RULES,
  DEFAULT_YARD_CONFIG,
  normalizeLayoutRules,
  type YardUnit,
} from "../domain/yard";
import { fetchDemoPhotoSet, photoCreditLine, type FetchedPhoto } from "./demo-images";
import {
  DEMO_CUSTOMERS,
  DEMO_ISOS,
  DEMO_PASSWORD,
  DEMO_UNITS,
  pickDepot,
  type DemoDepotRef,
} from "./demo-dataset";

const PROTECTED_EMAILS = [
  "admin@zdry.pe",
  "gerente@zdry.pe",
  "vendedor@zdry.pe",
  "compras@zdry.pe",
  "almacen@zdry.pe",
  "cliente@andina.pe",
];

const SNAPSHOT_VERSION = 1;
const HOLD_MS = 48 * 60 * 60 * 1000;

function snapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function toYard(c: {
  iso: string;
  type: string;
  cat: string;
  manufacturer: string;
  depotId: string;
  lado: string | null;
  ruma: number | null;
  columna: number | null;
  nivel: number | null;
  status: string;
  physicallyReceived: boolean;
}): YardUnit {
  return { ...c };
}

@Injectable()
export class DemoService {
  private readonly log = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async publicStatus() {
    return { on: await this.prisma.demoOn() };
  }

  async status() {
    const [on, loaded, containers, customers, quotes, invoices, backups] = await Promise.all([
      this.prisma.demoOn(),
      this.prisma.demoLoaded(),
      this.prisma.container.count({ where: { demo: true } }),
      this.prisma.customer.count({ where: { demo: true } }),
      this.prisma.quote.count({ where: { demo: true } }),
      this.prisma.purchaseInvoice.count({ where: { demo: true } }),
      this.prisma.dataBackup.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return {
      on,
      loaded,
      coexistence:
        "Los datos demo se etiquetan y conviven con producción. En modo producción se ocultan; no se borran salvo que elijas vaciar demo.",
      counts: { containers, customers, quotes, invoices },
      isos: Object.values(DEMO_ISOS),
      demoLogins: DEMO_CUSTOMERS.filter((c) => c.user).map((c) => ({
        email: c.user!.email,
        password: DEMO_PASSWORD,
        company: c.companyName,
      })),
      backups,
      photoNote:
        "Las fotos se descargan de Wikimedia Commons (CC BY-SA) al cargar el dataset. Créditos quedan en las notas de inspección.",
    };
  }

  async activate(user: AuthUser, ip?: string) {
    const loaded = await this.prisma.demoLoaded();
    if (!loaded) {
      await this.createBackup("Antes de activar modo demo", "pre_demo", user);
      const load = await this.loadDataset(user);
      await this.prisma.setDemoLoaded(true);
      this.log.log(`Dataset demo cargado: ${JSON.stringify(load)}`);
    }
    await this.parkDemoUnits();
    await this.prisma.user.updateMany({
      where: { demo: true, email: { notIn: PROTECTED_EMAILS } },
      data: { active: true },
    });
    await this.prisma.setDemoMode(true);
    await this.audit.log({
      user,
      action: "demo_activate",
      entity: "AppSetting",
      entityId: "demo_mode",
      after: { on: true },
      ip,
    });
    return this.status();
  }

  async toProduction(user: AuthUser, ip?: string) {
    await this.unparkDemoUnits();
    await this.prisma.user.updateMany({
      where: { demo: true, email: { notIn: PROTECTED_EMAILS } },
      data: { active: false },
    });
    await this.prisma.setDemoMode(false);
    await this.audit.log({
      user,
      action: "demo_production",
      entity: "AppSetting",
      entityId: "demo_mode",
      after: { on: false },
      ip,
    });
    return this.status();
  }

  async reload(user: AuthUser, ip?: string) {
    const wasOn = await this.prisma.demoOn();
    await this.createBackup("Antes de recargar dataset demo", "pre_reload", user);
    await this.purgeDemoRows();
    const load = await this.loadDataset(user);
    await this.prisma.setDemoLoaded(true);
    if (wasOn) {
      await this.parkDemoUnits();
      await this.prisma.setDemoMode(true);
    }
    await this.audit.log({
      user,
      action: "demo_reload",
      entity: "AppSetting",
      entityId: "demo_loaded",
      after: load as object,
      ip,
    });
    return { ...await this.status(), load };
  }

  async purge(user: AuthUser, ip?: string) {
    await this.createBackup("Antes de vaciar datos demo", "pre_purge", user);
    const removed = await this.purgeDemoRows();
    await this.prisma.setDemoMode(false);
    await this.prisma.setDemoLoaded(false);
    await this.audit.log({
      user,
      action: "demo_purge",
      entity: "AppSetting",
      entityId: "demo_loaded",
      after: removed as object,
      ip,
    });
    return { ...await this.status(), removed };
  }

  async createBackup(label: string, kind: string, user?: AuthUser) {
    const payload = await this.buildSnapshot();
    const buf = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const id = randomUUID();
    const storageKey = `backups/${id}.json.gz`;
    await this.storage.put(storageKey, buf, "application/gzip");
    const row = await this.prisma.dataBackup.create({
      data: {
        id,
        label,
        kind,
        storageKey,
        sizeBytes: buf.length,
        createdBy: user?.id || null,
        notes: {
          containers: (payload.tables.containers as unknown[]).length,
          quotes: (payload.tables.quotes as unknown[]).length,
          customers: (payload.tables.customers as unknown[]).length,
        },
      },
    });
    return row;
  }

  async listBackups() {
    return this.prisma.dataBackup.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  async restore(id: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.dataBackup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Backup no encontrado.");
    const { buffer } = await this.storage.getBuffer(row.storageKey);
    const json = JSON.parse(gunzipSync(buffer).toString("utf8")) as Snapshot;
    await this.applySnapshot(json);
    this.prisma.clearDemoCache();
    await this.audit.log({
      user,
      action: "demo_restore",
      entity: "DataBackup",
      entityId: id,
      after: { label: row.label, kind: row.kind },
      ip,
    });
    return { ok: true, restored: row, status: await this.status() };
  }

  private async buildSnapshot(): Promise<Snapshot> {
    const [
      customers,
      users,
      providers,
      depots,
      containerTypes,
      categories,
      invoices,
      invoiceLines,
      pendingExtras,
      purchaseDocuments,
      containers,
      photos,
      history,
      positions,
      quotes,
      quoteLines,
      quoteExtras,
      messages,
      vouchers,
      events,
      odooJobs,
      dispatches,
      pricingRules,
      visibilityRules,
      commercialServices,
      appSettings,
    ] = await Promise.all([
      this.prisma.customer.findMany(),
      this.prisma.user.findMany(),
      this.prisma.provider.findMany(),
      this.prisma.depot.findMany(),
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.prisma.purchaseInvoice.findMany(),
      this.prisma.purchaseInvoiceLine.findMany(),
      this.prisma.pendingExtraCost.findMany(),
      this.prisma.purchaseDocument.findMany(),
      this.prisma.container.findMany(),
      this.prisma.inspectionPhoto.findMany(),
      this.prisma.containerHistory.findMany(),
      this.prisma.containerPosition.findMany(),
      this.prisma.quote.findMany(),
      this.prisma.quoteLine.findMany(),
      this.prisma.quoteExtra.findMany(),
      this.prisma.dealMessage.findMany(),
      this.prisma.paymentVoucher.findMany(),
      this.prisma.quoteEvent.findMany(),
      this.prisma.odooSyncJob.findMany(),
      this.prisma.dispatch.findMany(),
      this.prisma.pricingRule.findMany(),
      this.prisma.visibilityRule.findMany(),
      this.prisma.commercialService.findMany(),
      this.prisma.appSetting.findMany(),
    ]);
    const safeUsers = users.map(({ refreshTokenHash: _r, ...u }) => ({ ...u, refreshTokenHash: null }));
    return {
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      tables: snapshot({
        customers,
        users: safeUsers,
        providers,
        depots,
        containerTypes,
        categories,
        invoices,
        invoiceLines,
        pendingExtras,
        purchaseDocuments,
        containers,
        photos,
        history,
        positions,
        quotes,
        quoteLines,
        quoteExtras,
        messages,
        vouchers,
        events,
        odooJobs,
        dispatches,
        pricingRules,
        visibilityRules,
        commercialServices,
        appSettings,
      }) as Snapshot["tables"],
    };
  }

  private async applySnapshot(snap: Snapshot) {
    const t = snap.tables;
    const upsert = async (rows: { id: string }[] | undefined, delegate: { upsert: (args: never) => Promise<unknown> }) => {
      for (const row of rows || []) {
        try {
          await delegate.upsert({ where: { id: row.id }, create: row, update: row } as never);
        } catch (e) {
          this.log.warn(`restore skip ${row.id}: ${(e as Error).message}`);
        }
      }
    };

    for (const row of t.customers || []) {
      try {
        await this.prisma.customer.upsert({ where: { id: row.id }, create: row as never, update: row as never });
      } catch (e) {
        this.log.warn(`customer ${row.id}: ${(e as Error).message}`);
      }
    }
    for (const row of t.users || []) {
      const data = { ...(row as Record<string, unknown>), refreshTokenHash: null };
      try {
        await this.prisma.user.upsert({ where: { id: row.id }, create: data as never, update: data as never });
      } catch (e) {
        this.log.warn(`user ${row.id}: ${(e as Error).message}`);
      }
    }
    for (const row of t.providers || []) {
      try {
        await this.prisma.provider.upsert({ where: { id: row.id }, create: row as never, update: row as never });
      } catch (e) {
        this.log.warn(`provider ${(e as Error).message}`);
      }
    }
    for (const row of t.depots || []) {
      try {
        await this.prisma.depot.upsert({ where: { id: row.id }, create: row as never, update: row as never });
      } catch (e) {
        this.log.warn(`depot ${(e as Error).message}`);
      }
    }
    for (const row of t.containerTypes || []) {
      try {
        await this.prisma.containerType.upsert({
          where: { code: row.code },
          create: row as never,
          update: row as never,
        });
      } catch (e) {
        this.log.warn(`type ${row.code}: ${(e as Error).message}`);
      }
    }
    for (const row of t.categories || []) {
      try {
        await this.prisma.category.upsert({
          where: { code: row.code },
          create: row as never,
          update: row as never,
        });
      } catch (e) {
        this.log.warn(`cat ${row.code}: ${(e as Error).message}`);
      }
    }
    await upsert(t.invoices, this.prisma.purchaseInvoice);
    await upsert(t.invoiceLines, this.prisma.purchaseInvoiceLine);
    await upsert(t.pendingExtras, this.prisma.pendingExtraCost);
    await upsert(t.purchaseDocuments, this.prisma.purchaseDocument);

    for (const row of t.containers || []) {
      try {
        await this.prisma.container.upsert({
          where: { iso: row.iso },
          create: row as never,
          update: row as never,
        });
      } catch (e) {
        this.log.warn(`container ${row.iso}: ${(e as Error).message}`);
      }
    }
    await upsert(t.photos, this.prisma.inspectionPhoto);
    await upsert(t.history, this.prisma.containerHistory);
    await upsert(t.positions, this.prisma.containerPosition);
    await upsert(t.quotes, this.prisma.quote);
    await upsert(t.quoteLines, this.prisma.quoteLine);
    await upsert(t.quoteExtras, this.prisma.quoteExtra);
    await upsert(t.messages, this.prisma.dealMessage);
    await upsert(t.vouchers, this.prisma.paymentVoucher);
    await upsert(t.events, this.prisma.quoteEvent);
    await upsert(t.odooJobs, this.prisma.odooSyncJob);
    await upsert(t.dispatches, this.prisma.dispatch);
    await upsert(t.pricingRules, this.prisma.pricingRule);
    await upsert(t.visibilityRules, this.prisma.visibilityRule);
    await upsert(t.commercialServices, this.prisma.commercialService);
    for (const row of t.appSettings || []) {
      try {
        await this.prisma.appSetting.upsert({
          where: { key: row.key },
          create: row as never,
          update: { value: row.value as Prisma.InputJsonValue },
        });
      } catch (e) {
        this.log.warn(`setting ${row.key}: ${(e as Error).message}`);
      }
    }
  }

  private async purgeDemoRows() {
    const quotes = await this.prisma.quote.findMany({ where: { demo: true }, select: { id: true } });
    const qids = quotes.map((q) => q.id);
    if (qids.length) {
      await this.prisma.dispatch.deleteMany({ where: { quoteId: { in: qids } } });
    }
    await this.prisma.quote.deleteMany({ where: { demo: true } });

    const containers = await this.prisma.container.findMany({
      where: { demo: true },
      include: { photos: true },
    });
    for (const c of containers) {
      for (const p of c.photos) {
        try {
          await this.storage.delete(p.storageKey);
        } catch {
          /* orphan ok */
        }
        if (c.video360Key) {
          try {
            await this.storage.delete(c.video360Key);
          } catch {
            /* */
          }
        }
      }
    }
    const isos = containers.map((c) => c.iso);
    if (isos.length) {
      await this.prisma.container.updateMany({
        where: { iso: { in: isos } },
        data: { purchaseInvoiceId: null, reservedQuoteId: null, ownerCustomerId: null },
      });
    }
    await this.prisma.container.deleteMany({ where: { demo: true } });
    await this.prisma.purchaseInvoice.deleteMany({ where: { demo: true } });
    await this.prisma.user.deleteMany({
      where: { demo: true, email: { notIn: PROTECTED_EMAILS } },
    });
    await this.prisma.customer.deleteMany({ where: { demo: true } });
    return { quotes: qids.length, containers: containers.length };
  }

  private async loadDataset(user: AuthUser) {
    const depots = (await this.prisma.depot.findMany()) as DemoDepotRef[];
    if (!depots.length) throw new NotFoundException("No hay depósitos para cargar el dataset demo.");
    const admin = await this.prisma.user.findUnique({ where: { email: "admin@zdry.pe" } });
    const vendor = await this.prisma.user.findUnique({ where: { email: "vendedor@zdry.pe" } });
    const hash = await argon2.hash(DEMO_PASSWORD);
    const photos = await fetchDemoPhotoSet();
    this.log.log(`Fotos Wikimedia descargadas: ${photos.length}/${9}`);
    const credit = photoCreditLine(photos);

    const customers: Record<string, string> = {};
    for (const c of DEMO_CUSTOMERS) {
      const existingCust = await this.prisma.customer.findFirst({ where: { email: c.email, demo: true } });
      const row =
        existingCust ||
        (await this.prisma.customer.create({
          data: {
            rucDni: c.rucDni,
            companyName: c.companyName,
            email: c.email,
            phone: c.phone,
            risk: c.risk as RiskGrade,
            demo: true,
          },
        }));
      customers[c.key] = row.id;
      if (c.user) {
        await this.prisma.user.upsert({
          where: { email: c.user.email },
          update: { name: c.user.name, role: "cliente", customerId: row.id, demo: true, active: true },
          create: {
            email: c.user.email,
            name: c.user.name,
            role: "cliente",
            passwordHash: hash,
            customerId: row.id,
            demo: true,
            active: true,
          },
        });
      }
    }

    const inv1 =
      (await this.prisma.purchaseInvoice.findFirst({ where: { number: "F-DEMO-1001", demo: true } })) ||
      (await this.prisma.purchaseInvoice.create({
        data: {
          number: "F-DEMO-1001",
          providerName: "CIMC",
          incoterm: "CIF",
          logistics: "reentrega",
          amount: 20050,
          extras: { gate_in: { enabled: true } },
          demo: true,
          lines: {
            create: DEMO_UNITS.filter((u) => u.intakeType === "compra" && u.iso !== DEMO_ISOS.pendingInvoice).map((u) => ({
              iso: u.iso,
              type: u.type,
              cat: u.cat,
              year: u.year,
              manufacturer: u.manufacturer,
              price: u.fobCif,
              bl: u.bl || "",
              manifest: u.manifest || "",
            })),
          },
        },
      }));
    const inv2 =
      (await this.prisma.purchaseInvoice.findFirst({ where: { number: "F-DEMO-1002", demo: true } })) ||
      (await this.prisma.purchaseInvoice.create({
        data: {
          number: "F-DEMO-1002",
          providerName: "CIMC",
          incoterm: "FOB",
          logistics: "recojo_flete",
          amount: 4500,
          extras: { transporte: { enabled: true } },
          demo: true,
          lines: {
            create: [
              {
                iso: DEMO_ISOS.pendingInvoice,
                type: "40HC",
                cat: "1TRIP",
                year: 2023,
                manufacturer: "CIMC",
                price: 4500,
                bl: "MSCU9000441",
                manifest: "MAN-2026-446",
              },
            ],
          },
          pendingExtras: {
            create: {
              serviceKey: "transporte_callao",
              serviceLabel: "Traslado Callao → patio (demo)",
              suggestedProvider: "Transporte Callao",
              isos: [DEMO_ISOS.pendingInvoice],
              status: "pending",
            },
          },
        },
      }));

    const pricing = await this.loadPricing();
    let photoIndex = 0;
    const used: FetchedPhoto[] = [];

    for (const plan of DEMO_UNITS) {
      const depot = pickDepot(depots, plan.depotName);
      const prices = computeListPrices(
        { iso: plan.iso, type: plan.type, cat: plan.cat, manufacturer: plan.manufacturer, fobCif: plan.fobCif },
        pricing,
      );
      const invoiceId =
        plan.intakeType === "almacenaje_cliente"
          ? null
          : plan.iso === DEMO_ISOS.pendingInvoice
            ? inv2.id
            : inv1.id;
      const existing = await this.prisma.container.findUnique({ where: { iso: plan.iso } });
      if (existing) continue;
      await this.prisma.container.create({
        data: {
          iso: plan.iso,
          type: plan.type,
          cat: plan.cat,
          status: plan.status,
          year: plan.year,
          manufacturer: plan.manufacturer,
          color: plan.color,
          depotId: depot.id,
          tareKg: plan.tareKg,
          mgwKg: plan.mgwKg,
          payloadKg: plan.payloadKg,
          inspectionNotes: [plan.inspection, credit].filter(Boolean).join(" "),
          physicallyReceived: plan.physicallyReceived,
          intakeType: plan.intakeType,
          invoicePending: !!plan.invoicePending,
          fobCif: plan.fobCif,
          priceList: plan.intakeType === "almacenaje_cliente" ? null : prices.priceList,
          priceMin: plan.intakeType === "almacenaje_cliente" ? null : prices.priceMin,
          damNumber: plan.damNumber ?? null,
          nationalizedAt: plan.damNumber ? new Date() : null,
          bl: plan.bl || "",
          manifest: plan.manifest || "",
          purchaseInvoiceId: invoiceId,
          ownerCustomerId: plan.ownerKey ? customers[plan.ownerKey] : null,
          commercialStatus: plan.reserved ? "reservado" : plan.status === "En custodia" ? "custodia" : "disponible",
          physicalStatus: plan.physicallyReceived ? "en_patio" : "en_transito_ingreso",
          mediaStatus: plan.approveMedia ? "aprobado" : "pendiente",
          mediaApprovedAt: plan.approveMedia ? new Date() : null,
          mediaApprovedBy: plan.approveMedia ? admin?.id || user.id : null,
          showPriceOverride: plan.manufacturer === "CIMC" ? true : null,
          demo: true,
          registeredByName: "Sistema (demo)",
          history: {
            create: { type: "Demo", detail: "Unidad cargada por modo demostración (convive con producción)." },
          },
        },
      });

      const nPhotos = Math.min(plan.photoSlots, photos.length);
      for (let s = 0; s < nPhotos; s++) {
        const src = photos[(photoIndex + s) % photos.length];
        used.push(src);
        const key = `warehouse/${plan.iso}/photo-${s}.${src.ext}`;
        await this.storage.put(key, src.buffer, src.mime);
        await this.prisma.inspectionPhoto.create({
          data: {
            iso: plan.iso,
            slot: s,
            storageKey: key,
            mimeType: src.mime,
            originalName: src.originalName,
            sizeBytes: src.buffer.length,
          },
        });
      }
      photoIndex += 1;
    }

    if (vendor) {
      const puerto = customers.puerto;
      const agro = customers.agro;
      const u1 = await this.prisma.container.findUnique({ where: { iso: DEMO_ISOS.saleHcCallao } });
      const u2 = await this.prisma.container.findUnique({ where: { iso: DEMO_ISOS.saleHcPaita } });
      const u3 = await this.prisma.container.findUnique({ where: { iso: DEMO_ISOS.reservedOt } });
      if (u1 && puerto && !(await this.prisma.quote.findUnique({ where: { number: "COT-DEMO-0001" } }))) {
        await this.prisma.quote.create({
          data: {
            number: "COT-DEMO-0001",
            kind: "venta",
            dealStatus: "nueva",
            customerId: puerto,
            vendorId: vendor.id,
            demo: true,
            lines: {
              create: {
                iso: u1.iso,
                type: u1.type,
                cat: u1.cat,
                listPrice: Number(u1.priceList || 0),
                minPrice: Number(u1.priceMin || 0),
                priceNet: Number(u1.priceList || 0),
              },
            },
            events: { create: { type: "creada", detail: "Cotización demo — bandeja nueva." } },
            messages: {
              create: {
                authorRole: "cliente",
                authorName: "Rosa Compras — Puerto Verde",
                body: "¿Pueden incluir el flete a un almacén en Ate y confirmar disponibilidad esta semana?",
              },
            },
          },
        });
      }
      if (u2 && agro && !(await this.prisma.quote.findUnique({ where: { number: "COT-DEMO-0002" } }))) {
        await this.prisma.quote.create({
          data: {
            number: "COT-DEMO-0002",
            kind: "venta",
            dealStatus: "cotizada",
            customerId: agro,
            vendorId: vendor.id,
            demo: true,
            lines: {
              create: {
                iso: u2.iso,
                type: u2.type,
                cat: u2.cat,
                listPrice: Number(u2.priceList || 0),
                minPrice: Number(u2.priceMin || 0),
                priceNet: Number(u2.priceList || 0),
                frozenAt: new Date(),
              },
            },
            events: {
              create: [
                { type: "creada", detail: "Solicitud demo." },
                { type: "cotizada", detail: "Estado nueva → cotizada" },
              ],
            },
            messages: {
              create: {
                authorRole: "vendedor",
                authorName: "Valeria Vendedor",
                body: "Cotización enviada. El 45HC 1-trip en Paita está listo para retiro o flete consolidado.",
              },
            },
          },
        });
      }
      if (u3 && puerto && !(await this.prisma.quote.findUnique({ where: { number: "COT-DEMO-0003" } }))) {
        const q3 = await this.prisma.quote.create({
          data: {
            number: "COT-DEMO-0003",
            kind: "venta",
            dealStatus: "reservada",
            customerId: puerto,
            vendorId: vendor.id,
            demo: true,
            holdExpiresAt: new Date(Date.now() + HOLD_MS),
            lines: {
              create: {
                iso: u3.iso,
                type: u3.type,
                cat: u3.cat,
                listPrice: Number(u3.priceList || 0),
                minPrice: Number(u3.priceMin || 0),
                priceNet: Number(u3.priceList || 0),
                frozenAt: new Date(),
              },
            },
            events: {
              create: [
                { type: "creada", detail: "Solicitud demo." },
                { type: "cotizada", detail: "Estado nueva → cotizada" },
                { type: "reservada", detail: "Hold 48 h demo" },
              ],
            },
          },
        });
        await this.prisma.container.update({
          where: { iso: u3.iso },
          data: {
            status: "Reservado",
            reservedBy: "Puerto Verde Logística SAC",
            reservedQuoteId: q3.id,
            reservationExpiry: new Date(Date.now() + HOLD_MS),
          },
        });
      }
    }

    void used;
    return {
      photos: photos.length,
      containers: DEMO_UNITS.length,
      customers: DEMO_CUSTOMERS.length,
      invoices: 2,
      quotes: 3,
    };
  }

  private async parkDemoUnits() {
    const rulesRow = await this.prisma.appSetting.findUnique({ where: { key: "layout_rules" } });
    const rules = normalizeLayoutRules(rulesRow?.value) || DEFAULT_LAYOUT_RULES;
    const plans = DEMO_UNITS.filter((u) => u.park);
    for (const plan of plans) {
      const unit = await this.prisma.container.findUnique({ where: { iso: plan.iso } });
      if (!unit || unit.lado) continue;
      const occupants = (
        await this.prisma.container.findMany({ where: { depotId: unit.depotId, lado: { not: null } } })
      ).map(toYard);
      const slot = bestSlotFor(occupants, unit.depotId, unit.type, unit.cat, DEFAULT_YARD_CONFIG, rules);
      if (!slot) {
        this.log.warn(`Sin slot de patio para ${unit.iso}`);
        continue;
      }
      await this.prisma.container.update({
        where: { iso: unit.iso },
        data: {
          lado: slot.lado,
          ruma: slot.ruma,
          columna: slot.columna,
          nivel: slot.nivel,
          physicallyReceived: true,
          ...(unit.status === "Pendiente de ingreso" ? { status: "Disponible" } : {}),
        },
      });
      await this.prisma.containerPosition.create({
        data: {
          iso: unit.iso,
          depotId: unit.depotId,
          lado: slot.lado,
          ruma: slot.ruma,
          columna: slot.columna,
          nivel: slot.nivel,
        },
      });
    }
  }

  private async unparkDemoUnits() {
    const parked = await this.prisma.container.findMany({
      where: { demo: true, lado: { not: null } },
      select: { iso: true },
    });
    if (!parked.length) return;
    await this.prisma.containerPosition.updateMany({
      where: { closedAt: null, iso: { in: parked.map((p) => p.iso) } },
      data: { closedAt: new Date() },
    });
    await this.prisma.container.updateMany({
      where: { demo: true },
      data: { lado: null, ruma: null, columna: null, nivel: null },
    });
  }

  private async loadPricing() {
    const rows = await this.prisma.pricingRule.findMany();
    if (!rows.length) return DEFAULT_PRICING_RULES;
    return rows.map((r) => ({
      scope: r.scope,
      target: r.target,
      marginPct: Number(r.marginPct),
      maxDiscountPct: Number(r.maxDiscountPct),
    }));
  }
}

type Snapshot = {
  version: number;
  createdAt: string;
  tables: {
    customers?: { id: string }[];
    users?: { id: string; email: string }[];
    providers?: { id: string }[];
    depots?: { id: string }[];
    containerTypes?: { code: string }[];
    categories?: { code: string }[];
    invoices?: { id: string }[];
    invoiceLines?: { id: string }[];
    pendingExtras?: { id: string }[];
    purchaseDocuments?: { id: string }[];
    containers?: { iso: string }[];
    photos?: { id: string }[];
    history?: { id: string }[];
    positions?: { id: string }[];
    quotes?: { id: string }[];
    quoteLines?: { id: string }[];
    quoteExtras?: { id: string }[];
    messages?: { id: string }[];
    vouchers?: { id: string }[];
    events?: { id: string }[];
    odooJobs?: { id: string }[];
    dispatches?: { id: string }[];
    pricingRules?: { id: string }[];
    visibilityRules?: { id: string }[];
    commercialServices?: { id: string }[];
    appSettings?: { key: string; value: Prisma.JsonValue }[];
  };
};
