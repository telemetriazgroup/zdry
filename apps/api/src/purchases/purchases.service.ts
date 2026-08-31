import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthUser, canSeeRealCosts } from "../auth/auth.types";
import { damFormatOk, isNationalized, parseIso6346, requiresNationalization } from "../domain/iso6346";
import { ACTIVE_MASTER } from "../domain/masters";
import { applyShowPrice, DEFAULT_VISIBILITY_RULES, type VisibilityRule } from "../domain/visibility";
import {
  INCOTERMS,
  MANUFACTURERS,
  PURCHASE_EXTRA_SERVICES,
  PURCHASE_LOGISTICS_OPTIONS,
  normalizePurchaseExtras,
} from "../domain/purchase-extras";
import {
  MAX_PURCHASE_DOCS,
  MAX_PURCHASE_DOC_BYTES,
  PURCHASE_DOC_KINDS,
  extForMime,
  isImageMime,
  isPdfMime,
  isPurchaseDocKind,
  sniffPurchaseDocMime,
} from "../domain/purchase-docs";
import { StorageService } from "../storage/storage.service";
import { randomUUID } from "crypto";

export type InvoiceLineInput = {
  iso: string;
  type: string;
  cat: string;
  year?: number | null;
  manufacturer?: string;
  price: number;
  bl?: string;
  manifest?: string;
  isoOverride?: boolean;
  isoExceptionReason?: string;
};

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async meta() {
    const providers = await this.prisma.provider.findMany({ orderBy: { name: "asc" } });
    return {
      incoterms: INCOTERMS,
      logistics: PURCHASE_LOGISTICS_OPTIONS,
      extraServices: PURCHASE_EXTRA_SERVICES,
      manufacturers: MANUFACTURERS,
      providers,
      docKinds: PURCHASE_DOC_KINDS,
      maxDocs: MAX_PURCHASE_DOCS,
      maxDocBytes: MAX_PURCHASE_DOC_BYTES,
    };
  }

  validateIso(raw: string) {
    return parseIso6346(raw);
  }

  async badges() {
    const demoOn = await this.prisma.demoOn();
    const extrasWhere: Prisma.PendingExtraCostWhereInput = demoOn
      ? { status: "pending" }
      : { status: "pending", invoice: { demo: false } };
    const [extras, dam] = await Promise.all([
      this.prisma.pendingExtraCost.count({ where: extrasWhere }),
      this.prisma.container.count({
        where: { intakeType: { in: ["compra", "pendiente_factura"] }, damNumber: null, ...(await this.prisma.hideDemo()) },
      }),
    ]);
    return { extras, dam };
  }

  async listInvoices() {
    const rows = await this.prisma.purchaseInvoice.findMany({
      where: await this.prisma.hideDemo(),
      orderBy: { createdAt: "desc" },
      include: {
        lines: true,
        pendingExtras: true,
        containers: { select: { iso: true, bl: true, damNumber: true } },
        documents: { orderBy: { createdAt: "asc" } },
      },
    });
    return rows.map((pi) => this.presentInvoice(pi));
  }

  async createInvoice(
    input: {
      number?: string;
      providerName: string;
      incoterm: string;
      logistics: string;
      depotId: string;
      extras?: Record<string, { enabled?: boolean }>;
      lines: InvoiceLineInput[];
    },
    user: AuthUser,
    ip?: string,
  ) {
    if (!input.providerName?.trim()) throw new BadRequestException("Selecciona el proveedor.");
    if (!input.lines?.length) throw new BadRequestException("Ingresa los códigos ISO y genera las filas de detalle.");
    const depot = await this.prisma.depot.findUnique({ where: { id: input.depotId } });
    if (!depot || depot.archivedAt) throw new BadRequestException("Depósito de ingreso inválido.");
    const typeCodes = new Set((await this.prisma.containerType.findMany({ where: ACTIVE_MASTER })).map((t) => t.code));
    const catCodes = new Set((await this.prisma.category.findMany({ where: ACTIVE_MASTER })).map((c) => c.code));

    const seen = new Set<string>();
    const parsedLines = input.lines.map((line, idx) => {
      const check = parseIso6346(line.iso);
      if (!check.valid) {
        throw new BadRequestException(`Código inválido "${line.iso}": ${check.reason}`);
      }
      const iso = check.code!;
      if (seen.has(iso)) throw new ConflictException(`Código duplicado: ${iso}`);
      seen.add(iso);
      if (!check.checkOk && !line.isoOverride) {
        throw new UnprocessableEntityException(
          `"${iso}" no pasa el dígito de control ISO 6346 (esperado ${check.expectedCheckDigit}). Usa "Modificar" para corregirlo o "Mantener igual" si es un caso especial conocido.`,
        );
      }
      if (line.isoOverride && !String(line.isoExceptionReason || "").trim()) {
        throw new BadRequestException(`La excepción ISO de "${iso}" requiere un motivo.`);
      }
      if (!(Number(line.price) > 0)) {
        throw new BadRequestException(`Falta el precio de "${iso}" — cada contenedor tiene su propio precio.`);
      }
      if (!typeCodes.has(line.type)) throw new BadRequestException(`Tipo inválido en fila ${idx + 1}`);
      if (!catCodes.has(line.cat)) throw new BadRequestException(`Condición inválida en fila ${idx + 1}`);
      return { ...line, iso, check };
    });

    const existing = await this.prisma.container.findMany({ where: { iso: { in: parsedLines.map((l) => l.iso) } } });
    if (existing.length) {
      throw new ConflictException(`Código duplicado o ya existente: ${existing.map((c) => c.iso).join(", ")}`);
    }

    const extras = normalizePurchaseExtras(input.logistics, input.extras);
    const amount = parsedLines.reduce((s, l) => s + Number(l.price), 0);
    const number = input.number?.trim() || `F-${Date.now()}`;
    const providers = await this.prisma.provider.findMany();

    let invoice;
    try {
    invoice = await this.prisma.$transaction(async (tx) => {
      const pi = await tx.purchaseInvoice.create({
        data: {
          number,
          providerName: input.providerName.trim(),
          incoterm: input.incoterm,
          logistics: input.logistics,
          amount,
          extras: extras as Prisma.InputJsonValue,
        },
      });

      for (const line of parsedLines) {
        await tx.purchaseInvoiceLine.create({
          data: {
            invoiceId: pi.id,
            iso: line.iso,
            type: line.type,
            cat: line.cat,
            year: line.year || null,
            manufacturer: line.manufacturer || "—",
            price: line.price,
            bl: line.bl || "",
            manifest: line.manifest || "",
            isoException: !!line.isoOverride,
          },
        });
        await tx.container.create({
          data: {
            iso: line.iso,
            type: line.type,
            cat: line.cat,
            status: "Pendiente de ingreso",
            year: line.year || null,
            manufacturer: line.manufacturer || "—",
            depotId: input.depotId,
            intakeType: "compra",
            physicallyReceived: false,
            isoException: !!line.isoOverride,
            isoExceptionReason: line.isoOverride ? line.isoExceptionReason : null,
            fobCif: line.price,
            bl: line.bl || "",
            manifest: line.manifest || "",
            purchaseInvoiceId: pi.id,
          },
        });
        const extraNote = line.isoOverride ? ` Excepción ISO: ${line.isoExceptionReason}.` : "";
        const docs = line.bl || line.manifest ? ` BL: ${line.bl || "—"}, Manifiesto: ${line.manifest || "—"}.` : "";
        await tx.containerHistory.create({
          data: {
            iso: line.iso,
            type: "Ingreso",
            detail: `Unidad registrada por factura de compra ${number} — proveedor ${input.providerName.trim()} — precio USD ${Number(line.price).toFixed(2)}. Pendiente de recepción física en Almacén.${extraNote}${docs}`,
          },
        });
      }

      for (const s of PURCHASE_EXTRA_SERVICES) {
        if (!extras[s.key]?.enabled) continue;
        const suggested =
          providers.find((p) => p.type === s.defaultProviderType)?.name || "";
        await tx.pendingExtraCost.create({
          data: {
            purchaseInvoiceId: pi.id,
            serviceKey: s.key,
            serviceLabel: s.label,
            suggestedProvider: suggested,
            isos: parsedLines.map((l) => l.iso),
            status: "pending",
          },
        });
      }

      return tx.purchaseInvoice.findUniqueOrThrow({
        where: { id: pi.id },
        include: {
          lines: true,
          pendingExtras: true,
          containers: { select: { iso: true, bl: true, damNumber: true } },
          documents: { orderBy: { createdAt: "asc" } },
        },
      });
    });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Código duplicado o ya existente");
      }
      throw e;
    }

    await this.audit.log({
      user,
      action: "create",
      entity: "PurchaseInvoice",
      entityId: invoice.id,
      after: { number, isos: parsedLines.map((l) => l.iso), logistics: input.logistics },
      ip,
    });

    return this.presentInvoice(invoice);
  }

  async pendingExtras() {
    const demoOn = await this.prisma.demoOn();
    const rows = await this.prisma.pendingExtraCost.findMany({
      where: demoOn ? { status: "pending" } : { status: "pending", invoice: { demo: false } },
      orderBy: { createdAt: "desc" },
      include: { invoice: { select: { number: true, providerName: true, logistics: true } } },
    });
    return rows.map((p) => ({
      ...p,
      purchaseNumber: p.invoice.number,
      provider: p.suggestedProvider,
    }));
  }

  async damPending() {
    const rows = await this.prisma.container.findMany({
        where: { intakeType: { in: ["compra", "pendiente_factura"] }, damNumber: null, ...(await this.prisma.hideDemo()) },
      include: { depot: { select: { name: true } }, purchaseInvoice: { select: { number: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((c) => this.presentContainerDam(c));
  }

  async damDone() {
    const rows = await this.prisma.container.findMany({
        where: { damNumber: { not: null }, ...(await this.prisma.hideDemo()) },
      orderBy: { nationalizedAt: "desc" },
      take: 50,
    });
    return rows.map((c) => this.presentContainerDam(c));
  }

  async submitDam(
    input: { iso: string; bl: string; manifest: string; damNumber: string },
    user: AuthUser,
    ip?: string,
  ) {
    const c = await this.prisma.container.findUnique({ where: { iso: input.iso } });
    if (!c) throw new NotFoundException("Selecciona la unidad a nacionalizar.");
    if (!requiresNationalization(c.intakeType)) {
      throw new BadRequestException("Esta unidad no requiere DAM.");
    }
    if (c.damNumber) throw new BadRequestException("Ya está nacionalizada.");
    if (!input.bl?.trim() || !input.manifest?.trim()) {
      throw new BadRequestException("Ingresa el BL y el Manifiesto — el agente de aduana los necesita para tramitar la DAM.");
    }
    if (!damFormatOk(input.damNumber)) {
      throw new BadRequestException("El número de DAM no tiene el formato esperado (ej. 118-2026-40-81593).");
    }
    const updated = await this.prisma.container.update({
      where: { iso: c.iso },
      data: {
        bl: input.bl.trim(),
        manifest: input.manifest.trim(),
        damNumber: input.damNumber.trim(),
        nationalizedAt: new Date(),
      },
    });
    await this.prisma.containerHistory.create({
      data: {
        iso: c.iso,
        type: "Nacionalización",
        detail: `DAM ${updated.damNumber} registrada (BL ${updated.bl}, Manifiesto ${updated.manifest}) — unidad nacionalizada, ya puede despacharse.`,
      },
    });
    await this.audit.log({
      user,
      action: "nationalize",
      entity: "Container",
      entityId: c.iso,
      after: { damNumber: updated.damNumber },
      ip,
    });
    return this.presentContainerDam(updated);
  }

  async listContainersForRole(role: AuthUser["role"]) {
    const [rows, visRows] = await Promise.all([
      this.prisma.container.findMany({
        where: await this.prisma.hideDemo(),
        include: { depot: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.visibilityRule.findMany(),
    ]);
    const vis = visRows.length
      ? visRows.map((r) => ({ scope: r.scope, target: r.target, show: r.show }))
      : DEFAULT_VISIBILITY_RULES;
    return rows.map((c) => this.presentInventory(c, role, vis));
  }

  async attachDocuments(
    invoiceId: string,
    files: { buffer: Buffer; originalname: string; size: number }[],
    kinds: string[],
    user: AuthUser,
    ip?: string,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      include: { documents: true },
    });
    if (!invoice) throw new NotFoundException("Factura de compra no encontrada.");
    if (!files?.length) throw new BadRequestException("Selecciona al menos un archivo (PDF o imagen).");
    if (invoice.documents.length + files.length > MAX_PURCHASE_DOCS) {
      throw new BadRequestException(`Máximo ${MAX_PURCHASE_DOCS} documentos por factura de compra.`);
    }

    const created = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_PURCHASE_DOC_BYTES) {
        throw new BadRequestException(`"${file.originalname}" supera el máximo de 15 MB.`);
      }
      let mime: string;
      try {
        mime = sniffPurchaseDocMime(file.buffer);
      } catch (e) {
        throw new BadRequestException(`${file.originalname}: ${(e as Error).message}`);
      }
      const kindRaw = kinds[i] || kinds[0] || "factura";
      const kind = isPurchaseDocKind(kindRaw) ? kindRaw : "otro";
      const ext = extForMime(mime);
      const storageKey = `purchases/${invoice.id}/${randomUUID()}.${ext}`;
      await this.storage.put(storageKey, file.buffer, mime);
      const originalName = String(file.originalname || `documento.${ext}`)
        .replace(/[/\\]/g, "_")
        .slice(0, 180);
      const row = await this.prisma.purchaseDocument.create({
        data: {
          purchaseInvoiceId: invoice.id,
          kind,
          originalName,
          mimeType: mime,
          sizeBytes: file.size,
          storageKey,
        },
      });
      created.push(row);
    }

    await this.audit.log({
      user,
      action: "upload",
      entity: "PurchaseDocument",
      entityId: invoice.id,
      after: { files: created.map((d) => ({ id: d.id, kind: d.kind, name: d.originalName })) },
      ip,
    });

    return created.map((d) => this.presentDoc(d));
  }

  async openDocument(id: string) {
    const doc = await this.prisma.purchaseDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException("Documento no encontrado.");
    const file = await this.storage.get(doc.storageKey);
    return { ...file, mimeType: doc.mimeType, originalName: doc.originalName, sizeBytes: doc.sizeBytes };
  }

  extraStatus(pi: { extras: Prisma.JsonValue; pendingExtras: { serviceKey: string; status: string }[] }, key: string) {
    const extras = (pi.extras || {}) as Record<string, { enabled?: boolean }>;
    if (!extras[key]?.enabled) return "included";
    const pending = pi.pendingExtras.find((p) => p.serviceKey === key && p.status === "pending");
    if (pending) return "pending";
    return "unpaid";
  }

  private presentInvoice(pi: {
    id: string;
    number: string;
    providerName: string;
    incoterm: string;
    logistics: string;
    amount: Prisma.Decimal;
    extras: Prisma.JsonValue;
    createdAt: Date;
    lines: { iso: string; type: string; cat: string; price: Prisma.Decimal; bl: string; manifest: string }[];
    pendingExtras: { id: string; serviceKey: string; serviceLabel: string; suggestedProvider: string; status: string; isos: string[] }[];
    containers: { iso: string; bl: string; damNumber: string | null }[];
    documents?: { id: string; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: Date }[];
  }) {
    const extraStatuses = Object.fromEntries(
      PURCHASE_EXTRA_SERVICES.map((s) => [s.key, this.extraStatus(pi, s.key)]),
    );
    return {
      id: pi.id,
      number: pi.number,
      providerName: pi.providerName,
      incoterm: pi.incoterm,
      logistics: pi.logistics,
      amount: Number(pi.amount),
      extras: pi.extras,
      extraStatuses,
      createdAt: pi.createdAt,
      lines: pi.lines.map((l) => ({ ...l, price: Number(l.price) })),
      pendingExtras: pi.pendingExtras,
      documents: (pi.documents || []).map((d) => this.presentDoc(d)),
      blComplete: pi.containers.length > 0 && pi.containers.every((c) => !!c.bl),
    };
  }

  private presentDoc(d: {
    id: string;
    kind: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }) {
    return {
      id: d.id,
      kind: d.kind,
      kindLabel: PURCHASE_DOC_KINDS.find((k) => k.key === d.kind)?.label || d.kind,
      originalName: d.originalName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      isImage: isImageMime(d.mimeType),
      isPdf: isPdfMime(d.mimeType),
    };
  }

  private presentContainerDam(c: {
    iso: string;
    type: string;
    cat: string;
    intakeType: string;
    bl: string;
    manifest: string;
    damNumber: string | null;
    nationalizedAt: Date | null;
    depot?: { name: string };
    purchaseInvoice?: { number: string } | null;
  }) {
    return {
      iso: c.iso,
      type: c.type,
      cat: c.cat,
      intakeType: c.intakeType,
      bl: c.bl,
      manifest: c.manifest,
      damNumber: c.damNumber,
      nationalizedAt: c.nationalizedAt,
      depot: c.depot?.name,
      invoiceNumber: c.purchaseInvoice?.number,
      requiresDam: requiresNationalization(c.intakeType),
      nationalized: isNationalized(c.intakeType, c.damNumber),
    };
  }

  presentInventory(
    c: {
      iso: string;
      type: string;
      cat: string;
      status: string;
      fobCif: Prisma.Decimal;
      priceList: Prisma.Decimal | null;
      priceMin: Prisma.Decimal | null;
      damNumber: string | null;
      physicallyReceived: boolean;
      intakeType: string;
      manufacturer?: string | null;
      showPriceOverride?: boolean | null;
      lado: string | null;
      ruma: number | null;
      columna: number | null;
      nivel: number | null;
      demo?: boolean;
      depot: { name: string };
    },
    role: AuthUser["role"],
    vis: VisibilityRule[] = DEFAULT_VISIBILITY_RULES,
  ) {
    const fob = Number(c.fobCif);
    const pos = c.lado
      ? `Lado ${c.lado} · Ruma ${c.ruma} · Columna ${c.columna} · Nivel ${c.nivel}`
      : "Sin posición asignada";
    const base: Record<string, unknown> = {
      iso: c.iso,
      type: c.type,
      cat: c.cat,
      status: c.status,
      demo: !!c.demo,
      depot: c.depot.name,
      physicallyReceived: c.physicallyReceived,
      nationalized: isNationalized(c.intakeType, c.damNumber),
      lado: c.lado,
      ruma: c.ruma,
      columna: c.columna,
      nivel: c.nivel,
      posLabel: pos,
      showPrice: applyShowPrice(
        {
          iso: c.iso,
          type: c.type,
          cat: c.cat,
          manufacturer: c.manufacturer,
          priceVisibilityOverride: c.showPriceOverride,
          status: c.status,
        },
        vis,
      ),
    };
    if (role !== "almacen") {
      base.priceList = c.priceList != null ? Number(c.priceList) : null;
      base.priceMin = c.priceMin != null ? Number(c.priceMin) : null;
    }
    if (canSeeRealCosts(role)) {
      base.costs = { fob, cT: fob, cTReal: fob };
    }
    return base;
  }
}
