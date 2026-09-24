import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  StreamableFile,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { YardLockService } from "../redis/yard-lock.service";
import { DealCloseService } from "../deal-close/deal-close.service";
import { SunatRucService } from "./sunat-ruc.service";
import { QuoteIssueWorker } from "../odoo-import/quote-issue-worker.service";
import { QuotePdfService } from "../odoo-import/quote-pdf.service";
import { QuoteAmendService } from "../odoo-import/quote-amend.service";
import { SaleCloseWorker } from "../odoo-import/sale-close-worker.service";
import { RentIssueWorker } from "../odoo-import/rent-issue-worker.service";
import { RentCloseWorker } from "../odoo-import/rent-close-worker.service";
import { presupuestoFilename } from "../domain/odoo-quote-pdf";
import { QUOTE_ISSUE_EVENT } from "../domain/quote-issue-draft";
import { SALE_CLOSE_EVENT, quoteSemaphore } from "../domain/quote-sale-close";
import { RENT_ISSUE_EVENT, canAmendRentQuota, contractEndDate } from "../domain/quote-rent-draft";
import { RENT_CLOSE_EVENT, rentSemaphore } from "../domain/quote-rent-close";
import {
  assertCanRegisterPedido,
  assertOdooQuoteForPedido,
  assertPedidoKeepsOdooDraft,
  clientOrderDisplay,
  PEDIDO_EVENT,
  pedidoEventDetail,
  pedidoRegistered,
  QuotePedidoError,
} from "../domain/quote-pedido";
import {
  amendConflictBody,
  canAmendOdoo,
  QuoteAmendError,
} from "../domain/quote-amend";
import { quoteTimeline, revisionDiffSummary, yardDispatchReady } from "../domain/quote-odoo-timeline";
import { AuthUser } from "../auth/auth.types";
import { type DealStatus, holdClockPaused } from "../deal-close/deal-close.types";
import { applyShowPrice, DEFAULT_VISIBILITY_RULES, type VisibilityRule } from "../domain/visibility";
import { isMediaApproved, PHOTO_STATUS_ACTIVE } from "../domain/catalog-media";
import { loadDefaultWatermark } from "../domain/watermark";
import { Readable } from "stream";
import { CATALOG_COPY_KEY, normalizeCatalogCopy } from "../domain/catalog-copy";
import { CATALOG_COMMERCE_KEY, normalizeCatalogCommerce, publicQuotesBlockedMessage } from "../domain/catalog-commerce";
import { ACTIVE_MASTER } from "../domain/masters";
import { isOwnSaleStock } from "../domain/iso6346";
import { isPendingValuation, pendingValuationWhere } from "../domain/odoo-reconcile";
import { presentDryReferential } from "../odoo-import/dry-referential.store";
import { loadOverlayConcepts, loadSafetyMarginRules, overlayUnitFrom } from "../odoo-import/acquisition-overlay.store";
import {
  ACQUISITION_REFS_KEY,
  assertPriceFloor,
  computeListPrices,
  DEFAULT_PRICING_RULES,
  grossOf,
  igvOf,
  normalizeAcquisitionRefs,
  type AcquisitionRef,
  type PricingRule,
} from "../domain/pricing";
import {
  FREIGHT_ZONES,
  FREIGHT_VEHICLE_LABELS,
  FREE_MOVES,
  MOVEMENT_RATE,
  freightConsolidatedEstimate,
  normalizeDispatchPlace,
  referentialFreightSnapshot,
} from "../domain/freight-stub";
import { buildQuotePdf } from "../domain/quote-pdf";
import { extForMime, sniffPurchaseDocMime } from "../domain/purchase-docs";
import {
  DEFAULT_PAYMENT_ACCOUNTS,
  type PaymentAccount,
} from "../domain/payment-accounts";
import { missingAccountFields, missingQuoteFields, presentSunat } from "../domain/ruc-sunat";

const HOLD_MS = 48 * 60 * 60 * 1000;
const PAGE_SIZE = 12;
const VENDOR_EMAIL = "vendedor@zdry.pe";

function publicMediaFields(c: {
  photos: { slot: number }[];
  video360Key: string | null;
  mediaStatus: string;
  mediaApprovedAt?: Date | null;
  updatedAt?: Date;
}) {
  const published = isMediaApproved(c.mediaStatus);
  const photos = published ? [...c.photos.map((p) => p.slot)].sort((a, b) => a - b) : [];
  return {
    photos,
    photoSlots: Array.from({ length: 9 }, (_, i) => photos.includes(i)),
    hasVideo: published && !!c.video360Key,
    coverSlot: photos[0] ?? null,
    mediaVersion: published ? (c.mediaApprovedAt || c.updatedAt || new Date()).toISOString() : null,
  };
}

const QUOTE_INCLUDE = {
  lines: true,
  extras: true,
  messages: { orderBy: { createdAt: "asc" as const } },
  vouchers: { orderBy: { createdAt: "asc" as const } },
  events: { orderBy: { createdAt: "asc" as const } },
  customer: true,
  vendor: { select: { id: true, name: true, email: true } },
  odooJobs: { orderBy: { createdAt: "desc" as const } },
  odooRevisions: { orderBy: { createdAt: "desc" as const }, take: 20 },
  installments: { orderBy: { createdAt: "desc" as const } },
  dispatches: true,
};

type QuoteFull = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

function n(v: Prisma.Decimal | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}

@Injectable()
export class QuotesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QuotesService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly locks: YardLockService,
    private readonly deals: DealCloseService,
    private readonly sunat: SunatRucService,
    private readonly quoteIssue: QuoteIssueWorker,
    private readonly quotePdf: QuotePdfService,
    private readonly quoteAmend: QuoteAmendService,
    private readonly saleClose: SaleCloseWorker,
    private readonly rentIssue: RentIssueWorker,
    private readonly rentClose: RentCloseWorker,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.expireHolds().catch((e) => this.log.warn(`expire: ${(e as Error).message}`));
    }, 45_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async loadPricing(): Promise<PricingRule[]> {
    const rows = await this.prisma.pricingRule.findMany();
    if (!rows.length) return DEFAULT_PRICING_RULES;
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      target: r.target,
      marginPct: n(r.marginPct),
      maxDiscountPct: n(r.maxDiscountPct),
    }));
  }

  async loadVisibility(): Promise<VisibilityRule[]> {
    const rows = await this.prisma.visibilityRule.findMany();
    if (!rows.length) return DEFAULT_VISIBILITY_RULES;
    return rows.map((r) => ({ id: r.id, scope: r.scope, target: r.target, show: r.show }));
  }

  async loadAcquisitionRefs(): Promise<AcquisitionRef[]> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ACQUISITION_REFS_KEY } });
    return normalizeAcquisitionRefs(row?.value);
  }

  async ensureUnitPrices(iso: string, rules?: PricingRule[], refs?: AcquisitionRef[]) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) throw new NotFoundException("Unidad no encontrada.");
    if (c.priceList != null && c.priceMin != null) {
      return { priceList: n(c.priceList), priceMin: n(c.priceMin) };
    }
    const pricing = rules || (await this.loadPricing());
    const acquisition = refs || (await this.loadAcquisitionRefs());
    const [dry, overlays, safety] = await Promise.all([
      presentDryReferential(this.prisma),
      loadOverlayConcepts(this.prisma),
      loadSafetyMarginRules(this.prisma),
    ]);
    const computed = computeListPrices(
      overlayUnitFrom(c, dry),
      pricing,
      acquisition,
      overlays,
      safety,
    );
    await this.prisma.container.update({
      where: { iso },
      data: { priceList: computed.priceList, priceMin: computed.priceMin, priceSource: c.priceSource || "rule" },
    });
    return { priceList: computed.priceList, priceMin: computed.priceMin };
  }

  private async catalogWhere(): Promise<Prisma.ContainerWhereInput> {
    return {
      ...(await this.prisma.liveContainers()),
      intakeType: { in: ["compra", "pendiente_factura", "ajuste_odoo", "fabricacion_odoo"] },
      physicallyReceived: true,
      status: { in: ["Disponible", "Reservado"] },
      mediaStatus: "aprobado",
      NOT: pendingValuationWhere(),
    };
  }

  private async isCatalogVisible(iso: string) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) return false;
    if (c.demo && !(await this.prisma.demoOn())) return false;
    if (c.archivedAt) return false;
    return (
      isOwnSaleStock(c.intakeType) &&
      c.physicallyReceived &&
      (c.status === "Disponible" || c.status === "Reservado") &&
      isMediaApproved(c.mediaStatus) &&
      !isPendingValuation(c)
    );
  }

  async catalogCommerce() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CATALOG_COMMERCE_KEY } });
    return normalizeCatalogCommerce(row?.value);
  }

  async catalogCopy() {
    const [copyRow, commerce] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { key: CATALOG_COPY_KEY } }),
      this.catalogCommerce(),
    ]);
    const copy = normalizeCatalogCopy(copyRow?.value);
    return {
      ...copy,
      mode: commerce.mode,
      quotesEnabled: commerce.quotesEnabled,
      accountsEnabled: commerce.accountsEnabled,
      whatsapp: commerce.whatsapp || copy.whatsapp,
      coordinatorName: commerce.coordinatorName,
    };
  }

  async catalogMeta() {
    const [types, cats, depots, manufacturers] = await Promise.all([
      this.prisma.containerType.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.category.findMany({ where: ACTIVE_MASTER, orderBy: { code: "asc" } }),
      this.prisma.depot.findMany({ where: ACTIVE_MASTER, orderBy: { name: "asc" } }),
      this.prisma.container.findMany({
        where: await this.catalogWhere(),
        select: { manufacturer: true },
        distinct: ["manufacturer"],
      }),
    ]);
    return {
      types,
      categories: cats,
      depots: depots.map((d) => ({ id: d.id, name: d.name, city: d.city })),
      manufacturers: manufacturers.map((m) => m.manufacturer).filter((x) => x && x !== "—"),
      freightZones: FREIGHT_ZONES,
      freightVehicles: FREIGHT_VEHICLE_LABELS,
      pageSize: PAGE_SIZE,
    };
  }

  async catalogList(query: {
    q?: string;
    type?: string;
    cat?: string;
    depot?: string;
    manufacturer?: string;
    year?: string;
    sort?: string;
    page?: string;
  }) {
    const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
    const where: Prisma.ContainerWhereInput = { ...(await this.catalogWhere()) };
    if (query.type) where.type = query.type;
    if (query.cat) where.cat = query.cat;
    if (query.depot) where.depotId = query.depot;
    if (query.manufacturer) where.manufacturer = query.manufacturer;
    if (query.year) where.year = parseInt(query.year, 10);
    if (query.q) {
      const q = query.q.trim();
      where.OR = [
        { iso: { contains: q, mode: "insensitive" } },
        { manufacturer: { contains: q, mode: "insensitive" } },
        { type: { contains: q, mode: "insensitive" } },
      ];
    }
    const orderBy: Prisma.ContainerOrderByWithRelationInput =
      query.sort === "price"
        ? { priceList: "asc" }
        : query.sort === "year"
          ? { year: "desc" }
          : { iso: "asc" };

    const [total, rows, vis, pricing, types, cats, acquisition] = await Promise.all([
      this.prisma.container.count({ where }),
      this.prisma.container.findMany({
        where,
        include: { depot: true, photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { slot: true } } },
        orderBy,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.loadVisibility(),
      this.loadPricing(),
      this.prisma.containerType.findMany(),
      this.prisma.category.findMany(),
      this.loadAcquisitionRefs(),
    ]);

    const items = [];
    for (const c of rows) {
      const prices = await this.ensureUnitPrices(c.iso, pricing, acquisition);
      const showPrice = applyShowPrice(
        {
          iso: c.iso,
          type: c.type,
          cat: c.cat,
          manufacturer: c.manufacturer,
          depotId: c.depotId,
          priceVisibilityOverride: c.showPriceOverride,
          status: c.status,
        },
        vis,
      );
      items.push({
        iso: c.iso,
        type: c.type,
        typeLabel: types.find((t) => t.code === c.type)?.label || c.type,
        cat: c.cat,
        catLabel: cats.find((x) => x.code === c.cat)?.label || c.cat,
        year: c.year,
        manufacturer: c.manufacturer,
        depotId: c.depotId,
        depotName: c.depot.name,
        depotCity: c.depot.city,
        status: c.status,
        commercialStatus: c.commercialStatus,
        demo: c.demo,
        showPrice,
        priceList: showPrice ? prices.priceList : null,
        priceMin: null,
        igv: showPrice ? igvOf(prices.priceList) : null,
        gross: showPrice ? grossOf(prices.priceList) : null,
        ...publicMediaFields(c),
      });
    }

    return { items, total, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  async catalogUnit(iso: string) {
    const c = await this.prisma.container.findUnique({
      where: { iso },
      include: { depot: true, photos: { where: { status: PHOTO_STATUS_ACTIVE }, select: { slot: true } } },
    });
    if (!c || !(await this.isCatalogVisible(iso))) throw new NotFoundException("Unidad no disponible en catálogo.");
    const [vis, pricing, typeRow, catRow, acquisition] = await Promise.all([
      this.loadVisibility(),
      this.loadPricing(),
      this.prisma.containerType.findUnique({ where: { code: c.type } }),
      this.prisma.category.findUnique({ where: { code: c.cat } }),
      this.loadAcquisitionRefs(),
    ]);
    const prices = await this.ensureUnitPrices(c.iso, pricing, acquisition);
    const showPrice = applyShowPrice(
      {
        iso: c.iso,
        type: c.type,
        cat: c.cat,
        manufacturer: c.manufacturer,
        depotId: c.depotId,
        priceVisibilityOverride: c.showPriceOverride,
        status: c.status,
      },
      vis,
    );
    const published = isMediaApproved(c.mediaStatus);
    return {
      iso: c.iso,
      type: c.type,
      typeLabel: typeRow?.label || c.type,
      dims: typeRow?.dims,
      cat: c.cat,
      catLabel: catRow?.label || c.cat,
      year: c.year,
      manufacturer: c.manufacturer,
      color: c.color,
      tareKg: c.tareKg,
      mgwKg: c.mgwKg,
      payloadKg: c.payloadKg,
      cbm: c.cbm != null ? n(c.cbm) : null,
      depotId: c.depotId,
      depotName: c.depot.name,
      depotCity: c.depot.city,
      status: c.status,
      reserved: c.status === "Reservado",
      demo: c.demo,
      showPrice,
      priceList: showPrice ? prices.priceList : null,
      igv: showPrice ? igvOf(prices.priceList) : null,
      gross: showPrice ? grossOf(prices.priceList) : null,
      ...publicMediaFields(c),
      inspectionNotes: published ? c.inspectionNotes : "",
    };
  }

  async catalogPhoto(iso: string, slot: number) {
    if (!(await this.isCatalogVisible(iso))) throw new NotFoundException("Foto no disponible.");
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c || !isMediaApproved(c.mediaStatus)) throw new NotFoundException("Ficha multimedia aún no publicada.");
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { iso, slot, status: PHOTO_STATUS_ACTIVE },
    });
    if (!photo) throw new NotFoundException("Foto no encontrada.");
    const key = photo.publicKey || photo.storageKey;
    const obj = await this.storage.get(key);
    return new StreamableFile(obj.stream, { type: obj.contentType || photo.mimeType, disposition: "inline" });
  }

  async catalogWatermark() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: "catalog_watermark" } });
    const value = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : {};
    const storageKey = typeof value.storageKey === "string" ? value.storageKey : "";
    if (storageKey) {
      try {
        const obj = await this.storage.get(storageKey);
        return new StreamableFile(obj.stream, { type: obj.contentType || "image/png", disposition: "inline" });
      } catch {
        /* usa predeterminada */
      }
    }
    const buf = await loadDefaultWatermark();
    if (!buf?.length) throw new NotFoundException("No hay marca de agua.");
    return new StreamableFile(Readable.from(buf), { type: "image/png", disposition: "inline" });
  }

  async catalogVideo(iso: string) {
    if (!(await this.isCatalogVisible(iso))) throw new NotFoundException("Video no disponible.");
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c?.video360Key || !isMediaApproved(c.mediaStatus)) throw new NotFoundException("Video no publicado.");
    const obj = await this.storage.get(c.video360Key);
    return new StreamableFile(obj.stream, { type: c.video360Mime || obj.contentType || "video/mp4", disposition: "inline" });
  }

  freightPreview(zoneId: string, types: string[], vehicle?: string) {
    return freightConsolidatedEstimate(
      types.filter(Boolean).map((type) => ({ type })),
      zoneId,
      vehicle || "cama_baja",
    );
  }

  private async defaultVendorId() {
    const v = await this.prisma.user.findUnique({ where: { email: VENDOR_EMAIL } });
    if (v) return v.id;
    const any = await this.prisma.user.findFirst({ where: { role: "vendedor", active: true } });
    if (!any) throw new BadRequestException("No hay comercial asignable.");
    return any.id;
  }

  private async nextQuoteNumber() {
    const year = new Date().getFullYear();
    const prefix = `COT-${year}-`;
    const last = await this.prisma.quote.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
    });
    const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
  }

  private async resolveCustomer(
    user: AuthUser | undefined,
    body: { customerId?: string },
  ) {
    if (!user) {
      throw new UnauthorizedException(
        "Crea una cuenta con los datos de tu empresa y una persona de contacto para solicitar cotización. Puedes armar el carrito sin registrarte.",
      );
    }
    if (user.role === "cliente") {
      if (!user.customerId) {
        throw new UnprocessableEntityException("Tu usuario no está ligado a una empresa. Completa el perfil en Mi cuenta.");
      }
      await this.assertClientProfile(user);
      return user.customerId;
    }
    if (["admin", "gerente", "vendedor"].includes(user.role) && body.customerId) {
      return body.customerId;
    }
    throw new ForbiddenException("Solo una cuenta de cliente puede solicitar cotización desde el catálogo.");
  }

  async paymentAccounts(): Promise<PaymentAccount[]> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: "payment_accounts" } });
    const value = row?.value;
    if (Array.isArray(value) && value.length) return value as PaymentAccount[];
    return DEFAULT_PAYMENT_ACCOUNTS;
  }

  async clientProfile(user: AuthUser) {
    if (!user.customerId) {
      return {
        complete: false,
        quoteReady: false,
        missing: ["RUC validado en SUNAT", "persona de contacto"],
        missingAccount: ["empresa"],
        rucLookup: { remaining: 5, max: 5, lockedUntil: null, validated: false },
        customer: null,
        contact: { name: user.name, email: user.email },
        paymentAccounts: await this.paymentAccounts(),
      };
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: user.customerId } });
    const snapshot = {
      companyName: customer?.companyName,
      rucDni: customer?.rucDni,
      rucValidatedAt: customer?.rucValidatedAt,
      contactName: user.name,
      email: user.email || customer?.email,
      phone: customer?.phone,
    };
    const missingAccount = missingAccountFields(snapshot);
    const missingQuote = missingQuoteFields(snapshot);
    return {
      complete: missingQuote.length === 0,
      quoteReady: missingQuote.length === 0,
      missing: missingQuote,
      missingAccount,
      rucLookup: customer
        ? this.sunat.lookupStatus(customer)
        : { remaining: 5, max: 5, lockedUntil: null, validated: false },
      customer: customer
        ? {
            id: customer.id,
            companyName: customer.companyName,
            rucDni: customer.rucDni,
            street: customer.street,
            district: customer.district,
            province: customer.province,
            department: customer.department,
            sunatUbigeo: customer.sunatUbigeo,
            sunatState: customer.sunatState,
            sunatCondition: customer.sunatCondition,
            address: presentSunat(customer).address,
            email: customer.email,
            phone: customer.phone,
            rucValidatedAt: customer.rucValidatedAt,
          }
        : null,
      contact: { name: user.name, email: user.email, phone: customer?.phone },
      paymentAccounts: await this.paymentAccounts(),
    };
  }

  async updateClientProfile(
    user: AuthUser,
    body: { companyName?: string; rucDni?: string; contactName?: string; phone?: string; email?: string },
    ip?: string,
  ) {
    if (!user.customerId) throw new UnprocessableEntityException("No hay empresa asociada a esta cuenta.");
    const current = await this.prisma.customer.findUnique({ where: { id: user.customerId } });
    const contactName = (body.contactName || "").trim();
    const phone = (body.phone || "").trim();
    if (!contactName || !phone) {
      throw new BadRequestException("Persona de contacto y teléfono son obligatorios.");
    }
    const companyName = (body.companyName || "").trim();
    const sunatLocked = Boolean(current?.rucValidatedAt);
    await this.prisma.customer.update({
      where: { id: user.customerId },
      data: {
        phone,
        email: (body.email || user.email).trim(),
        ...(companyName && !sunatLocked ? { companyName } : {}),
      },
    });
    if (contactName !== user.name) {
      await this.prisma.user.update({ where: { id: user.id }, data: { name: contactName } });
      user.name = contactName;
    }
    await this.audit.log({ user, action: "update_profile", entity: "Customer", entityId: user.customerId, ip });
    return this.clientProfile(user);
  }

  lookupRuc(user: AuthUser, ruc: string) {
    return this.sunat.lookupForCustomer(user, ruc);
  }

  private async assertClientProfile(user: AuthUser) {
    if (user.role !== "cliente") return;
    const profile = await this.clientProfile(user);
    if (!profile.quoteReady) {
      throw new UnprocessableEntityException(
        `Valida el RUC en SUNAT para cotizar (${profile.missing.join(", ")}).`,
      );
    }
  }

  async requestQuote(
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
    user: AuthUser | undefined,
    ip?: string,
  ) {
    const staff = user && ["admin", "gerente", "vendedor", "superadmin"].includes(user.role);
    if (!staff) {
      const commerce = await this.catalogCommerce();
      if (!commerce.quotesEnabled) throw new ForbiddenException(publicQuotesBlockedMessage());
    }
    const isos = [...new Set((body.isos || []).map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (!isos.length) throw new BadRequestException("Selecciona al menos una unidad.");
    const kind = body.kind === "alquiler" ? "alquiler" : "venta";
    const customerId = await this.resolveCustomer(user, { customerId: body.customerId });
    if (customerId) await this.sunat.hydrateIfNeeded(customerId);
    const vendorId = await this.defaultVendorId();
    const [pricing, acquisition] = await Promise.all([this.loadPricing(), this.loadAcquisitionRefs()]);

    const lines = [];
    for (const iso of isos) {
      const c = await this.prisma.container.findUnique({ where: { iso } });
      if (!c) throw new NotFoundException(`Unidad ${iso} no existe.`);
      if (!isOwnSaleStock(c.intakeType)) throw new BadRequestException(`${iso} no está en venta (custodia).`);
      if (!c.physicallyReceived) throw new BadRequestException(`${iso} aún no está en patio.`);
      if (c.status !== "Disponible" && c.status !== "Reservado") {
        throw new ConflictException(`${iso} no está disponible.`);
      }
      const prices = await this.ensureUnitPrices(iso, pricing, acquisition);
      lines.push({
        iso,
        type: c.type,
        cat: c.cat,
        listPrice: prices.priceList,
        minPrice: prices.priceMin,
        priceNet: kind === "alquiler" ? 0 : prices.priceList,
      });
    }

    const number = await this.nextQuoteNumber();
    const anyDemo = (await this.prisma.container.findMany({ where: { iso: { in: isos }, demo: true } })).length > 0;
    const place = normalizeDispatchPlace(body.dispatchPlace);
    const freightSnap = place ? referentialFreightSnapshot(place) : undefined;
    const quote = await this.prisma.quote.create({
      data: {
        number,
        kind,
        dealStatus: "nueva",
        customerId,
        vendorId,
        demo: anyDemo,
        dispatchNotes: place || null,
        freightSnapshot: freightSnap ? (freightSnap as object) : undefined,
        rentPriceNet: kind === "alquiler" ? 0 : undefined,
        rentMonths: kind === "alquiler" ? 12 : undefined,
        lines: { create: lines },
        events: {
          create: {
            type: "creada",
            detail: place
              ? `Solicitud ${kind} ${number}. Destino referencial: ${place}.`
              : `Solicitud ${kind} ${number}`,
          },
        },
      },
      include: QUOTE_INCLUDE,
    });
    if (kind === "venta" && !anyDemo) {
      const job = await this.quoteIssue.enqueue(quote.id);
      await this.quoteIssue.runJob(job.id);
    } else if (kind === "alquiler" && !anyDemo) {
      const job = await this.rentIssue.enqueue(quote.id);
      await this.rentIssue.runJob(job.id);
    }
    await this.audit.log({
      user,
      action: "create",
      entity: "Quote",
      entityId: quote.id,
      after: { number, isos, kind },
      ip,
    });
    return this.presentQuote(await this.getQuoteOrThrow(quote.id), user?.role);
  }

  private async getQuoteOrThrow(id: string): Promise<QuoteFull> {
    const q = await this.prisma.quote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
    if (!q) throw new NotFoundException("Cotización no encontrada.");
    return q;
  }

  assertAccess(q: QuoteFull, user: AuthUser, write = false) {
    if (user.role === "cliente") {
      if (q.customerId !== user.customerId) throw new ForbiddenException("Sin acceso");
      return;
    }
    if (["admin", "gerente", "vendedor"].includes(user.role)) return;
    if (write) throw new ForbiddenException("Sin acceso");
    throw new ForbiddenException("Sin acceso");
  }

  presentQuote(q: QuoteFull, role?: Role | string) {
    const staff = role === "superadmin" || role === "admin" || role === "gerente" || role === "vendedor";
    const extraNet = q.extras.filter((e) => e.accepted || staff).reduce((s, e) => s + n(e.amount), 0);
    const rentNet = q.kind === "alquiler" ? n(q.rentPriceNet) : null;
    const net = (rentNet != null ? rentNet : q.lines.reduce((s, l) => s + n(l.priceNet), 0)) + extraNet;
    const issueJob = q.odooJobs.find((j) => j.event === (q.kind === "alquiler" ? RENT_ISSUE_EVENT : QUOTE_ISSUE_EVENT));
    const closeJob = q.odooJobs.find((j) => j.event === (q.kind === "alquiler" ? RENT_CLOSE_EVENT : SALE_CLOSE_EVENT));
    return {
      id: q.id,
      number: q.number,
      kind: q.kind,
      dealStatus: q.dealStatus,
      demo: q.demo,
      holdExpiresAt: q.holdExpiresAt,
      holdPausedAt: q.holdPausedAt,
      holdPaused: holdClockPaused(q.dealStatus as DealStatus),
      movementInformed: q.movementInformed,
      movementWaived: q.movementWaived,
      clientPickup: q.clientPickup,
      freightZoneId: q.freightZoneId,
      freightVehicle: q.freightVehicle,
      freightSnapshot: q.freightSnapshot,
      dispatchDate: q.dispatchDate,
      dispatchNotes: q.dispatchNotes,
      lostReason: q.lostReason,
      createdAt: q.createdAt,
      customer: {
        id: q.customer.id,
        email: q.customer.email,
        phone: q.customer.phone,
        rucDni: q.customer.rucDni,
        ...presentSunat(q.customer),
      },
      vendor: q.vendor,
      lines: q.lines.map((l) => ({
        id: l.id,
        iso: l.iso,
        type: l.type,
        cat: l.cat,
        listPrice: n(l.listPrice),
        priceNet: n(l.priceNet),
        minPrice: staff ? n(l.minPrice) : undefined,
        frozenAt: l.frozenAt,
      })),
      extras: q.extras.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        amount: n(e.amount),
        accepted: e.accepted,
        meta: e.meta,
      })),
      messages: q.messages,
      vouchers: q.vouchers.map((v) => ({
        id: v.id,
        originalName: v.originalName,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        bank: v.bank,
        operationNumber: v.operationNumber,
        paidAt: v.paidAt,
        declaredAmount: n(v.declaredAmount),
        status: v.status,
        reviewNote: v.reviewNote,
        createdAt: v.createdAt,
      })),
      events: q.events,
      odooJobs: staff ? q.odooJobs : undefined,
      odoo: {
        saleId: q.odooSaleId,
        saleName: q.odooSaleName,
        state: q.odooState,
        invoiceStatus: q.odooInvoiceStatus,
        amountUntaxed: q.odooAmountUntaxed != null ? n(q.odooAmountUntaxed) : null,
        amountTax: q.odooAmountTax != null ? n(q.odooAmountTax) : null,
        amountTotal: q.odooAmountTotal != null ? n(q.odooAmountTotal) : null,
        invoiceName: q.odooInvoiceName || null,
        pickingName: q.odooPickingName || null,
        pickingState: q.odooPickingState || null,
        pickingInName: q.odooPickingInName || null,
        pickingInState: q.odooPickingInState || null,
        url: staff ? q.odooUrl : null,
        planId: q.odooPlanId || null,
        close: q.kind === "alquiler"
          ? rentSemaphore({
              odooSaleId: q.odooSaleId,
              odooState: q.odooState,
              odooInvoiceName: q.odooInvoiceName,
              installmentCount: q.installments?.length || 0,
              odooPickingState: q.odooPickingState,
              odooPickingInState: q.odooPickingInState,
            })
          : quoteSemaphore({
              odooSaleId: q.odooSaleId,
              odooState: q.odooState,
              odooInvoiceStatus: q.odooInvoiceStatus,
              odooInvoiceName: q.odooInvoiceName,
              odooPickingState: q.odooPickingState,
            }),
        job: issueJob ? { status: issueJob.status, error: issueJob.lastError, attempts: issueJob.attempts } : null,
        closeJob: closeJob ? { status: closeJob.status, error: closeJob.lastError, attempts: closeJob.attempts } : null,
        pdf: {
          ready: Boolean(q.pdfStorageKey && (q.pdfSource === "odoo" || q.pdfSource === "zdry")),
          source: q.pdfSource || null,
          renderedAt: q.pdfRenderedAt,
          cronogramaReady: Boolean(q.cronogramaStorageKey),
        },
      },
      rent: q.kind === "alquiler"
        ? {
            priceNet: n(q.rentPriceNet),
            months: q.rentMonths,
            start: q.rentStart,
            end: q.rentEnd,
            quotaEditable: canAmendRentQuota(q.odooState),
            installments: (q.installments || []).map((i) => ({
              id: i.id,
              name: i.name,
              amountTotal: n(i.amountTotal),
              invoiceDate: i.invoiceDate,
              dueDate: i.dueDate,
              paymentState: i.paymentState,
            })),
          }
        : null,
      amend: {
        allowed: q.kind === "alquiler" ? canAmendRentQuota(q.odooState) && Boolean(q.odooSaleId) : Boolean(q.odooSaleId) && canAmendOdoo(q.odooState),
        odooState: q.odooState || null,
      },
      timeline: quoteTimeline(
        {
          odooSaleId: q.odooSaleId,
          odooSaleName: q.odooSaleName,
          odooState: q.odooState,
          odooInvoiceName: q.odooInvoiceName,
          odooInvoiceStatus: q.odooInvoiceStatus,
          odooPickingName: q.odooPickingName,
          odooPickingState: q.odooPickingState,
          odooPickingInName: q.odooPickingInName,
          odooPickingInState: q.odooPickingInState,
          kind: q.kind,
        },
        staff ? "staff" : "client",
      ),
      yard: yardDispatchReady({
        dealStatus: q.dealStatus,
        odooInvoiceName: q.odooInvoiceName,
        odooInvoiceStatus: q.odooInvoiceStatus,
      }),
      revisions: staff
        ? (q.odooRevisions || []).map((r) => ({
            id: r.id,
            source: r.source,
            state: r.state,
            invoiceStatus: r.invoiceStatus,
            amountTotal: r.amountTotal != null ? n(r.amountTotal) : null,
            diff: r.diffJson,
            summary: revisionDiffSummary(r.diffJson),
            at: r.createdAt,
          }))
        : undefined,
      order: {
        displayNumber: clientOrderDisplay(q.odooSaleName, q.number),
        odooSaleName: q.odooSaleName || null,
        pdfReady: Boolean(q.pdfStorageKey && (q.pdfSource === "odoo" || q.pdfSource === "zdry")),
        voucherCount: q.vouchers.length,
        registered: pedidoRegistered(q.vouchers.length),
      },
      dispatches: q.dispatches,
      totals: { net, igv: igvOf(net), gross: grossOf(net) },
    };
  }

  async listForStaff(status?: string, kind?: string) {
    const where: Prisma.QuoteWhereInput = {
      ...(await this.prisma.hideDemo()),
      ...(status ? { dealStatus: status } : {}),
      ...(kind === "alquiler" || kind === "venta" ? { kind } : {}),
    };
    const rows = await this.prisma.quote.findMany({
      where,
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((q) => this.presentQuote(q, "vendedor"));
  }

  async listForCustomer(user: AuthUser) {
    if (!user.customerId) return [];
    const rows = await this.prisma.quote.findMany({
      where: { customerId: user.customerId, ...(await this.prisma.hideDemo()) },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((q) => this.presentQuote(q, "cliente"));
  }

  async getOne(id: string, user: AuthUser) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user);
    return this.presentQuote(q, user.role);
  }

  private async setStatus(q: QuoteFull, to: DealStatus, extra: Prisma.QuoteUpdateInput = {}) {
    const from = q.dealStatus as DealStatus;
    this.deals.transition(from, to);
    const data: Prisma.QuoteUpdateInput = { dealStatus: to, ...extra };
    if (holdClockPaused(to) && !q.holdPausedAt) {
      data.holdPausedAt = new Date();
    }
    if (!holdClockPaused(to) && q.holdPausedAt) {
      const pausedMs = Date.now() - q.holdPausedAt.getTime();
      if (q.holdExpiresAt) data.holdExpiresAt = new Date(q.holdExpiresAt.getTime() + pausedMs);
      data.holdPausedAt = null;
    }
    return this.prisma.quote.update({
      where: { id: q.id },
      data: {
        ...data,
        events: { create: { type: to, detail: `Estado ${from} → ${to}` } },
      },
      include: QUOTE_INCLUDE,
    });
  }

  async send(id: string, user: AuthUser, ip?: string) {
    let q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (!q.demo && !q.odooSaleId) {
      if (q.kind === "alquiler") {
        const job = await this.rentIssue.enqueue(q.id);
        await this.rentIssue.runJob(job.id);
      } else {
        const job = await this.quoteIssue.enqueue(q.id);
        await this.quoteIssue.runJob(job.id);
      }
      q = await this.getQuoteOrThrow(id);
      if (!q.odooSaleId) {
        const fail = q.odooJobs.find((j) => j.event === (q.kind === "alquiler" ? RENT_ISSUE_EVENT : QUOTE_ISSUE_EVENT));
        throw new UnprocessableEntityException(fail?.lastError || "No se pudo emitir la cotización en Odoo.");
      }
    }
    await this.quoteIssue.remitIssuedQuote(id);
    q = await this.getQuoteOrThrow(id);
    const updated = q.dealStatus === "nueva" ? await this.setStatus(q, "cotizada") : q;
    await this.audit.log({ user, action: "send_quote", entity: "Quote", entityId: id, ip });
    return this.presentQuote(updated, user.role);
  }

  async reserve(id: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    const isos = q.lines.map((l) => l.iso);
    let updated: QuoteFull = q;
    for (const iso of isos) {
      updated = await this.locks.withIsoLock(iso, async () => {
        const unit = await this.prisma.container.findUnique({ where: { iso } });
        if (!unit) throw new NotFoundException(iso);
        if (unit.reservedQuoteId && unit.reservedQuoteId !== id) {
          throw new ConflictException(`La unidad ${iso} ya está reservada por otra cotización.`);
        }
        if (unit.status !== "Disponible" && unit.reservedQuoteId !== id) {
          throw new ConflictException(`La unidad ${iso} no está disponible.`);
        }
        await this.prisma.container.update({
          where: { iso },
          data: {
            status: "Reservado",
            commercialStatus: "reservado",
            reservedBy: q.customer.companyName,
            reservedQuoteId: id,
            reservationExpiry: new Date(Date.now() + HOLD_MS),
          },
        });
        await this.prisma.containerHistory.create({
          data: { iso, type: "Reserva", detail: `Hold 48 h — ${q.number}` },
        });
        return q;
      });
    }
    void updated;
    const next = await this.setStatus(await this.getQuoteOrThrow(id), "reservada", {
      holdExpiresAt: new Date(Date.now() + HOLD_MS),
      holdPausedAt: null,
    });
    await this.audit.log({ user, action: "reserve", entity: "Quote", entityId: id, ip });
    return this.presentQuote(next, user.role);
  }

  async thread(id: string, body: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user);
    await this.assertClientProfile(user);
    const text = (body || "").trim();
    if (!text) throw new BadRequestException("Escribe un mensaje.");
    let current = q;
    if (q.dealStatus === "reservada") {
      current = await this.setStatus(q, "en_negociacion");
    }
    await this.prisma.dealMessage.create({
      data: { quoteId: id, authorRole: user.role, authorName: user.name, body: text },
    });
    await this.prisma.quoteEvent.create({
      data: { quoteId: id, type: "mensaje", detail: `${user.name}: ${text.slice(0, 180)}` },
    });
    await this.audit.log({ user, action: "thread", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(current.id), user.role);
  }

  async grantDiscount(id: string, iso: string, priceNet: number, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (!["admin", "gerente", "vendedor"].includes(user.role)) throw new ForbiddenException("Sin acceso");
    await this.assertOdooAmendable(id);
    const line = q.lines.find((l) => l.iso === iso);
    if (!line) throw new NotFoundException("Línea no encontrada.");
    const override = user.role === "gerente" || user.role === "admin" || user.role === "superadmin";
    const floor = assertPriceFloor(priceNet, n(line.minPrice), override);
    if (!floor.ok) throw new UnprocessableEntityException(floor.message);
    await this.prisma.quoteLine.update({
      where: { id: line.id },
      data: { priceNet, frozenAt: new Date() },
    });
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: id,
        type: "descuento",
        detail: `${iso} neto ${priceNet}${override && priceNet < n(line.minPrice) ? " (override gerente)" : ""}`,
      },
    });
    await this.pushOdooAmend(id);
    await this.audit.log({ user, action: "grant_discount", entity: "Quote", entityId: id, after: { iso, priceNet }, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async closeThread(id: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    const next = await this.setStatus(q, "reservada");
    await this.audit.log({ user, action: "close_thread", entity: "Quote", entityId: id, ip });
    return this.presentQuote(next, user.role);
  }

  async uploadVoucher(
    id: string,
    file: Express.Multer.File | undefined,
    meta: { bank?: string; operationNumber?: string; paidAt?: string; declaredAmount?: number },
    user: AuthUser,
    ip?: string,
  ) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user);
    await this.assertClientProfile(user);
    if (user.role !== "cliente" && !["admin", "gerente", "vendedor"].includes(user.role)) {
      throw new ForbiddenException("Sin acceso");
    }
    try {
      assertOdooQuoteForPedido(q.kind, q.demo, q.odooSaleName);
      if (user.role === "cliente") assertCanRegisterPedido(q.dealStatus as DealStatus);
    } catch (e) {
      if (e instanceof QuotePedidoError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
    if (!file?.buffer) throw new BadRequestException("Selecciona un archivo");
    let mime: string;
    try {
      mime = sniffPurchaseDocMime(file.buffer);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const key = `quotes/${id}/vouchers/${randomUUID()}.${extForMime(mime)}`;
    await this.storage.put(key, file.buffer, mime);
    await this.prisma.paymentVoucher.create({
      data: {
        quoteId: id,
        storageKey: key,
        mimeType: mime,
        originalName: file.originalname || "comprobante",
        sizeBytes: file.size,
        bank: meta.bank || "",
        operationNumber: meta.operationNumber || "",
        paidAt: meta.paidAt ? new Date(meta.paidAt) : null,
        declaredAmount: meta.declaredAmount ?? q.lines.reduce((s, l) => s + n(l.priceNet), 0),
        status: "subido",
      },
    });
    const from = q.dealStatus as DealStatus;
    if (from === "reservada" || from === "en_negociacion" || from === "pago_rechazado") {
      try {
        assertPedidoKeepsOdooDraft(from, "comprobante_subido");
      } catch (e) {
        if (e instanceof QuotePedidoError) throw new UnprocessableEntityException(e.message);
        throw e;
      }
      await this.setStatus(await this.getQuoteOrThrow(id), "comprobante_subido");
    }
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: id,
        type: PEDIDO_EVENT,
        detail: pedidoEventDetail(q.odooSaleName, meta.bank || "", meta.operationNumber || ""),
      },
    });
    await this.audit.log({ user, action: "upload_voucher", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async voucherFile(quoteId: string, voucherId: string, user: AuthUser) {
    const q = await this.getQuoteOrThrow(quoteId);
    this.assertAccess(q, user);
    const v = q.vouchers.find((x) => x.id === voucherId);
    if (!v) throw new NotFoundException("Comprobante no encontrado.");
    const obj = await this.storage.get(v.storageKey);
    return new StreamableFile(obj.stream, { type: obj.contentType || v.mimeType });
  }

  async verifyVoucher(quoteId: string, voucherId: string, note: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(quoteId);
    this.assertAccess(q, user, true);
    if (!(note || "").trim()) throw new BadRequestException("La nota de verificación es obligatoria (p. ej. esperando CCI 24–48 h).");
    const v = q.vouchers.find((x) => x.id === voucherId);
    if (!v) throw new NotFoundException("Comprobante no encontrado.");
    this.assertPedidoDoesNotCloseOdoo(q.dealStatus as DealStatus, "en_verificacion");
    await this.prisma.paymentVoucher.update({
      where: { id: voucherId },
      data: { status: "en_verificacion", reviewNote: note.trim() },
    });
    const next = await this.setStatus(await this.getQuoteOrThrow(quoteId), "en_verificacion");
    await this.audit.log({ user, action: "verify_voucher", entity: "Quote", entityId: quoteId, ip });
    return this.presentQuote(next, user.role);
  }

  async validateVoucher(quoteId: string, voucherId: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(quoteId);
    this.assertAccess(q, user, true);
    const v = q.vouchers.find((x) => x.id === voucherId);
    if (!v) throw new NotFoundException("Comprobante no encontrado.");
    this.assertPedidoDoesNotCloseOdoo(q.dealStatus as DealStatus, "pago_validado");
    await this.prisma.paymentVoucher.update({ where: { id: voucherId }, data: { status: "validado" } });
    const next = await this.setStatus(await this.getQuoteOrThrow(quoteId), "pago_validado");
    await this.audit.log({ user, action: "validate_voucher", entity: "Quote", entityId: quoteId, ip });
    return this.presentQuote(next, user.role);
  }

  async rejectVoucher(quoteId: string, voucherId: string, motivo: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(quoteId);
    this.assertAccess(q, user, true);
    if (!(motivo || "").trim()) throw new BadRequestException("Indica el motivo del rechazo.");
    this.assertPedidoDoesNotCloseOdoo(q.dealStatus as DealStatus, "pago_rechazado");
    await this.prisma.paymentVoucher.update({
      where: { id: voucherId },
      data: { status: "rechazado", reviewNote: motivo.trim() },
    });
    const next = await this.setStatus(await this.getQuoteOrThrow(quoteId), "pago_rechazado");
    await this.audit.log({ user, action: "reject_voucher", entity: "Quote", entityId: quoteId, after: { motivo }, ip });
    return this.presentQuote(next, user.role);
  }

  async addMovement(id: string, moves: number, waive: boolean, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (!["pago_validado", "asignacion_confirmada"].includes(q.dealStatus)) {
      throw new BadRequestException("Informa movimientos después de validar el pago.");
    }
    const m = Math.max(0, Math.floor(Number(moves) || 0));
    const canWaive = waive && (user.role === "admin" || user.role === "gerente" || user.role === "superadmin");
    const amount = canWaive ? 0 : Math.max(0, m - FREE_MOVES) * MOVEMENT_RATE;
    await this.prisma.quoteExtra.deleteMany({ where: { quoteId: id, kind: "movement" } });
    await this.prisma.quoteExtra.create({
      data: {
        quoteId: id,
        kind: "movement",
        label: canWaive
          ? `Movimientos de patio (${m}) — exonerados`
          : m <= FREE_MOVES
            ? `Movimientos de patio (${m}) — cubiertos (3 libres)`
            : `Movimientos de patio extra (${m - FREE_MOVES} × $${MOVEMENT_RATE})`,
        amount,
        accepted: amount === 0,
        meta: { moves: m, free: FREE_MOVES, rate: MOVEMENT_RATE, waived: canWaive },
      },
    });
    await this.prisma.quote.update({
      where: { id },
      data: { movementInformed: true, movementWaived: canWaive },
    });
    await this.prisma.quoteEvent.create({
      data: { quoteId: id, type: "movimiento", detail: `${m} movimientos; cargo ${amount}` },
    });
    await this.audit.log({ user, action: "movement_extra", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async addFreight(
    id: string,
    body: { zoneId?: string; vehicle?: string; sellAmount?: number; clientPickup?: boolean },
    user: AuthUser,
    ip?: string,
  ) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (["perdida", "expirada", "nueva"].includes(q.dealStatus)) {
      throw new BadRequestException("Ofrece el flete cuando la cotización ya está en Odoo (enviada o reservada).");
    }
    await this.assertOdooAmendable(id);
    if (body.clientPickup) {
      await this.prisma.quoteExtra.deleteMany({ where: { quoteId: id, kind: "freight" } });
      await this.prisma.quote.update({
        where: { id },
        data: { clientPickup: true, freightSnapshot: { clientPickup: true } as Prisma.InputJsonValue },
      });
      await this.prisma.quoteEvent.create({ data: { quoteId: id, type: "flete", detail: "Cliente retira en patio" } });
      await this.pushOdooAmend(id);
      return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
    }
    const est = freightConsolidatedEstimate(
      q.lines.map((l) => ({ type: l.type })),
      body.zoneId || "",
      body.vehicle || "cama_baja",
    );
    if (!est) throw new BadRequestException("Zona de flete no válida.");
    const sell = body.sellAmount != null ? Number(body.sellAmount) : est.minSell;
    if (sell + 1e-9 < est.minSell && user.role !== "gerente" && user.role !== "admin") {
      throw new UnprocessableEntityException(
        `El flete no puede venderse bajo el costo más 15% (mínimo ${est.minSell}).`,
      );
    }
    await this.prisma.quoteExtra.deleteMany({ where: { quoteId: id, kind: "freight" } });
    await this.prisma.quoteExtra.create({
      data: {
        quoteId: id,
        kind: "freight",
        label: `Flete a ${est.zoneName} (${FREIGHT_VEHICLE_LABELS[est.vehicle] || est.vehicle})`,
        amount: sell,
        accepted: false,
        meta: est as object,
      },
    });
    await this.prisma.quote.update({
      where: { id },
      data: {
        clientPickup: false,
        freightZoneId: est.zoneId,
        freightVehicle: est.vehicle,
        freightSnapshot: est as object,
      },
    });
    await this.prisma.quoteEvent.create({
      data: { quoteId: id, type: "flete", detail: `${est.zoneName} venta ${sell} (costo ${est.cost})` },
    });
    await this.pushOdooAmend(id);
    await this.audit.log({ user, action: "freight_extra", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async addService(id: string, serviceId: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    await this.assertOdooAmendable(id);
    const svc = await this.prisma.commercialService.findUnique({ where: { id: serviceId } });
    if (!svc) throw new NotFoundException("Servicio comercial no encontrado.");
    await this.prisma.quoteExtra.create({
      data: { quoteId: id, kind: "service", label: svc.name, amount: n(svc.price), accepted: false },
    });
    await this.pushOdooAmend(id);
    await this.audit.log({ user, action: "service_extra", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async acceptExtra(id: string, extraId: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user);
    await this.assertClientProfile(user);
    const extra = q.extras.find((e) => e.id === extraId);
    if (!extra) throw new NotFoundException("Extra no encontrado.");
    await this.assertOdooAmendable(id);
    await this.prisma.quoteExtra.update({ where: { id: extraId }, data: { accepted: true } });
    await this.prisma.quoteEvent.create({
      data: { quoteId: id, type: "extra_aceptado", detail: extra.label },
    });
    await this.pushOdooAmend(id);
    await this.audit.log({ user, action: "accept_extra", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async assign(id: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    const next = await this.setStatus(q, "asignacion_confirmada");
    for (const line of q.lines) {
      await this.prisma.container.update({
        where: { iso: line.iso },
        data: {
          status: q.kind === "alquiler" ? "Alquilado" : "Vendido",
          commercialStatus: q.kind === "alquiler" ? "comprometido_alquiler" : "comprometido_venta",
          reservationExpiry: null,
        },
      });
      await this.prisma.containerHistory.create({
        data: { iso: line.iso, type: "Asignación", detail: `ISO confirmado en ${q.number} — permanece en slot hasta despacho` },
      });
    }
    const closeEvent = q.kind === "alquiler" ? RENT_CLOSE_EVENT : SALE_CLOSE_EVENT;
    const closeJob = await this.prisma.odooSyncJob.create({
      data: {
        quoteId: id,
        event: closeEvent,
        payload: {
          quoteId: id,
          number: q.number,
          from: "pago_validado",
          to: "asignacion_confirmada",
          at: new Date().toISOString(),
          isos: q.lines.map((l) => l.iso),
        },
        status: "pending",
      },
    });
    if (q.kind === "alquiler") {
      void this.rentClose.runJob(closeJob.id).catch((e) => this.log.warn(`rent_close ${id}: ${(e as Error).message}`));
    } else {
      void this.saleClose.runJob(closeJob.id).catch((e) => this.log.warn(`sale_close ${id}: ${(e as Error).message}`));
    }
    await this.audit.log({ user, action: "assign", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(next.id), user.role);
  }

  async schedule(
    id: string,
    body: { date?: string; notes?: string; depotId?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    const yard = yardDispatchReady({
      dealStatus: q.dealStatus,
      odooInvoiceName: q.odooInvoiceName,
      odooInvoiceStatus: q.odooInvoiceStatus,
    });
    if (!yard.ok) throw new UnprocessableEntityException(yard.reason);
    const movement = q.extras.find((e) => e.kind === "movement");
    const moves = movement && typeof movement.meta === "object" && movement.meta && "moves" in movement.meta
      ? Number((movement.meta as { moves?: number }).moves) || 0
      : 0;
    if (moves > FREE_MOVES && !q.movementInformed && !q.movementWaived) {
      throw new UnprocessableEntityException("Debes informar los movimientos de patio (más de 3) antes de programar el despacho.");
    }
    if (!q.movementInformed && !q.movementWaived) {
      throw new UnprocessableEntityException("Informa los movimientos de patio (aunque sean 0) antes de programar.");
    }
    const freight = q.extras.find((e) => e.kind === "freight");
    if (!q.clientPickup && freight && !freight.accepted) {
      throw new UnprocessableEntityException("El cliente debe aceptar el flete, o marcar retiro en patio.");
    }
    if (!q.clientPickup && !freight) {
      throw new UnprocessableEntityException("Ofrece flete o indica que el cliente retira en patio.");
    }
    if (!body.date) throw new BadRequestException("Indica la fecha de despacho.");
    const dispatch = await this.prisma.dispatch.create({
      data: {
        quoteId: id,
        reason: q.kind === "alquiler" ? "alquiler" : "venta",
        status: "Programado",
        depotId: body.depotId || null,
        scheduledDate: new Date(body.date),
        notes: body.notes || "",
        isos: q.lines.map((l) => l.iso),
      },
    });
    const next = await this.setStatus(await this.getQuoteOrThrow(id), "despacho_programado", {
      dispatchDate: new Date(body.date),
      dispatchNotes: body.notes || "",
      dispatchDepotId: body.depotId || null,
    });
    void dispatch;
    await this.audit.log({ user, action: "schedule_dispatch", entity: "Quote", entityId: id, ip });
    return this.presentQuote(next, user.role);
  }

  async markLost(id: string, motivo: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (!(motivo || "").trim()) throw new BadRequestException("Indica el motivo.");
    await this.releaseHold(q);
    const next = await this.setStatus(q, "perdida", { lostReason: motivo.trim() });
    await this.audit.log({ user, action: "lost", entity: "Quote", entityId: id, ip });
    return this.presentQuote(next, user.role);
  }

  private async releaseHold(q: QuoteFull) {
    for (const line of q.lines) {
      const c = await this.prisma.container.findUnique({ where: { iso: line.iso } });
      if (!c) continue;
      if (c.status === "Vendido" || c.status === "Alquilado") continue;
      if (c.reservedQuoteId && c.reservedQuoteId !== q.id) continue;
      await this.prisma.container.update({
        where: { iso: line.iso },
        data: {
          status: "Disponible",
          commercialStatus: "disponible",
          reservedBy: null,
          reservationExpiry: null,
          reservedQuoteId: null,
        },
      });
    }
  }

  async pdf(id: string, user: AuthUser) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user);
    try {
      const replica = await this.quotePdf.capture(id);
      if (replica) return replica;
    } catch (e) {
      this.log.warn(`PDF réplica ${q.number}: ${(e as Error).message}`);
    }
    if (q.pdfStorageKey) {
      try {
        const stored = await this.storage.getBuffer(q.pdfStorageKey);
        return {
          buffer: stored.buffer,
          filename: presupuestoFilename(q.odooSaleName, q.number),
          source: (q.pdfSource === "odoo" ? "odoo" : q.pdfSource === "zdry" ? "zdry" : "prototype") as "odoo" | "zdry" | "prototype",
          storageKey: q.pdfStorageKey,
        };
      } catch {
        /* prototype */
      }
    }
    const types = await this.prisma.containerType.findMany();
    const cats = await this.prisma.category.findMany();
    const buf = buildQuotePdf({
      number: q.number,
      vendorName: q.vendor.name,
      customerName: q.customer.companyName,
      customerDoc: q.customer.rucDni,
      customerEmail: q.customer.email,
      customerPhone: q.customer.phone,
      units: q.lines.map((l) => ({
        iso: l.iso,
        typeLabel: types.find((t) => t.code === l.type)?.label || l.type,
        catLabel: cats.find((c) => c.code === l.cat)?.label || l.cat,
        priceNet: n(l.priceNet),
      })),
      extras: q.extras.map((e) => ({ label: e.label, amount: n(e.amount) })),
    });
    return {
      buffer: buf,
      filename: presupuestoFilename(q.odooSaleName, q.number),
      source: "prototype" as const,
      storageKey: null,
    };
  }

  async cronogramaPdf(id: string, user: AuthUser) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user);
    if (q.kind !== "alquiler") throw new UnprocessableEntityException("El cronograma es de alquiler (Q6).");
    const out = await this.quotePdf.captureCronograma(id, true);
    if (!out) throw new UnprocessableEntityException("Aún no hay SO Odoo para el cronograma.");
    return out;
  }

  async expireHolds() {
    const now = new Date();
    const due = await this.prisma.quote.findMany({
      where: {
        dealStatus: { in: ["reservada", "cotizada", "pago_rechazado"] },
        holdExpiresAt: { lte: now },
        holdPausedAt: null,
        ...(await this.prisma.hideDemo()),
      },
      include: QUOTE_INCLUDE,
    });
    let nExp = 0;
    for (const q of due) {
      if (holdClockPaused(q.dealStatus as DealStatus)) continue;
      await this.releaseHold(q);
      await this.prisma.quote.update({
        where: { id: q.id },
        data: {
          dealStatus: "expirada",
          events: { create: { type: "expirada", detail: "Hold vencido" } },
        },
      });
      nExp++;
    }
    return { expired: nExp };
  }

  async odooQueue() {
    return this.prisma.odooSyncJob.findMany({
      orderBy: { createdAt: "desc" },
      include: { quote: { select: { number: true, dealStatus: true, odooSaleName: true } } },
    });
  }

  async retryQuoteIssue(jobId: string) {
    const job = await this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    if (job?.event === SALE_CLOSE_EVENT) return this.saleClose.retry(jobId);
    if (job?.event === RENT_CLOSE_EVENT) return this.rentClose.retry(jobId);
    if (job?.event === RENT_ISSUE_EVENT) return this.rentIssue.retry(jobId);
    return this.quoteIssue.retry(jobId);
  }

  async closeOdoo(id: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (q.kind === "alquiler") return this.closeRentOdoo(id, user, ip);
    if (q.kind !== "venta") throw new UnprocessableEntityException("Q5 solo cierra venta. Alquiler es Q6.");
    if (q.demo) throw new UnprocessableEntityException("Las cotizaciones demo no se cierran en Odoo.");
    let job = await this.prisma.odooSyncJob.findFirst({
      where: { quoteId: id, event: SALE_CLOSE_EVENT },
      orderBy: { createdAt: "desc" },
    });
    if (!job) {
      job = await this.prisma.odooSyncJob.create({
        data: {
          quoteId: id,
          event: SALE_CLOSE_EVENT,
          payload: { quoteId: id, number: q.number, from: q.dealStatus, to: "asignacion_confirmada" },
          status: "pending",
        },
      });
    } else if (job.status === "error" || job.status === "sent") {
      await this.prisma.odooSyncJob.update({
        where: { id: job.id },
        data: { status: "pending", lastError: null, attempts: 0 },
      });
    }
    await this.saleClose.runJob(job.id);
    await this.audit.log({ user, action: "sale_close", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async closeRentOdoo(id: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (q.kind !== "alquiler") throw new UnprocessableEntityException("Q6 solo cierra alquiler.");
    if (q.demo) throw new UnprocessableEntityException("Las cotizaciones demo no se cierran en Odoo.");
    let job = await this.prisma.odooSyncJob.findFirst({
      where: { quoteId: id, event: RENT_CLOSE_EVENT },
      orderBy: { createdAt: "desc" },
    });
    if (!job) {
      job = await this.prisma.odooSyncJob.create({
        data: {
          quoteId: id,
          event: RENT_CLOSE_EVENT,
          payload: { quoteId: id, number: q.number, from: q.dealStatus, to: "asignacion_confirmada" },
          status: "pending",
        },
      });
    } else if (job.status === "error" || job.status === "sent") {
      await this.prisma.odooSyncJob.update({
        where: { id: job.id },
        data: { status: "pending", lastError: null, attempts: 0 },
      });
    }
    await this.rentClose.runJob(job.id);
    await this.audit.log({ user, action: "rent_close", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async issueOdoo(id: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (q.demo) throw new UnprocessableEntityException("Las cotizaciones demo no se emiten en Odoo.");
    if (q.odooSaleId) return this.presentQuote(q, user.role);
    if (q.kind === "alquiler") {
      const job = await this.rentIssue.enqueue(q.id);
      await this.rentIssue.runJob(job.id);
      await this.audit.log({ user, action: "rent_issue", entity: "Quote", entityId: id, ip });
      return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
    }
    if (q.kind !== "venta") throw new UnprocessableEntityException("Q2 solo emite venta. Alquiler es Q6.");
    const job = await this.quoteIssue.enqueue(q.id);
    await this.quoteIssue.runJob(job.id);
    await this.audit.log({ user, action: "quote_issue", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async grantRent(id: string, priceNet: number, months: number | undefined, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    if (q.kind !== "alquiler") throw new UnprocessableEntityException("La cuota mensual es de alquiler (Q6).");
    if (!Number.isFinite(priceNet) || priceNet < 0) throw new BadRequestException("Cuota inválida.");
    await this.assertOdooAmendable(id);
    const nextMonths = months && months > 0 ? Math.min(120, Math.round(months)) : q.rentMonths || 12;
    const start = q.rentStart || new Date();
    await this.prisma.quote.update({
      where: { id },
      data: {
        rentPriceNet: priceNet,
        rentMonths: nextMonths,
        rentStart: start,
        rentEnd: new Date(`${contractEndDate(start, nextMonths)}T00:00:00.000Z`),
      },
    });
    await this.prisma.quoteEvent.create({
      data: { quoteId: id, type: "cuota_alquiler", detail: `Cuota mensual ${priceNet} · ${nextMonths} meses` },
    });
    await this.pushOdooAmend(id);
    await this.audit.log({ user, action: "grant_rent", entity: "Quote", entityId: id, after: { priceNet, months: nextMonths }, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  async amendOdoo(id: string, user: AuthUser, ip?: string) {
    const q = await this.getQuoteOrThrow(id);
    this.assertAccess(q, user, true);
    await this.assertOdooAmendable(id);
    await this.pushOdooAmend(id);
    await this.audit.log({ user, action: "amend_odoo", entity: "Quote", entityId: id, ip });
    return this.presentQuote(await this.getQuoteOrThrow(id), user.role);
  }

  private async assertOdooAmendable(id: string) {
    try {
      await this.quoteAmend.assertWritable(id);
    } catch (e) {
      this.throwAmend(e);
    }
  }

  private async pushOdooAmend(id: string) {
    try {
      await this.quoteAmend.sync(id);
    } catch (e) {
      this.throwAmend(e);
    }
  }

  private throwAmend(e: unknown): never {
    if (e instanceof QuoteAmendError && (e.code === "confirmed" || e.code === "cancelled")) {
      throw new ConflictException(amendConflictBody(e));
    }
    if (e instanceof QuoteAmendError) throw new UnprocessableEntityException(e.message);
    throw e;
  }

  private assertPedidoDoesNotCloseOdoo(from: DealStatus, to: DealStatus) {
    try {
      assertPedidoKeepsOdooDraft(from, to);
    } catch (e) {
      if (e instanceof QuotePedidoError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
  }

  async commercialServices() {
    return this.prisma.commercialService.findMany({ orderBy: { name: "asc" } });
  }
}
