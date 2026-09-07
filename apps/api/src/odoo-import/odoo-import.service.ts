import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OdooClient } from "../odoo/odoo.client";
import { AuthUser } from "../auth/auth.types";
import {
  buildOdooSource,
  guessColor,
  inferCatFromProduct,
  inferTypeFromProduct,
  inspectOdooIso,
  isOdooOwnedField,
  lotReadFieldNames,
  mappedOdooKeys,
  mergeFieldCatalog,
  ODOO_OWNED_FIELDS,
  ODOO_OWNED_LABELS,
  ODOO_OWNED_NEEDLES,
  pickFieldByLabel,
  readLotAttrs,
  titleFromLocation,
  coerceOdooWriteValue,
} from "../domain/odoo-lot-map";
import { listOdooLotPhotos, openOdooLotPhoto } from "../odoo/odoo-lot-photos";
import { parseSerialsFromPoText, purchaseRefFromOrder, type OdooPurchaseRef } from "../domain/odoo-purchase";

const DRY_DOMAIN = ["|", ["name", "ilike", "contenedor dry"], ["name", "ilike", "dry"]];

@Injectable()
export class OdooImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly audit: AuditService,
  ) {}

  probe() {
    return this.odoo.probe();
  }

  async list(status?: string) {
    const where = status
      ? { status }
      : { status: { in: ["pending", "qty_anomaly", "assimilated"] } };
    return this.prisma.odooLotCandidate.findMany({
      where,
      orderBy: [{ iso6346Ok: "asc" }, { isoNormalized: "asc" }],
      take: 2000,
    });
  }

  async sync(user: AuthUser, ip?: string) {
    const probe = await this.odoo.probe();
    if (!probe.ok) throw new BadRequestException(probe.message);

    const products = await this.odoo.searchRead("product.product", DRY_DOMAIN, ["id", "name", "default_code", "categ_id"], {
      limit: 400,
    });
    const productIds = products.map((p) => Number(p.id));
    if (!productIds.length) {
      return { ok: true, products: 0, quants: 0, upserted: 0, message: "Odoo no devolvió productos DRY." };
    }
    const productMap = new Map(products.map((p) => [Number(p.id), p]));

    const quants = await this.odoo.searchRead(
      "stock.quant",
      [
        ["product_id", "in", productIds],
        ["quantity", ">", 0],
        ["lot_id", "!=", false],
        ["location_id.usage", "=", "internal"],
      ],
      ["id", "lot_id", "location_id", "quantity", "product_id"],
      { limit: 2000 },
    );

    const lotIds = [...new Set(quants.map((q) => this.relId(q.lot_id)).filter((n): n is number => n > 0))];
    const lotMeta = await this.lotMeta();
    const lots = lotIds.length ? await this.hydrateLots(lotIds, lotMeta) : [];
    const lotMap = new Map(lots.map((l) => [Number(l.id), l]));
    let incomplete = 0;

    const now = new Date();
    const seen = new Set<number>();
    let upserted = 0;

    for (const q of quants) {
      const lotId = this.relId(q.lot_id);
      if (!lotId || seen.has(lotId)) continue;
      seen.add(lotId);
      const lot = lotMap.get(lotId);
      const product = productMap.get(this.relId(q.product_id) || this.relId(lot?.product_id));
      const attrs = readLotAttrs(lot, lotMeta.fields);
      const serialRaw = attrs.serialRaw || this.relName(q.lot_id);
      const iso = inspectOdooIso(serialRaw);
      if (!iso.isoNormalized) continue;

      const qty = this.sumQty(quants, lotId);
      const locationName = this.relName(q.location_id);
      const productName = String(product?.name || this.relName(lot?.product_id) || "");
      const productCode = String(product?.default_code || "");
      const row = {
        odooLotId: lotId,
        odooWriteDate: this.asDate(lot?.write_date),
        serialRaw,
        isoNormalized: iso.isoNormalized,
        iso6346Ok: iso.iso6346Ok,
        productName,
        productCode,
        locationName,
        locationOdooId: this.relId(q.location_id) || null,
        qtyOnHand: qty,
        color: attrs.color,
        tareKg: attrs.tareKg,
        mgwKg: attrs.mgwKg,
        year: attrs.year,
        manufacturer: attrs.manufacturer,
        dua: attrs.dua,
        originCountry: attrs.originCountry,
        material: attrs.material,
        zgroupCode: attrs.zgroupCode,
        payload: {
          lot,
          quantLocation: q.location_id,
          attrs,
          fieldMap: lotMeta.map,
          productName,
          productCode,
        } as Prisma.InputJsonValue,
        lastSyncedAt: now,
        status: qty === 1 ? "pending" : "qty_anomaly",
      };

      if (!this.hasOwnedValues(attrs) && !attrs.year && !attrs.manufacturer) incomplete += 1;

      const existing = await this.prisma.odooLotCandidate.findUnique({ where: { odooLotId: lotId } });
      const data = this.mergeSyncRow(existing, row);
      if (existing?.status === "assimilated" || existing?.status === "ignored") {
        await this.prisma.odooLotCandidate.update({
          where: { odooLotId: lotId },
          data: {
            ...data,
            status: existing.status,
            containerIso: existing.containerIso,
            assimilatedAt: existing.assimilatedAt,
          },
        });
        if (existing.status === "assimilated" && existing.containerIso && !existing.localTouched) {
          await this.fillEmptyFromOdoo(existing.containerIso, { ...row, locationName, material: attrs.material, zgroupCode: attrs.zgroupCode });
        }
      } else {
        await this.prisma.odooLotCandidate.upsert({
          where: { odooLotId: lotId },
          create: {
            ...row,
            zdryType: inferTypeFromProduct(productName, productCode, "40HC"),
            zdryCat: inferCatFromProduct(productName, "ASIS"),
          },
          update: data,
        });
      }
      upserted += 1;
    }

    await this.prisma.odooLotCandidate.updateMany({
      where: { status: { in: ["pending", "qty_anomaly"] }, odooLotId: { notIn: [...seen] } },
      data: { status: "off_hand" },
    });

    const purchaseHits = await this.attachPurchaseRefs([...seen]);

    await this.audit.log({
      user,
      action: "odoo_lot_sync",
      entity: "OdooLotCandidate",
      after: { products: products.length, quants: quants.length, upserted, purchaseHits },
      ip,
    });

    const isoReview = await this.prisma.odooLotCandidate.count({ where: { status: "pending", iso6346Ok: false } });
    const message = [
      `Listo. ${seen.size} lotes a la mano (existencias internas) cargados en ZDRY.`,
      incomplete ? `${incomplete} ficha(s) sin tara/color/DUA en Odoo.` : "Fichas locales listas: abre una para editar.",
      purchaseHits ? `${purchaseHits} lote(s) con OC/factura referenciada.` : "",
      isoReview ? `${isoReview} serial(es) por revisar ISO.` : "",
      "Odoo solo se escribe cuando guardas un cambio.",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      ok: true,
      products: products.length,
      quants: quants.length,
      lots: seen.size,
      upserted,
      incomplete,
      isoReview,
      message,
    };
  }

  async assimilate(ids: string[], user: AuthUser, ip?: string) {
    if (!ids?.length) throw new BadRequestException("Elige al menos un lote.");
    const out: { iso: string; created: boolean; isoReview: boolean }[] = [];
    for (const id of ids) {
      const cand = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
      if (!cand) throw new NotFoundException("Candidato no encontrado.");
      out.push(await this.assimilateOne(cand, user, ip));
    }
    return { ok: true, items: out };
  }

  private async assimilateOne(
    cand: {
      id: string;
      odooLotId: number;
      serialRaw: string;
      isoNormalized: string;
      iso6346Ok: boolean;
      productName: string;
      productCode: string;
      locationName: string;
      color: string | null;
      tareKg: number | null;
      mgwKg: number | null;
      year: number | null;
      manufacturer: string | null;
      dua: string | null;
      originCountry: string | null;
      odooPoName?: string | null;
      odooPoId?: number | null;
      odooVendorName?: string | null;
      odooBillName?: string | null;
      odooUnitPrice?: Prisma.Decimal | number | null;
      qtyOnHand: number;
      payload?: unknown;
      zdryType?: string | null;
      zdryCat?: string | null;
    },
    user: AuthUser,
    ip?: string,
  ) {
    const isoInfo = inspectOdooIso(cand.serialRaw || cand.isoNormalized);
    const iso = isoInfo.isoNormalized;
    if (!iso) throw new BadRequestException("Ese lote no tiene serial.");

    const existing = await this.prisma.container.findUnique({ where: { iso } });
    if (existing) {
      await this.prisma.odooLotCandidate.update({
        where: { id: cand.id },
        data: { status: "assimilated", containerIso: existing.iso, assimilatedAt: new Date() },
      });
      await this.fillEmptyFromOdoo(iso, cand);
      return { iso, created: false, isoReview: !isoInfo.iso6346Ok || existing.isoException };
    }

    const depot = await this.ensureDepot(cand.locationName);
    const types = await this.prisma.containerType.findMany({ where: { archivedAt: null } });
    const cats = await this.prisma.category.findMany({ where: { archivedAt: null } });
    const typeCode = this.pickCode(
      types.map((t) => t.code),
      cand.zdryType || inferTypeFromProduct(cand.productName, cand.productCode, types[0]?.code || "40HC"),
    );
    const catCode = this.pickCode(
      cats.map((c) => c.code),
      cand.zdryCat || inferCatFromProduct(cand.productName, cats.find((c) => c.code === "ASIS")?.code || cats[0]?.code || "ASIS"),
    );
    const mapped = this.mappedFromCandidate(cand);
    const source = this.sourceFromCandidate(cand);

    await this.prisma.$transaction(async (tx) => {
      await tx.container.create({
        data: {
          iso,
          type: typeCode,
          cat: catCode,
          status: "Disponible",
          year: mapped.year,
          manufacturer: mapped.manufacturer,
          depotId: depot.id,
          color: mapped.color,
          tareKg: mapped.tareKg,
          mgwKg: mapped.mgwKg,
          payloadKg: mapped.payloadKg,
          intakeType: "pendiente_factura",
          invoicePending: true,
          physicallyReceived: true,
          physicalStatus: "en_patio",
          fobCif: 0,
          isoException: isoInfo.isoException,
          isoExceptionReason: isoInfo.isoException ? "Serial Odoo no cumple ISO 6346 — revisar en campo" : null,
          intakeOrigin: "odoo",
          odooLotId: cand.odooLotId,
          odooLocation: cand.locationName,
          odooDua: cand.dua,
          odooPoName: cand.odooPoName,
          odooPoId: cand.odooPoId,
          odooVendorName: cand.odooVendorName,
          odooBillName: cand.odooBillName,
          odooUnitPrice: cand.odooUnitPrice,
          originCountry: cand.originCountry,
          odooSource: source as Prisma.InputJsonValue,
          inspectionNotes: mapped.notes,
          mediaStatus: "pendiente",
          registeredById: user.id,
          registeredByName: user.name,
        },
      });
      await tx.containerHistory.create({
        data: {
          iso,
          type: "Integración Odoo",
          detail: `Asimilado desde Odoo lote ${cand.odooLotId} (${cand.serialRaw}). Almacén: ${cand.locationName || "—"}. ${isoInfo.isoException ? "ISO 6346 pendiente de revisión." : "ISO 6346 válido."} Regularizar fotos y datos en Recepción.`,
        },
      });
      await tx.odooLotCandidate.update({
        where: { id: cand.id },
        data: { status: "assimilated", containerIso: iso, assimilatedAt: new Date() },
      });
    });

    await this.audit.log({
      user,
      action: "odoo_assimilate",
      entity: "Container",
      entityId: iso,
      after: { odooLotId: cand.odooLotId, isoException: isoInfo.isoException, depot: depot.name },
      ip,
    });
    return { iso, created: true, isoReview: isoInfo.isoException };
  }

  async getOne(id: string, opts: { refresh?: boolean } = {}) {
    if (opts.refresh) await this.refreshCandidateFromOdoo(id);
    const row = await this.prisma.odooLotCandidate.findUnique({
      where: { id },
      include: { writebacks: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
    if (!row) throw new NotFoundException("Candidato no encontrado.");
    const [types, cats] = await Promise.all([
      this.prisma.containerType.findMany({ where: { archivedAt: null }, orderBy: { code: "asc" } }),
      this.prisma.category.findMany({ where: { archivedAt: null }, orderBy: { code: "asc" } }),
    ]);
    const fieldStatus = Object.fromEntries(
      ODOO_OWNED_FIELDS.map((f) => {
        const last = row.writebacks.find((w) => w.field === f);
        return [f, last?.status === "pending" ? "deferred" : last?.status === "error" ? "error" : row.odooSyncStatus || "live"];
      }),
    );
    return {
      ...row,
      fieldStatus,
      odooFields: ODOO_OWNED_FIELDS.map((key) => ({
        key,
        label: ODOO_OWNED_LABELS[key],
        value: row[key],
        sync: fieldStatus[key],
      })),
      types: types.map((t) => ({ code: t.code, label: t.label })),
      categories: cats.map((c) => ({ code: c.code, label: c.label, color: c.color })),
      fieldMap: (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as { fieldMap?: unknown }).fieldMap
        : null),
    };
  }

  async patch(
    id: string,
    body: Record<string, unknown>,
    user: AuthUser,
    ip?: string,
  ) {
    const row = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Candidato no encontrado.");
    const data: Prisma.OdooLotCandidateUpdateInput = {};
    const changedOwned: string[] = [];

    if (body.color !== undefined) data.color = this.str(body.color);
    if (body.tareKg !== undefined) data.tareKg = this.num(body.tareKg);
    if (body.mgwKg !== undefined) data.mgwKg = this.num(body.mgwKg);
    if (body.year !== undefined) data.year = this.year(body.year);
    if (body.manufacturer !== undefined) data.manufacturer = this.str(body.manufacturer);
    if (body.dua !== undefined) data.dua = this.str(body.dua);
    if (body.originCountry !== undefined) data.originCountry = this.str(body.originCountry);
    if (body.material !== undefined) data.material = this.str(body.material);
    if (body.zdryType !== undefined) data.zdryType = this.str(body.zdryType);
    if (body.zdryCat !== undefined) data.zdryCat = this.str(body.zdryCat);
    if (body.zdryNotes !== undefined) data.zdryNotes = String(body.zdryNotes || "");

    for (const key of ODOO_OWNED_FIELDS) {
      if (body[key] !== undefined && String(row[key] ?? "") !== String(data[key as keyof typeof data] ?? body[key] ?? "")) {
        changedOwned.push(key);
      }
    }

    if (changedOwned.length) {
      data.localTouched = true;
      data.odooSyncStatus = "deferred";
      data.odooSyncError = null;
    }

    await this.prisma.odooLotCandidate.update({ where: { id }, data });

    for (const field of changedOwned) {
      const value = (await this.prisma.odooLotCandidate.findUnique({ where: { id } }))?.[field as "color"];
      await this.prisma.odooFieldWriteback.create({
        data: { candidateId: id, field, value: (value ?? "") as Prisma.InputJsonValue },
      });
    }

    const saved = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (saved?.containerIso) {
      await this.applyCandidateToContainer(saved.containerIso, saved);
    }

    let flush: { ok: boolean; flushed: number; message?: string } | null = null;
    if (changedOwned.length) {
      flush = await this.flushWritebacks(id);
    }

    await this.audit.log({
      user,
      action: "odoo_ficha_save",
      entity: "OdooLotCandidate",
      entityId: id,
      after: { changedOwned, zdryType: String(body.zdryType ?? ""), zdryCat: String(body.zdryCat ?? "") },
      ip,
    });
    const out = await this.getOne(id);
    return {
      ...out,
      writeback: flush,
      saveMessage: !changedOwned.length
        ? "Guardado en ZDRY."
        : flush?.ok
          ? "Guardado en ZDRY y actualizado en Odoo."
          : `Guardado en ZDRY. Odoo no aceptó el cambio: ${flush?.message || out.odooSyncError || "error"}`,
    };
  }

  async flushWritebacks(candidateId?: string) {
    const pending = await this.prisma.odooFieldWriteback.findMany({
      where: { status: { in: ["pending", "error"] }, ...(candidateId ? { candidateId } : {}) },
      include: { candidate: true },
      take: 80,
      orderBy: { createdAt: "asc" },
    });
    if (!pending.length) return { ok: true, flushed: 0 };

    let fields: Record<string, { string?: string; type?: string; selection?: [string, string][] }> = {};
    try {
      fields = await this.odoo.fieldsGet("stock.lot");
    } catch (e) {
      const message = (e as Error).message;
      await this.prisma.odooFieldWriteback.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { status: "error", lastError: message, attempts: { increment: 1 } },
      });
      if (candidateId) {
        await this.prisma.odooLotCandidate.update({
          where: { id: candidateId },
          data: { odooSyncStatus: "error", odooSyncError: message },
        });
      }
      return { ok: false, flushed: 0, message };
    }

    let flushed = 0;
    const byLot = new Map<string, typeof pending>();
    for (const job of pending) {
      const list = byLot.get(job.candidateId) || [];
      list.push(job);
      byLot.set(job.candidateId, list);
    }

    for (const jobs of byLot.values()) {
      const cand = jobs[0].candidate;
      const storedMap = (cand.payload && typeof cand.payload === "object" && !Array.isArray(cand.payload)
        ? (cand.payload as { fieldMap?: Record<string, string[]> }).fieldMap
        : null) || {};
      const values: Record<string, unknown> = {};
      for (const job of jobs) {
        if (!isOdooOwnedField(job.field)) continue;
        const odooKey = storedMap[job.field]?.find((k) => k && !/^enable_/i.test(k)) || pickFieldByLabel(fields, ODOO_OWNED_NEEDLES[job.field]);
        if (!odooKey) {
          await this.prisma.odooFieldWriteback.update({
            where: { id: job.id },
            data: { status: "error", lastError: `Odoo no tiene campo ${job.field}`, attempts: { increment: 1 } },
          });
          continue;
        }
        const meta = fields[odooKey] || {};
        values[odooKey] = coerceOdooWriteValue(meta.type, job.value, meta.selection);
      }
      try {
        if (Object.keys(values).length) {
          await this.odoo.write("stock.lot", [cand.odooLotId], values);
        }
        for (const job of jobs) {
          if (!isOdooOwnedField(job.field) || !pickFieldByLabel(fields, ODOO_OWNED_NEEDLES[job.field])) continue;
          await this.prisma.odooFieldWriteback.update({
            where: { id: job.id },
            data: { status: "sent", sentAt: new Date(), lastError: null, attempts: { increment: 1 } },
          });
          flushed += 1;
        }
        const leftover = await this.prisma.odooFieldWriteback.count({
          where: { candidateId: cand.id, status: { in: ["pending", "error"] } },
        });
        await this.prisma.odooLotCandidate.update({
          where: { id: cand.id },
          data: leftover ? { odooSyncStatus: "deferred" } : { odooSyncStatus: "live", odooSyncError: null },
        });
      } catch (e) {
        const message = (e as Error).message;
        await this.prisma.odooFieldWriteback.updateMany({
          where: { id: { in: jobs.map((j) => j.id) } },
          data: { status: "error", lastError: message, attempts: { increment: 1 } },
        });
        await this.prisma.odooLotCandidate.update({
          where: { id: cand.id },
          data: { odooSyncStatus: "error", odooSyncError: message },
        });
      }
    }
    return { ok: true, flushed };
  }

  async listPhotos(id: string) {
    const row = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Candidato no encontrado.");
    return listOdooLotPhotos(this.odoo, row.odooLotId);
  }

  async openPhoto(id: string, attId: string) {
    const row = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Candidato no encontrado.");
    return openOdooLotPhoto(this.odoo, row.odooLotId, attId);
  }

  async resetModule(user: AuthUser, confirm: string, ip?: string) {
    if (String(confirm || "").trim().toUpperCase() !== "REINICIAR") {
      throw new BadRequestException("Escribe REINICIAR para vaciar el módulo de asimilación.");
    }
    const odooIsos = (
      await this.prisma.container.findMany({
        where: { intakeOrigin: "odoo", status: { not: "Vendido" } },
        select: { iso: true },
      })
    ).map((c) => c.iso);

    await this.prisma.$transaction(async (tx) => {
      await tx.odooFieldWriteback.deleteMany();
      await tx.odooLotCandidate.deleteMany();
      if (odooIsos.length) {
        await tx.container.deleteMany({ where: { iso: { in: odooIsos } } });
      }
    });

    const emptyOdooDepots = await this.prisma.depot.findMany({
      where: { city: "Odoo", containers: { none: {} } },
      select: { id: true },
    });
    if (emptyOdooDepots.length) {
      await this.prisma.depot.deleteMany({ where: { id: { in: emptyOdooDepots.map((d) => d.id) } } });
    }

    await this.audit.log({
      user,
      action: "odoo_module_reset",
      entity: "OdooLotCandidate",
      after: { removedContainers: odooIsos.length, depots: emptyOdooDepots.length },
      ip,
    });
    return {
      ok: true,
      message: "Módulo Odoo vaciado. Vuelve a pulsar Buscar en Odoo.",
      removedContainers: odooIsos.length,
      removedDepots: emptyOdooDepots.length,
    };
  }

  async ignore(id: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.odooLotCandidate.update({
      where: { id },
      data: { status: "ignored" },
    });
    await this.audit.log({ user, action: "odoo_ignore", entity: "OdooLotCandidate", entityId: id, ip });
    return row;
  }

  private async ensureDepot(locationName: string) {
    const name = titleFromLocation(locationName);
    const found =
      (await this.prisma.depot.findFirst({
        where: { OR: [{ name: { equals: name, mode: "insensitive" } }, { address: locationName || name }], archivedAt: null },
      })) ||
      (locationName
        ? await this.prisma.depot.findFirst({
            where: { name: { equals: locationName, mode: "insensitive" }, archivedAt: null },
          })
        : null);
    if (found) return found;
    return this.prisma.depot.create({
      data: {
        name,
        city: "Odoo",
        address: locationName || name,
        dailyRateTeu: 1,
        protected: false,
      },
    });
  }

  private async attachPurchaseRefs(lotIds: number[]) {
    if (!lotIds.length) return 0;
    let refs = new Map<number, OdooPurchaseRef>();
    try {
      refs = await this.resolvePurchaseRefs(lotIds);
    } catch {
      return 0;
    }
    let hits = 0;
    for (const [lotId, ref] of refs) {
      if (!ref.odooPoName && !ref.odooBillName) continue;
      await this.prisma.odooLotCandidate.updateMany({
        where: { odooLotId: lotId },
        data: {
          odooPoName: ref.odooPoName,
          odooPoId: ref.odooPoId,
          odooVendorName: ref.odooVendorName,
          odooBillName: ref.odooBillName,
          odooUnitPrice: ref.odooUnitPrice,
        },
      });
      const cand = await this.prisma.odooLotCandidate.findUnique({
        where: { odooLotId: lotId },
        select: { containerIso: true },
      });
      if (cand?.containerIso) {
        await this.prisma.container.updateMany({
          where: { iso: cand.containerIso, purchaseInvoiceId: null },
          data: {
            odooPoName: ref.odooPoName,
            odooPoId: ref.odooPoId,
            odooVendorName: ref.odooVendorName,
            odooBillName: ref.odooBillName,
            odooUnitPrice: ref.odooUnitPrice,
          },
        });
      }
      hits += 1;
    }
    return hits;
  }

  private async resolvePurchaseRefs(lotIds: number[]): Promise<Map<number, OdooPurchaseRef>> {
    const out = new Map<number, OdooPurchaseRef>();
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: lotIds } },
      select: { odooLotId: true, isoNormalized: true },
    });
    const byIso = new Map(cands.map((c) => [c.isoNormalized, c.odooLotId]));

    try {
      const moveLines = await this.odoo.searchRead(
        "stock.move.line",
        [["lot_id", "in", lotIds]],
        ["lot_id", "move_id"],
        { limit: 2000 },
      );
      const moveIds = [...new Set(moveLines.map((l) => this.relId(l.move_id)).filter((n): n is number => n > 0))];
      if (moveIds.length) {
        const moves = await this.odoo.searchRead(
          "stock.move",
          [["id", "in", moveIds], ["purchase_line_id", "!=", false]],
          ["id", "purchase_line_id"],
          { limit: moveIds.length },
        );
        const plIds = [...new Set(moves.map((m) => this.relId(m.purchase_line_id)).filter((n): n is number => n > 0))];
        if (plIds.length) {
          const polines = await this.odoo.searchRead(
            "purchase.order.line",
            [["id", "in", plIds]],
            ["id", "order_id", "price_unit"],
            { limit: plIds.length },
          );
          const orderIds = [...new Set(polines.map((p) => this.relId(p.order_id)).filter((n): n is number => n > 0))];
          const orders = orderIds.length
            ? await this.odoo.searchRead(
                "purchase.order",
                [["id", "in", orderIds]],
                ["id", "name", "partner_id", "invoice_ids"],
                { limit: orderIds.length },
              )
            : [];
          const orderMap = new Map(orders.map((o) => [Number(o.id), o]));
          const bills = await this.billsByOrders(orders);
          const moveToLot = new Map<number, number>();
          for (const l of moveLines) {
            const mid = this.relId(l.move_id);
            const lid = this.relId(l.lot_id);
            if (mid && lid) moveToLot.set(mid, lid);
          }
          for (const m of moves) {
            const lotId = moveToLot.get(Number(m.id));
            const pl = polines.find((p) => Number(p.id) === this.relId(m.purchase_line_id));
            const order = orderMap.get(this.relId(pl?.order_id) || 0);
            if (!lotId || !order) continue;
            out.set(
              lotId,
              purchaseRefFromOrder({
                poId: Number(order.id),
                poName: String(order.name || ""),
                vendorName: this.relName(order.partner_id),
                billName: bills.get(Number(order.id)) || null,
                unitPrice: Number(pl?.price_unit) || null,
              }),
            );
          }
        }
      }
    } catch {
      /* sigue con el texto de la OC */
    }

    try {
      const noteLines = await this.odoo.searchRead(
        "purchase.order.line",
        [["name", "ilike", "//"]],
        ["id", "order_id", "name", "price_unit"],
        { limit: 400 },
      );
      const orderIds = [...new Set(noteLines.map((l) => this.relId(l.order_id)).filter((n): n is number => n > 0))];
      if (!orderIds.length) return out;
      const priced = await this.odoo.searchRead(
        "purchase.order.line",
        [
          ["order_id", "in", orderIds],
          ["product_id", "!=", false],
          ["price_unit", ">", 0],
        ],
        ["order_id", "price_unit"],
        { limit: 400 },
      );
      const priceByOrder = new Map<number, number>();
      for (const l of priced) {
        const oid = this.relId(l.order_id);
        if (oid && !priceByOrder.has(oid)) priceByOrder.set(oid, Number(l.price_unit) || 0);
      }
      const orders = await this.odoo.searchRead(
        "purchase.order",
        [["id", "in", orderIds]],
        ["id", "name", "partner_id", "invoice_ids"],
        { limit: orderIds.length },
      );
      const orderMap = new Map(orders.map((o) => [Number(o.id), o]));
      const bills = await this.billsByOrders(orders);
      for (const line of noteLines) {
        const isos = parseSerialsFromPoText(String(line.name || ""));
        const oid = this.relId(line.order_id);
        const po = orderMap.get(oid || 0);
        if (!po || !isos.length) continue;
        const ref = purchaseRefFromOrder({
          poId: oid,
          poName: String(po.name || this.relName(line.order_id) || ""),
          vendorName: this.relName(po.partner_id),
          billName: bills.get(oid || 0) || null,
          unitPrice: priceByOrder.get(oid || 0) || Number(line.price_unit) || null,
        });
        for (const iso of isos) {
          const lotId = byIso.get(iso);
          if (lotId && !out.has(lotId)) out.set(lotId, ref);
        }
      }
    } catch {
      /* sin OC en texto */
    }
    return out;
  }

  private async billsByOrders(orders: Record<string, unknown>[]) {
    const byOrder = new Map<number, string>();
    const invoiceIds = orders.flatMap((o) => (Array.isArray(o.invoice_ids) ? (o.invoice_ids as number[]) : []));
    if (!invoiceIds.length) return byOrder;
    const invoices = await this.odoo.searchRead(
      "account.move",
      [
        ["id", "in", invoiceIds],
        ["move_type", "=", "in_invoice"],
      ],
      ["id", "name", "invoice_origin"],
      { limit: 200 },
    );
    const originToName = new Map(invoices.map((i) => [String(i.invoice_origin || ""), String(i.name || "")]));
    for (const o of orders) {
      const name = String(o.name || "");
      const bill = originToName.get(name);
      if (bill) byOrder.set(Number(o.id), bill);
    }
    return byOrder;
  }

  private mergeSyncRow(
    existing:
      | {
          localTouched: boolean;
          odooSyncStatus: string;
          odooSyncError: string | null;
          zdryType: string | null;
          zdryCat: string | null;
          zdryNotes: string;
          color: string | null;
          tareKg: number | null;
          mgwKg: number | null;
          year: number | null;
          manufacturer: string | null;
          dua: string | null;
          originCountry: string | null;
          material: string | null;
        }
      | null,
    row: Record<string, unknown>,
  ) {
    if (!existing) return row;
    const keepEdits = !!(existing.localTouched || existing.odooSyncStatus === "deferred");
    const pick = <K extends keyof typeof existing>(key: K, incoming: unknown) => {
      if (keepEdits) return existing[key];
      return incoming != null && incoming !== "" ? incoming : existing[key] ?? incoming;
    };
    return {
      ...row,
      color: pick("color", row.color),
      tareKg: pick("tareKg", row.tareKg),
      mgwKg: pick("mgwKg", row.mgwKg),
      year: pick("year", row.year),
      manufacturer: pick("manufacturer", row.manufacturer),
      dua: pick("dua", row.dua),
      originCountry: pick("originCountry", row.originCountry),
      material: pick("material", row.material),
      localTouched: existing.localTouched,
      odooSyncStatus: existing.odooSyncStatus,
      odooSyncError: existing.odooSyncError,
      zdryType: existing.zdryType,
      zdryCat: existing.zdryCat,
      zdryNotes: existing.zdryNotes,
    };
  }

  private async applyCandidateToContainer(
    iso: string,
    cand: {
      color?: string | null;
      tareKg?: number | null;
      mgwKg?: number | null;
      year?: number | null;
      manufacturer?: string | null;
      dua?: string | null;
      originCountry?: string | null;
      serialRaw?: string;
      productName?: string;
      productCode?: string;
      locationName?: string;
      material?: string | null;
      zgroupCode?: string | null;
      payload?: unknown;
      zdryType?: string | null;
      zdryCat?: string | null;
    },
  ) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) return;
    const mapped = this.mappedFromCandidate(cand);
    await this.prisma.container.update({
      where: { iso },
      data: {
        color: mapped.color,
        tareKg: mapped.tareKg,
        mgwKg: mapped.mgwKg,
        payloadKg: mapped.payloadKg,
        year: mapped.year,
        manufacturer: mapped.manufacturer,
        odooDua: cand.dua,
        originCountry: cand.originCountry,
        odooSource: this.sourceFromCandidate(cand) as Prisma.InputJsonValue,
        type: cand.zdryType && (await this.prisma.containerType.findUnique({ where: { code: cand.zdryType } })) ? cand.zdryType : c.type,
        cat: cand.zdryCat && (await this.prisma.category.findUnique({ where: { code: cand.zdryCat } })) ? cand.zdryCat : c.cat,
      },
    });
  }

  private async lotMeta() {
    let fieldsGet: Record<string, { string?: string; type?: string; selection?: [string, string][] }> = {};
    try {
      fieldsGet = await this.odoo.fieldsGet("stock.lot");
    } catch {
      fieldsGet = {};
    }
    let modelFields: { name?: string; field_description?: string; ttype?: string }[] = [];
    try {
      modelFields = await this.odoo.searchRead(
        "ir.model.fields",
        ["|", ["model", "=", "stock.lot"], ["model", "=", "stock.production.lot"]],
        ["name", "field_description", "ttype", "model"],
        { limit: 800 },
      );
    } catch {
      modelFields = [];
    }
    const fields = mergeFieldCatalog(fieldsGet, modelFields);
    return { fields, names: lotReadFieldNames(fields), map: mappedOdooKeys(fields) };
  }

  private async searchLots(ids: number[], names: string[]): Promise<Record<string, unknown>[]> {
    if (!ids.length) return [];
    try {
      return await this.odoo.searchRead("stock.lot", [["id", "in", ids]], names, { limit: Math.max(ids.length, 1) });
    } catch (e) {
      const msg = (e as Error).message || "";
      const bad = msg.match(/Invalid field ['"]?([a-zA-Z0-9._]+)/i);
      if (bad?.[1] && names.includes(bad[1])) {
        return this.searchLots(ids, names.filter((n) => n !== bad[1]));
      }
      return this.odoo.searchRead("stock.lot", [["id", "in", ids]], ["id", "name", "product_id", "write_date"], {
        limit: Math.max(ids.length, 1),
      });
    }
  }

  private async readLotsFull(ids: number[]): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const rows = await this.odoo.searchRead("stock.lot", [["id", "in", chunk]], [], { limit: chunk.length });
      out.push(...rows);
    }
    return out;
  }

  private async hydrateLots(
    ids: number[],
    meta: { fields: Record<string, { string?: string; type?: string }>; names: string[] },
  ): Promise<Record<string, unknown>[]> {
    const named = await this.searchLots(ids, meta.names);
    const namedMap = new Map(named.map((l) => [Number(l.id), l]));
    const needFull = ids.filter((id) => {
      const lot = namedMap.get(id);
      const attrs = readLotAttrs(lot, meta.fields);
      return !this.hasOwnedValues(attrs) && !attrs.year && !attrs.manufacturer;
    });
    if (!needFull.length) return named;
    const full = await this.readLotsFull(needFull);
    for (const lot of full) namedMap.set(Number(lot.id), { ...(namedMap.get(Number(lot.id)) || {}), ...lot });
    return ids.map((id) => namedMap.get(id)).filter((l): l is Record<string, unknown> => !!l);
  }

  private hasOwnedValues(attrs: { color?: string | null; tareKg?: number | null; mgwKg?: number | null; dua?: string | null; originCountry?: string | null; material?: string | null }) {
    return !!(attrs.color || attrs.tareKg || attrs.mgwKg || attrs.dua || attrs.originCountry || attrs.material);
  }

  private async refreshCandidateFromOdoo(id: string) {
    const cand = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!cand || cand.localTouched || cand.odooSyncStatus === "deferred") return;
    try {
      const meta = await this.lotMeta();
      let lots = await this.searchLots([cand.odooLotId], meta.names);
      let lot = lots[0];
      let attrs = readLotAttrs(lot, meta.fields);
      if (!this.hasOwnedValues(attrs)) {
        const full = await this.odoo.searchRead("stock.lot", [["id", "=", cand.odooLotId]], [], { limit: 1 });
        lot = full[0] || lot;
        if (lot) {
          const fromKeys = Object.keys(lot).map((name) => ({
            name,
            field_description: meta.fields[name]?.string || name.replace(/^x_studio_?/i, " ").replace(/_/g, " "),
          }));
          attrs = readLotAttrs(lot, mergeFieldCatalog(meta.fields, fromKeys));
        }
      }
      if (!this.hasOwnedValues(attrs) && !attrs.tareKg && !attrs.color) return;
      await this.prisma.odooLotCandidate.update({
        where: { id: cand.id },
        data: {
          color: attrs.color ?? cand.color,
          tareKg: attrs.tareKg ?? cand.tareKg,
          mgwKg: attrs.mgwKg ?? cand.mgwKg,
          year: attrs.year ?? cand.year,
          manufacturer: attrs.manufacturer ?? cand.manufacturer,
          dua: attrs.dua ?? cand.dua,
          originCountry: attrs.originCountry ?? cand.originCountry,
          material: attrs.material ?? cand.material,
          zgroupCode: attrs.zgroupCode ?? cand.zgroupCode,
          payload: {
            ...((cand.payload && typeof cand.payload === "object" ? cand.payload : {}) as object),
            lot,
            attrs,
            fieldMap: meta.map,
          } as Prisma.InputJsonValue,
        },
      });
    } catch {
      /* ficha still opens with stored values */
    }
  }

  private sourceFromCandidate(cand: {
    serialRaw?: string;
    productName?: string;
    productCode?: string;
    locationName?: string;
    color?: string | null;
    tareKg?: number | null;
    mgwKg?: number | null;
    year?: number | null;
    manufacturer?: string | null;
    dua?: string | null;
    originCountry?: string | null;
    material?: string | null;
    zgroupCode?: string | null;
    payload?: unknown;
  }) {
    const extra = (cand.payload && typeof cand.payload === "object" ? cand.payload : {}) as {
      attrs?: { material?: string | null; zgroupCode?: string | null };
    };
    return buildOdooSource({
      serialRaw: cand.serialRaw,
      productName: cand.productName,
      productCode: cand.productCode,
      locationName: cand.locationName,
      color: cand.color,
      tareKg: cand.tareKg,
      mgwKg: cand.mgwKg,
      year: cand.year,
      manufacturer: cand.manufacturer,
      dua: cand.dua,
      originCountry: cand.originCountry,
      material: cand.material ?? extra.attrs?.material ?? null,
      zgroupCode: cand.zgroupCode ?? extra.attrs?.zgroupCode ?? null,
    });
  }

  private mappedFromCandidate(cand: {
    color?: string | null;
    tareKg?: number | null;
    mgwKg?: number | null;
    year?: number | null;
    manufacturer?: string | null;
    originCountry?: string | null;
    material?: string | null;
    productName?: string;
    payload?: unknown;
  }) {
    const extra = (cand.payload && typeof cand.payload === "object" ? cand.payload : {}) as {
      attrs?: { material?: string | null };
    };
    const material = cand.material ?? extra.attrs?.material ?? null;
    const color = guessColor(cand.color) || "—";
    const tareKg = cand.tareKg || 0;
    const mgwKg = cand.mgwKg || 0;
    const notes = [
      cand.originCountry ? `Procedencia Odoo: ${cand.originCountry}` : "",
      material ? `Material Odoo: ${material}` : "",
      cand.productName ? `Producto Odoo: ${cand.productName}` : "",
    ]
      .filter(Boolean)
      .join(". ");
    return {
      color,
      tareKg,
      mgwKg,
      payloadKg: Math.max(0, mgwKg - tareKg),
      year: cand.year ?? null,
      manufacturer: cand.manufacturer || "—",
      notes,
    };
  }

  private async fillEmptyFromOdoo(
    iso: string,
    cand: {
      odooLotId?: number;
      locationName?: string;
      dua?: string | null;
      originCountry?: string | null;
      color?: string | null;
      tareKg?: number | null;
      mgwKg?: number | null;
      year?: number | null;
      manufacturer?: string | null;
      serialRaw?: string;
      productName?: string;
      productCode?: string;
      material?: string | null;
      zgroupCode?: string | null;
      payload?: unknown;
    },
  ) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) return;
    const mapped = this.mappedFromCandidate(cand);
    const source = this.sourceFromCandidate(cand);
    const data: Prisma.ContainerUpdateInput = {
      odooSource: source as Prisma.InputJsonValue,
      odooLotId: c.odooLotId || cand.odooLotId || undefined,
      intakeOrigin: c.intakeOrigin === "manual" ? "odoo" : c.intakeOrigin,
    };
    if (!c.odooLocation && cand.locationName) data.odooLocation = cand.locationName;
    if (!c.odooDua && cand.dua) data.odooDua = cand.dua;
    if (!c.originCountry && cand.originCountry) data.originCountry = cand.originCountry;
    if ((!c.color || c.color === "—") && mapped.color !== "—") data.color = mapped.color;
    if (!c.tareKg && mapped.tareKg) data.tareKg = mapped.tareKg;
    if (!c.mgwKg && mapped.mgwKg) data.mgwKg = mapped.mgwKg;
    if (!c.payloadKg && mapped.payloadKg) data.payloadKg = mapped.payloadKg;
    if (!c.year && mapped.year) data.year = mapped.year;
    if ((!c.manufacturer || c.manufacturer === "—") && mapped.manufacturer !== "—") data.manufacturer = mapped.manufacturer;
    if (!c.inspectionNotes && mapped.notes) data.inspectionNotes = mapped.notes;
    await this.prisma.container.update({ where: { iso }, data });
  }

  private relId(v: unknown) {
    if (Array.isArray(v) && typeof v[0] === "number") return v[0];
    if (typeof v === "number") return v;
    return 0;
  }

  private relName(v: unknown) {
    if (Array.isArray(v) && typeof v[1] === "string") return v[1];
    if (typeof v === "string") return v;
    return "";
  }

  private str(v: unknown) {
    if (v == null || v === false) return null;
    const t = String(v).trim();
    return t || null;
  }

  private num(v: unknown) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  private year(v: unknown) {
    const n = this.num(v);
    if (!n) return null;
    if (n >= 1970 && n <= 2100) return n;
    return null;
  }

  private asDate(v: unknown) {
    if (!v) return null;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private sumQty(quants: Record<string, unknown>[], lotId: number) {
    return quants
      .filter((q) => this.relId(q.lot_id) === lotId)
      .reduce((s, q) => s + (Number(q.quantity) || 0), 0);
  }

  private pickCode(codes: string[], preferred: string) {
    if (codes.includes(preferred)) return preferred;
    return codes[0] || preferred;
  }
}
