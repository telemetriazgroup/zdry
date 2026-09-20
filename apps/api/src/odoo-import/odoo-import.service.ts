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
  type OdooOwnedField,
  ODOO_OWNED_LABELS,
  ODOO_OWNED_NEEDLES,
  pickFieldByLabel,
  readLotAttrs,
  titleFromLocation,
  coerceOdooWriteValue,
  odooWriteKeys,
  matchOdooSelect,
  ODOO_LOT_SELECT_FALLBACK,
  ownedStorageKey,
} from "../domain/odoo-lot-map";
import { listOdooLotChatter, listOdooLotNotes, openOdooLotPhoto } from "../odoo/odoo-lot-photos";
import { applySerialTextRefs, assignRefsBySharedMove, purchaseRefFromOrder, type OdooPurchaseRef } from "../domain/odoo-purchase";
import {
  assimilateCostPlan,
  classifyLotOrigin,
  isDryContainerProduct,
  splitOdooProductLabel,
  type LotMoveFact,
} from "../domain/odoo-origin";
import { presentDryReferential } from "./dry-referential.store";
import { ExpedienteStore } from "../odoo-events/expediente.store";
import { AssimilateLogStore } from "./assimilate-log.store";
import { errorDetail } from "../domain/odoo-assimilate-log";
import {
  idleAssimilateProgress,
  normalizeAssimilateProgress,
  ODOO_ASSIMILATE_PROGRESS_KEY,
  type AssimilateProgress,
} from "../domain/odoo-assimilate-progress";
import { applyZdryLineCosts, buildMoOverhead, inferMoOverheadPlan, moCostBreakdown, moLineKey, penToUsd, pickComponentUnitCost, type MoOverheadPlan } from "../domain/odoo-mo-cost";
import { billDossierDraft, moDossierDraft, pickingDossierDraft, purchaseDossierDraft } from "../domain/odoo-dossier";

const DRY_DOMAIN = [["name", "ilike", "contenedor dry"]];
const ODOO_LOT_SELECTS_KEY = "odoo_lot_selects";

type LotSelects = { color: Array<[string, string]>; year: Array<[string, string]>; fetchedAt?: string };

@Injectable()
export class OdooImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly audit: AuditService,
  ) {
    this.expediente = new ExpedienteStore(prisma);
    this.logs = new AssimilateLogStore(prisma);
  }

  private readonly expediente: ExpedienteStore;
  private readonly logs: AssimilateLogStore;
  private runId: string | null = null;
  private readonly aborted = new Set<string>();
  private abortFlag = false;

  private isAborted(runId?: string | null) {
    return this.abortFlag || Boolean(runId && this.aborted.has(runId));
  }

  private async abortActive(reason: string) {
    this.abortFlag = true;
    if (this.runId) this.aborted.add(this.runId);
    const cancelled = await this.logs.cancelRunning(reason);
    for (const id of cancelled) this.aborted.add(id);
    this.runId = null;
    await this.writeProgress({ status: "idle", step: "", current: 0, total: 0, iso: "", message: reason });
  }

  probe() {
    return this.odoo.probe();
  }

  referential() {
    return presentDryReferential(this.prisma);
  }

  async progress(): Promise<AssimilateProgress & { runId?: string }> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_ASSIMILATE_PROGRESS_KEY } });
    const p = normalizeAssimilateProgress(row?.value);
    const running = await this.logs.currentRunning();
    return { ...p, runId: running?.id || this.runId || undefined };
  }

  async assimilateLog(opts: { runId?: string; level?: string; take?: number; from?: string; to?: string } = {}) {
    return this.logs.present(opts);
  }

  async exportAssimilateLog(opts: { runId?: string; level?: string; from?: string; to?: string } = {}) {
    return this.logs.exportCsv(opts);
  }

  private moOverheadKey(moName: string) {
    return `odoo_mo_overhead:${moName}`;
  }

  private async readMoOverheadOverride(moName: string): Promise<Partial<MoOverheadPlan> | null> {
    if (!moName) return null;
    const row = await this.prisma.appSetting.findUnique({ where: { key: this.moOverheadKey(moName) } });
    const v = row?.value;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return v as Partial<MoOverheadPlan>;
  }

  private async saveMoOverheadOverride(moName: string, plan: MoOverheadPlan) {
    await this.prisma.appSetting.upsert({
      where: { key: this.moOverheadKey(moName) },
      create: { key: this.moOverheadKey(moName), value: plan as unknown as Prisma.InputJsonValue },
      update: { value: plan as unknown as Prisma.InputJsonValue },
    });
  }

  private moLinesKey(moName: string) {
    return `odoo_mo_lines:${moName}`;
  }

  private async readMoLineOverrides(moName: string): Promise<Record<string, number>> {
    if (!moName) return {};
    const row = await this.prisma.appSetting.findUnique({ where: { key: this.moLinesKey(moName) } });
    const v = row?.value;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .map(([k, n]) => [k, Number(n)])
        .filter(([, n]) => Number.isFinite(n) && (n as number) > 0),
    ) as Record<string, number>;
  }

  private async saveMoLineOverrides(moName: string, lines: Record<string, number>) {
    await this.prisma.appSetting.upsert({
      where: { key: this.moLinesKey(moName) },
      create: { key: this.moLinesKey(moName), value: lines as unknown as Prisma.InputJsonValue },
      update: { value: lines as unknown as Prisma.InputJsonValue },
    });
  }

  private async writeProgress(patch: Partial<AssimilateProgress>) {
    const prev = await this.progress();
    const next: AssimilateProgress = {
      ...idleAssimilateProgress(),
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.prisma.appSetting.upsert({
      where: { key: ODOO_ASSIMILATE_PROGRESS_KEY },
      create: { key: ODOO_ASSIMILATE_PROGRESS_KEY, value: next as Prisma.InputJsonValue },
      update: { value: next as Prisma.InputJsonValue },
    });
    return next;
  }

  async lotSelects(opts: { refresh?: boolean } = {}): Promise<LotSelects> {
    if (!opts.refresh) {
      const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_LOT_SELECTS_KEY } });
      const cached = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as LotSelects) : null;
      if (cached?.color?.length && cached?.year?.length) return cached;
    }
    try {
      const fields = await this.odoo.fieldsGet("stock.lot");
      const color = (fields.color?.selection || []).map(([k, l]) => [String(k), String(l)] as [string, string]);
      const year = (fields.building_year?.selection || []).map(([k, l]) => [String(k), String(l)] as [string, string]);
      const out: LotSelects = { color, year, fetchedAt: new Date().toISOString() };
      if (color.length && year.length) {
        await this.prisma.appSetting.upsert({
          where: { key: ODOO_LOT_SELECTS_KEY },
          create: { key: ODOO_LOT_SELECTS_KEY, value: out as Prisma.InputJsonValue },
          update: { value: out as Prisma.InputJsonValue },
        });
        return out;
      }
    } catch {
      /* cache or fallback */
    }
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_LOT_SELECTS_KEY } });
    const cached = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as LotSelects) : null;
    if (cached?.color?.length && cached?.year?.length) return cached;
    return { ...ODOO_LOT_SELECT_FALLBACK };
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
    const existing = await this.logs.currentRunning();
    const live = await this.progress();
    const liveAge = live.updatedAt ? Date.now() - new Date(live.updatedAt).getTime() : 0;
    const liveStuck = live.status === "running" && liveAge > 15 * 60 * 1000;
    const orphan = (existing || live.status === "running") && !this.runId;
    if (orphan || liveStuck) {
      await this.abortActive(
        orphan
          ? "La pasada anterior se cortó (reinicio del servicio). Se inicia una nueva."
          : "La pasada anterior se cortó. Se inicia una nueva.",
      );
    } else if (existing || live.status === "running") {
      return {
        ok: true,
        running: true,
        runId: existing?.id,
        message: "Ya hay una pasada en curso. El diario se actualiza abajo.",
      };
    }
    const run = await this.logs.start("sync", user.name);
    this.abortFlag = false;
    this.aborted.delete(run.id);
    this.runId = run.id;
    await this.writeProgress({ status: "running", step: "lotes", current: 0, total: 5, iso: "", message: "Leyendo existencias DRY…" });
    await this.logs.add(run.id, { level: "info", step: "lotes", message: `Pasada iniciada por ${user.name || "admin"}.` });
    void this.runSync(run.id, user, ip).finally(() => {
      if (this.runId === run.id) this.runId = null;
    });
    return {
      ok: true,
      running: true,
      runId: run.id,
      message: "Pasada iniciada en segundo plano. Abre el diario para ver cada serie y los errores.",
    };
  }

  private async runSync(runId: string, user: AuthUser, ip?: string) {
    this.runId = runId;
    try {
      if (this.abortFlag && this.aborted.has(runId)) return;
      if (this.isAborted(runId)) return;
    await this.lotSelects({ refresh: true }).catch(() => undefined);
    if (this.isAborted(runId)) return;

    const rawProducts = await this.odoo.searchRead("product.product", DRY_DOMAIN, ["id", "name", "default_code", "categ_id"], {
      limit: 400,
    });
    if (this.isAborted(runId)) return;
    const products = rawProducts.filter((p) => isDryContainerProduct(String(p.name || ""), String(p.default_code || "")));
    const productIds = products.map((p) => Number(p.id));
    if (!productIds.length) {
      const empty = "Odoo no devolvió productos DRY.";
      await this.logs.add(runId, { level: "warn", step: "lotes", message: empty });
      await this.logs.finish(runId, empty);
      await this.writeProgress({ status: "done", step: "listo", current: 5, total: 5, message: empty });
      return;
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
    if (this.isAborted(runId)) return;

    const lotIds = [...new Set(quants.map((q) => this.relId(q.lot_id)).filter((n): n is number => n > 0))];
    const lotMeta = await this.lotMeta();
    const lots = lotIds.length ? await this.hydrateLots(lotIds, lotMeta) : [];
    const lotMap = new Map(lots.map((l) => [Number(l.id), l]));
    let incomplete = 0;

    const now = new Date();
    const seen = new Set<number>();
    let upserted = 0;

    for (const q of quants) {
      if (this.isAborted(runId)) return;
      const lotId = this.relId(q.lot_id);
      if (!lotId || seen.has(lotId)) continue;
      seen.add(lotId);
      const lot = lotMap.get(lotId);
      const product = productMap.get(this.relId(q.product_id) || this.relId(lot?.product_id));
      const attrs = readLotAttrs(lot, lotMeta.fields);
      const serialRaw = attrs.serialRaw || this.relName(q.lot_id);
      const iso = inspectOdooIso(serialRaw);
      if (!iso.isoNormalized) {
        await this.logs.add(runId, { level: "warn", step: "lotes", serialRaw, odooLotId: lotId, message: "Sin serial normalizable; se omite." });
        continue;
      }

      try {
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
        odooDescription: attrs.description || "",
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
      await this.writeProgress({
        status: "running",
        step: "lotes",
        current: 0,
        total: 5,
        iso: iso.isoNormalized,
        message: `Lote ${upserted}/${lotIds.length} · ${serialRaw}`,
      });
      await this.logs.add(runId, {
        level: "ok",
        step: "lotes",
        iso: iso.isoNormalized,
        serialRaw,
        odooLotId: lotId,
        product: `${productCode ? `[${productCode}] ` : ""}${productName}`.trim(),
        message: existing?.status === "assimilated" ? `Ya en ZDRY (${existing.containerIso}). Ficha actualizada.` : `Cargado · ${locationName || "sin almacén"} · qty ${qty}`,
      });
      } catch (e) {
        const { message, detail } = errorDetail(e);
        await this.logs.add(runId, {
          level: "error",
          step: "lotes",
          iso: iso.isoNormalized,
          serialRaw,
          odooLotId: lotId,
          message,
          detail,
        });
      }
    }

    await this.prisma.odooLotCandidate.updateMany({
      where: { status: { in: ["pending", "qty_anomaly"] }, odooLotId: { notIn: [...seen] } },
      data: { status: "off_hand" },
    });

    if (this.isAborted(runId)) return;
    await this.writeProgress({ status: "running", step: "origenes", current: 1, total: 5, message: "Clasificando OC / IN / MO…" });
    let purchaseHits = 0;
    let originHits = 0;
    let fabricationHits = 0;
    try {
      purchaseHits = await this.attachPurchaseRefs([...seen]);
      originHits = await this.attachIntakeOrigins([...seen]);
      fabricationHits = await this.attachFabricationLineage([...seen]);
      await this.logs.add(runId, { level: "ok", step: "origenes", message: `OC ${purchaseHits} · origen ${originHits} · MO ${fabricationHits}` });
    } catch (e) {
      const { message, detail } = errorDetail(e);
      await this.logs.add(runId, { level: "error", step: "origenes", message, detail });
    }
    if (this.isAborted(runId)) return;
    await this.writeProgress({ status: "running", step: "dossier", current: 2, total: 5, message: "Asimilando OC, INs y facturas…" });
    await this.hydrateDossiers([...seen]);
    if (this.isAborted(runId)) return;
    await this.writeProgress({ status: "running", step: "mo_costo", current: 3, total: 5, message: "Costeando fabricaciones…" });
    await this.hydrateMoCosts([...seen]);

    await this.audit.log({
      user,
      action: "odoo_lot_sync",
      entity: "OdooLotCandidate",
      after: { products: products.length, quants: quants.length, upserted, purchaseHits, originHits, fabricationHits },
      ip,
    });

    const toBackfill = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: [...seen] } },
      select: {
        id: true,
        isoNormalized: true,
        containerIso: true,
        odooPoId: true,
        odooPoName: true,
        odooVendorName: true,
        odooBillName: true,
        odooUnitPrice: true,
        odooPickingName: true,
        odooMoName: true,
        odooIntakeKind: true,
        odooSourceProductCode: true,
        odooSourceLotId: true,
      },
    });
    for (const cand of toBackfill) {
      try {
        await this.expediente.backfillCandidate(cand);
      } catch (e) {
        const { message, detail } = errorDetail(e);
        await this.logs.add(runId, { level: "error", step: "dossier", iso: cand.isoNormalized, message, detail });
      }
    }

    if (this.isAborted(runId)) return;
    await this.writeProgress({ status: "running", step: "notas", current: 4, total: 5, message: "Notas Odoo (solo si faltan)…" });
    await this.pullMissingNotes([...seen]);
    if (this.isAborted(runId)) return;

    const isoReview = await this.prisma.odooLotCandidate.count({ where: { status: "pending", iso6346Ok: false } });
    const message = [
      `Listo. ${seen.size} lotes a la mano (existencias internas) cargados en ZDRY.`,
      incomplete ? `${incomplete} ficha(s) sin tara/color/DUA en Odoo.` : "Fichas locales listas: abre una para editar.",
      purchaseHits ? `${purchaseHits} lote(s) con OC/factura referenciada.` : "",
      originHits ? `${originHits} lote(s) con origen (ajuste/OC/MO) clasificado.` : "",
      fabricationHits ? `${fabricationHits} lote(s) con precursor de fabricación.` : "",
      isoReview ? `${isoReview} serial(es) por revisar ISO.` : "",
      "Odoo solo se escribe cuando guardas un cambio.",
    ]
      .filter(Boolean)
      .join(" ");
    if (this.isAborted(runId)) return;
    await this.writeProgress({ status: "done", step: "listo", current: 5, total: 5, iso: "", message });
    await this.logs.add(runId, { level: "info", step: "listo", message });
    await this.logs.finish(runId, message);
    } catch (e) {
      if (this.isAborted(runId)) return;
      await this.writeProgress({ status: "error", step: "error", message: (e as Error).message || "Error al asimilar" });
      await this.logs.fail(runId, e, "sync");
    }
  }

  async assimilate(ids: string[], user: AuthUser, ip?: string) {
    if (!ids?.length) throw new BadRequestException("Elige al menos un lote.");
    const run = await this.logs.start("assimilate", user.name);
    this.runId = run.id;
    const out: { iso: string; created: boolean; isoReview: boolean }[] = [];
    try {
    for (const id of ids) {
      let cand = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
      if (!cand) {
        await this.logs.add(run.id, { level: "error", step: "assimilate", message: `Candidato ${id} no encontrado.` });
        continue;
      }
      try {
      if (!cand.odooIntakeKind) {
        await this.attachIntakeOrigins([cand.odooLotId]);
        cand = (await this.prisma.odooLotCandidate.findUnique({ where: { id } })) || cand;
      }
      if (cand.odooIntakeKind === "fabrication" && !cand.odooSourceLotId) {
        await this.attachFabricationLineage([cand.odooLotId]);
        cand = (await this.prisma.odooLotCandidate.findUnique({ where: { id } })) || cand;
      }
      const item = await this.assimilateOne(cand, user, ip);
      out.push(item);
      await this.logs.add(run.id, {
        level: "ok",
        step: "assimilate",
        iso: item.iso,
        serialRaw: cand.serialRaw,
        odooLotId: cand.odooLotId,
        product: cand.productName,
        message: item.created ? "Creado en Recepción." : `Ya existía ${item.iso}; ficha actualizada.`,
      });
      } catch (e) {
        const { message, detail } = errorDetail(e);
        await this.logs.add(run.id, {
          level: "error",
          step: "assimilate",
          iso: cand.isoNormalized,
          serialRaw: cand.serialRaw,
          odooLotId: cand.odooLotId,
          product: cand.productName,
          message,
          detail,
        });
      }
    }
    const summary = `${out.length} unidad(es) asimilada(s). ${ids.length - out.length ? `${ids.length - out.length} con error.` : ""}`.trim();
    await this.logs.finish(run.id, summary);
    return { ok: true, items: out, runId: run.id, message: summary };
    } catch (e) {
      await this.logs.fail(run.id, e, "assimilate");
      throw e;
    } finally {
      if (this.runId === run.id) this.runId = null;
    }
  }

  async expedienteOf(id: string, opts: { refresh?: boolean } = {}) {
    const cand = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException("Candidato no encontrado.");
    await this.expediente.backfillCandidate(cand);
    if (opts.refresh || !(await this.notesAlreadyFetched(cand))) {
      await this.pullOdooNotes(cand).catch(() => undefined);
    }
    return this.expediente.present(cand.isoNormalized);
  }

  async addExpedienteNote(id: string, body: string, user: AuthUser) {
    const cand = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException("Candidato no encontrado.");
    const note = await this.expediente.addZdryNote(cand.isoNormalized, body, user.name, {
      candidateId: cand.id,
      containerIso: cand.containerIso,
    });
    if (!note) throw new BadRequestException("Escribe una nota.");
    return this.expediente.present(cand.isoNormalized);
  }

  async patchMoOverhead(
    id: string,
    body: { days?: number; aguaPerDay?: number; herramientasPerDay?: number; adminPerDay?: number; maquinaria?: number; reset?: boolean },
    user: AuthUser,
    ip?: string,
  ) {
    const cand = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException("Candidato no encontrado.");
    const moName = cand.odooMoName || cand.odooPickingName;
    if (!moName) throw new BadRequestException("Esta serie no tiene MO.");
    const snap = await this.prisma.odooDocSnapshot.findFirst({
      where: { isoNormalized: cand.isoNormalized, kind: "mo" },
      orderBy: { version: "desc" },
    });
    const data = snap?.data && typeof snap.data === "object" && !Array.isArray(snap.data) ? (snap.data as Record<string, unknown>) : {};
    const current = (data.overhead && typeof data.overhead === "object" ? data.overhead : {}) as Partial<MoOverheadPlan>;
    const days = Number(body.days);
    if (body.days != null && (!Number.isFinite(days) || days < 0.5 || days > 365)) {
      throw new BadRequestException("Los días de fabricación deben estar entre 0.5 y 365.");
    }
    const next = inferMoOverheadPlan(
      {
        diasTrabajados: current.odooDays || 9,
        costoAgua: (current.aguaPerDay || 4) * (current.odooDays || 9),
        costoHerramientas: (current.herramientasPerDay || 20) * (current.odooDays || 9),
        costoGastosAdmin: (current.adminPerDay || 20) * (current.odooDays || 9),
        costoMaquinaria: current.maquinaria ?? 60,
        costoEnergia: current.energia || 0,
        otros: current.otros || 0,
      },
      body.reset
        ? { days: current.odooDays || 9, daysSource: "odoo", aguaPerDay: current.aguaPerDay, herramientasPerDay: current.herramientasPerDay, adminPerDay: current.adminPerDay, maquinaria: current.maquinaria }
        : {
            days: body.days ?? current.days ?? 9,
            daysSource: "zdry",
            aguaPerDay: body.aguaPerDay ?? current.aguaPerDay,
            herramientasPerDay: body.herramientasPerDay ?? current.herramientasPerDay,
            adminPerDay: body.adminPerDay ?? current.adminPerDay,
            maquinaria: body.maquinaria ?? current.maquinaria,
          },
    );
    if (body.reset) {
      next.days = next.odooDays;
      next.daysSource = "odoo";
    }
    await this.saveMoOverheadOverride(moName, next);
    return this.recomputeMoLocal(cand, moName, next, user, ip, "odoo_mo_overhead", {
      days: next.days,
      daysSource: next.daysSource,
    });
  }

  async patchMoLine(id: string, body: { key?: string; unitCost?: number; clear?: boolean }, user: AuthUser, ip?: string) {
    const cand = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException("Candidato no encontrado.");
    const moName = cand.odooMoName || cand.odooPickingName;
    if (!moName) throw new BadRequestException("Esta serie no tiene MO.");
    const key = moLineKey(body.key || "");
    if (!key) throw new BadRequestException("Indica el componente.");
    const lines = await this.readMoLineOverrides(moName);
    if (body.clear) delete lines[key];
    else {
      const usd = Number(body.unitCost);
      if (!Number.isFinite(usd) || usd <= 0 || usd > 1_000_000) {
        throw new BadRequestException("El costo ZDRY debe ser un USD mayor a 0.");
      }
      lines[key] = Math.round(usd * 100) / 100;
    }
    await this.saveMoLineOverrides(moName, lines);
    const snap = await this.prisma.odooDocSnapshot.findFirst({
      where: { isoNormalized: cand.isoNormalized, kind: "mo" },
      orderBy: { version: "desc" },
    });
    const data = snap?.data && typeof snap.data === "object" && !Array.isArray(snap.data) ? (snap.data as Record<string, unknown>) : {};
    const plan = (data.overhead && typeof data.overhead === "object" ? data.overhead : null) as MoOverheadPlan | null;
    return this.recomputeMoLocal(cand, moName, plan, user, ip, "odoo_mo_line", { key, unitCost: lines[key] || 0, clear: Boolean(body.clear) });
  }

  private async recomputeMoLocal(
    cand: { id: string; isoNormalized: string; containerIso: string | null; productName: string; productCode: string },
    moName: string,
    overheadPlan: MoOverheadPlan | null,
    user: AuthUser,
    ip: string | undefined,
    action: string,
    after: Record<string, unknown>,
  ) {
    const snap = await this.prisma.odooDocSnapshot.findFirst({
      where: { isoNormalized: cand.isoNormalized, kind: "mo" },
      orderBy: { version: "desc" },
    });
    const data = snap?.data && typeof snap.data === "object" && !Array.isArray(snap.data) ? (snap.data as Record<string, unknown>) : {};
    const next = overheadPlan || ((data.overhead && typeof data.overhead === "object" ? data.overhead : null) as MoOverheadPlan | null);
    if (!next) throw new BadRequestException("Primero abre o refresca el expediente de la MO.");
    const overrides = await this.readMoLineOverrides(moName);
    const materials = applyZdryLineCosts(
      (Array.isArray(data.components) ? data.components : [])
        .filter((c) => {
          const row = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
          return row.role !== "overhead" && row.origin !== "overhead" && !String(row.name || "").startsWith("OC operativa");
        })
        .map((c) => {
          const row = c as Record<string, unknown>;
          const origin = String(row.origin || "missing");
          return {
            name: String(row.name || "Insumo"),
            qty: Number(row.qty) || 0,
            unitCost: origin === "missing" || origin === "zdry" ? null : row.unitCost == null ? null : Number(row.unitCost),
            costOrigin: (origin === "zdry" ? "missing" : origin) as "oc" | "valuation" | "standard" | "move" | "missing",
            category: String(row.category || ""),
            role: row.role === "precursor" ? ("precursor" as const) : ("component" as const),
          };
        }),
      overrides,
    );
    const extras = (Array.isArray(data.components) ? data.components : [])
      .filter((c) => String((c as { name?: string })?.name || "").startsWith("OC operativa"))
      .map((c) => ({ name: String((c as { name?: string }).name), amountUsd: Number((c as { lineCost?: number }).lineCost) || 0 }));
    const overhead = buildMoOverhead(next, extras);
    const breakdown = moCostBreakdown({
      components: materials,
      overhead,
      finishedQty: Number(data.finishedQty) || 1,
      companyCurrency: String(data.companyCurrency || "PEN"),
    });
    const peers = await this.prisma.odooLotCandidate.findMany({
      where: { OR: [{ odooMoName: moName }, { odooPickingName: moName }] },
      select: { isoNormalized: true, containerIso: true, id: true },
    });
    await this.expediente.upsertShared(
      peers.map((p) => p.isoNormalized),
      moDossierDraft({
        odooId: Number(snap?.odooId) || 0,
        name: moName,
        productFinished: String(data.productFinished || cand.productName || ""),
        productCode: String(data.productCode || cand.productCode || ""),
        sourceProduct: data.sourceProduct ? String(data.sourceProduct) : null,
        date: data.date ? String(data.date) : null,
        breakdown,
        needs: Array.isArray(data.needs) ? data.needs.map(String) : [],
        overhead: next,
      }),
      { candidateId: cand.id, containerIso: cand.containerIso },
    );
    if (breakdown.total > 0) {
      for (const p of peers) {
        if (!p.containerIso) continue;
        await this.prisma.container.updateMany({
          where: { iso: p.containerIso, OR: [{ odooIntakeKind: "fabrication" }, { intakeType: "fabricacion_odoo" }] },
          data: { fobCif: breakdown.unitCost, costSource: "mo" },
        });
      }
    }
    await this.audit.log({ user, action, entity: "OdooLotCandidate", entityId: cand.id, after: { moName, unitCost: breakdown.unitCost, ...after }, ip });
    return this.expediente.present(cand.isoNormalized);
  }

  async refreshByKeys(input: { isos?: string[]; lotIds?: number[] }) {
    const lotIds = [...new Set((input.lotIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
    const isos = [
      ...new Set((input.isos || []).map((s) => inspectOdooIso(String(s)).isoNormalized).filter(Boolean)),
    ];
    if (!lotIds.length && !isos.length) return { refreshed: 0 };
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: {
        OR: [
          ...(lotIds.length ? [{ odooLotId: { in: lotIds } }] : []),
          ...(isos.length ? [{ isoNormalized: { in: isos } }] : []),
        ],
      },
      select: { odooLotId: true },
    });
    const ids = [...new Set(cands.map((c) => c.odooLotId))];
    if (!ids.length) return { refreshed: 0 };
    await this.attachPurchaseRefs(ids);
    await this.attachIntakeOrigins(ids);
    await this.attachFabricationLineage(ids);
    await this.hydrateDossiers(ids);
    await this.hydrateMoCosts(ids);
    return { refreshed: ids.length };
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
      odooIntakeKind?: string | null;
      odooPickingName?: string | null;
      costSource?: string | null;
      odooMoName?: string | null;
      odooSourceLotId?: number | null;
      odooSourceProductCode?: string | null;
      odooSourceProductName?: string | null;
      odooSourceIntakeKind?: string | null;
      odooSourcePoName?: string | null;
      odooSourceUnitPrice?: Prisma.Decimal | number | null;
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

    const moUnitCost = cand.odooIntakeKind === "fabrication" ? await this.expediente.latestMoUnitCost(iso) : null;
    const plan = assimilateCostPlan({
      odooIntakeKind: cand.odooIntakeKind,
      odooUnitPrice: cand.odooUnitPrice != null ? Number(cand.odooUnitPrice) : null,
      odooBillName: cand.odooBillName,
      odooPoName: cand.odooPoName,
      moUnitCost,
    });

    const existing = await this.prisma.container.findUnique({ where: { iso } });
    if (existing) {
      await this.prisma.odooLotCandidate.update({
        where: { id: cand.id },
        data: {
          status: "assimilated",
          containerIso: existing.iso,
          assimilatedAt: new Date(),
          odooIntakeKind: plan.odooIntakeKind,
          costSource: plan.costSource,
          odooPickingName: cand.odooPickingName,
        },
      });
      await this.fillEmptyFromOdoo(iso, { ...cand, ...plan });
      await this.pullOdooNotes({ ...cand, containerIso: existing.iso }).catch(() => undefined);
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
          intakeType: plan.intakeType,
          invoicePending: plan.invoicePending,
          physicallyReceived: true,
          physicalStatus: "en_patio",
          fobCif: plan.fobCif,
          isoException: isoInfo.isoException,
          isoExceptionReason: isoInfo.isoException ? "Serial Odoo no cumple ISO 6346 — revisar en campo" : null,
          intakeOrigin: "odoo",
          odooLotId: cand.odooLotId,
          odooLocation: cand.locationName,
          odooDua: cand.dua,
          odooPoName: plan.odooIntakeKind === "purchase" ? cand.odooPoName : null,
          odooPoId: plan.odooIntakeKind === "purchase" ? cand.odooPoId : null,
          odooVendorName: plan.odooIntakeKind === "purchase" ? cand.odooVendorName : null,
          odooBillName: plan.odooIntakeKind === "purchase" ? cand.odooBillName : null,
          odooUnitPrice: plan.odooIntakeKind === "purchase" ? cand.odooUnitPrice : null,
          odooIntakeKind: plan.odooIntakeKind,
          odooPickingName: cand.odooPickingName,
          costSource: plan.costSource,
          odooMoName: plan.odooIntakeKind === "fabrication" ? cand.odooMoName || cand.odooPickingName : null,
          odooSourceLotId: plan.odooIntakeKind === "fabrication" ? cand.odooSourceLotId : null,
          odooSourceProductCode: plan.odooIntakeKind === "fabrication" ? cand.odooSourceProductCode : null,
          odooSourceProductName: plan.odooIntakeKind === "fabrication" ? cand.odooSourceProductName : null,
          odooSourceIntakeKind: plan.odooIntakeKind === "fabrication" ? cand.odooSourceIntakeKind : null,
          odooSourcePoName: plan.odooIntakeKind === "fabrication" ? cand.odooSourcePoName : null,
          odooSourceUnitPrice: plan.odooIntakeKind === "fabrication" ? cand.odooSourceUnitPrice : null,
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
          detail: `Asimilado desde Odoo lote ${cand.odooLotId} (${cand.serialRaw}). Origen ${plan.odooIntakeKind}${cand.odooPickingName ? ` · ${cand.odooPickingName}` : ""}${
            plan.odooIntakeKind === "fabrication" && cand.odooSourceProductCode
              ? `. Antes [${cand.odooSourceProductCode}]${cand.odooSourceIntakeKind ? ` por ${cand.odooSourceIntakeKind}` : ""}${cand.odooSourcePoName ? ` ${cand.odooSourcePoName}` : ""}`
              : ""
          }. Costo ${plan.costSource}${plan.fobCif ? ` USD ${plan.fobCif}` : ""}. Almacén: ${cand.locationName || "—"}. ${isoInfo.isoException ? "ISO 6346 pendiente de revisión." : "ISO 6346 válido."} Regularizar fotos y datos en Recepción.`,
        },
      });
      await tx.odooLotCandidate.update({
        where: { id: cand.id },
        data: {
          status: "assimilated",
          containerIso: iso,
          assimilatedAt: new Date(),
          odooIntakeKind: plan.odooIntakeKind,
          costSource: plan.costSource,
          odooPickingName: cand.odooPickingName,
        },
      });
    });

    await this.pullOdooNotes({ ...cand, containerIso: iso }).catch(() => undefined);
    await this.audit.log({
      user,
      action: "odoo_assimilate",
      entity: "Container",
      entityId: iso,
      after: { odooLotId: cand.odooLotId, isoException: isoInfo.isoException, depot: depot.name, odooIntakeKind: plan.odooIntakeKind, costSource: plan.costSource },
      ip,
    });
    return { iso, created: true, isoReview: isoInfo.isoException };
  }

  async getOne(id: string, opts: { refresh?: boolean } = {}) {
    if (opts.refresh) {
      await this.refreshCandidateFromOdoo(id);
      const lot = await this.prisma.odooLotCandidate.findUnique({ where: { id }, select: { odooLotId: true } });
      if (lot) {
        await this.hydrateDossiers([lot.odooLotId]).catch(() => undefined);
        await this.hydrateMoCosts([lot.odooLotId]).catch(() => undefined);
      }
    }
    const row = await this.prisma.odooLotCandidate.findUnique({
      where: { id },
      include: {
        writebacks: { orderBy: { createdAt: "desc" }, take: 20 },
        conflicts: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 20 },
      },
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
    const dryReferential = await presentDryReferential(this.prisma);
    const lotSelects = await this.lotSelects().catch(() => ({ ...ODOO_LOT_SELECT_FALLBACK }));
    const moUnitCost = await this.expediente.latestMoUnitCost(row.isoNormalized);
    let odooNotes: Array<{ id: number | string; body: string; author: string | null; date: string | null }> = [];
    if (!opts.refresh && (await this.notesAlreadyFetched(row))) {
      odooNotes = await this.localOdooNotes(row.isoNormalized);
    } else {
      odooNotes = await this.pullOdooNotes(row).catch(() => this.localOdooNotes(row.isoNormalized));
    }
    return {
      ...row,
      description: row.odooDescription,
      color: matchOdooSelect(row.color, lotSelects.color) || row.color,
      year: matchOdooSelect(row.year, lotSelects.year) || row.year,
      lotSelects,
      odooNotes,
      moUnitCost,
      dryReferential,
      fieldStatus,
      odooFields: ODOO_OWNED_FIELDS.map((key) => ({
        key,
        label: ODOO_OWNED_LABELS[key],
        value: key === "color" ? (matchOdooSelect(row.color, lotSelects.color) || row.color) : key === "year" ? (matchOdooSelect(row.year, lotSelects.year) || row.year) : key === "description" ? row.odooDescription : row[key],
        options: key === "color" ? lotSelects.color : key === "year" ? lotSelects.year : undefined,
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
    const changedOwned: OdooOwnedField[] = [];

    if (body.color !== undefined) data.color = this.str(body.color);
    if (body.tareKg !== undefined) data.tareKg = this.num(body.tareKg);
    if (body.mgwKg !== undefined) data.mgwKg = this.num(body.mgwKg);
    if (body.year !== undefined) data.year = this.year(body.year);
    if (body.manufacturer !== undefined) data.manufacturer = this.str(body.manufacturer);
    if (body.dua !== undefined) data.dua = this.str(body.dua);
    if (body.originCountry !== undefined) data.originCountry = this.str(body.originCountry);
    if (body.material !== undefined) data.material = this.str(body.material);
    if (body.description !== undefined) data.odooDescription = String(body.description || "");
    if (body.zdryType !== undefined) data.zdryType = this.str(body.zdryType);
    if (body.zdryCat !== undefined) data.zdryCat = this.str(body.zdryCat);
    if (body.zdryNotes !== undefined) data.zdryNotes = String(body.zdryNotes || "");

    for (const key of ODOO_OWNED_FIELDS) {
      if (body[key] === undefined) continue;
      const col = ownedStorageKey(key);
      const next = data[col as keyof typeof data] ?? body[key];
      if (String(row[col as "color"] ?? "") !== String(next ?? "")) changedOwned.push(key);
    }

    if (changedOwned.length) {
      data.localTouched = true;
      data.odooSyncStatus = "deferred";
      data.odooSyncError = null;
    }

    await this.prisma.odooLotCandidate.update({ where: { id }, data });

    if (changedOwned.length) {
      const after = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
      const iso = after?.isoNormalized || row.isoNormalized;
      for (const field of changedOwned) {
        await this.prisma.unitTimeline.create({
          data: {
            isoNormalized: iso,
            candidateId: id,
            containerIso: after?.containerIso || row.containerIso,
            field,
            before: row[ownedStorageKey(field) as "color"] == null ? null : String(row[ownedStorageKey(field) as "color"]),
            after: after?.[ownedStorageKey(field) as "color"] == null ? null : String(after[ownedStorageKey(field) as "color"]),
            source: "zdry",
            event: "ficha_save",
            applied: true,
          },
        });
      }
    }

    for (const field of changedOwned) {
      const value = (await this.prisma.odooLotCandidate.findUnique({ where: { id } }))?.[ownedStorageKey(field) as "color"];
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
        const keys = odooWriteKeys(job.field, storedMap[job.field], fields);
        if (!keys.length) {
          await this.prisma.odooFieldWriteback.update({
            where: { id: job.id },
            data: { status: "error", lastError: `Odoo no tiene campo ${job.field}`, attempts: { increment: 1 } },
          });
          continue;
        }
        for (const odooKey of keys) {
          const meta = fields[odooKey] || {};
          values[odooKey] = coerceOdooWriteValue(meta.type, job.value, meta.selection);
        }
      }
      try {
        if (Object.keys(values).length) {
          await this.odoo.write("stock.lot", [cand.odooLotId], values, { context: { zdry_sync: true } });
        }
        for (const job of jobs) {
          if (!isOdooOwnedField(job.field) || !odooWriteKeys(job.field, storedMap[job.field], fields).length) continue;
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

  async writebackFromUnit(
    iso: string,
    changes: Partial<Record<(typeof ODOO_OWNED_FIELDS)[number], string | number | null>>,
    event = "recepcion_save",
  ) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c?.odooLotId) return { ok: true, flushed: 0, skipped: true as const };
    const cand = await this.prisma.odooLotCandidate.findUnique({ where: { odooLotId: c.odooLotId } });
    if (!cand) return { ok: false, flushed: 0, message: "Esta unidad no tiene ficha Odoo asimilada." };

    const data: Prisma.OdooLotCandidateUpdateInput = {};
    const changed: Array<(typeof ODOO_OWNED_FIELDS)[number]> = [];
    for (const field of ODOO_OWNED_FIELDS) {
      if (changes[field] === undefined) continue;
      const col = ownedStorageKey(field);
      const next = changes[field];
      const prev = cand[col as "color"];
      if (String(prev ?? "") === String(next ?? "")) continue;
      if (field === "description") data.odooDescription = next == null ? "" : String(next);
      else if (field === "tareKg" || field === "mgwKg" || field === "year") data[field] = next == null ? null : Number(next);
      else (data as Record<string, unknown>)[field] = next == null ? null : String(next);
      changed.push(field);
    }
    if (!changed.length) return { ok: true, flushed: 0 };

    data.localTouched = true;
    data.odooSyncStatus = "deferred";
    data.odooSyncError = null;
    await this.prisma.odooLotCandidate.update({ where: { id: cand.id }, data });
    const after = await this.prisma.odooLotCandidate.findUnique({ where: { id: cand.id } });
    for (const field of changed) {
      const col = ownedStorageKey(field);
      await this.prisma.unitTimeline.create({
        data: {
          isoNormalized: cand.isoNormalized,
          candidateId: cand.id,
          containerIso: cand.containerIso || iso,
          field,
          before: cand[col as "color"] == null ? null : String(cand[col as "color"]),
          after: after?.[col as "color"] == null ? null : String(after[col as "color"]),
          source: "zdry",
          event,
          applied: true,
        },
      });
      await this.prisma.odooFieldWriteback.create({
        data: { candidateId: cand.id, field, value: (after?.[col as "color"] ?? "") as Prisma.InputJsonValue },
      });
    }
    return this.flushWritebacks(cand.id);
  }

  async listPhotos(id: string) {
    const row = await this.prisma.odooLotCandidate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Candidato no encontrado.");
    const chatter = await listOdooLotChatter(this.odoo, row.odooLotId);
    await this.expediente.importOdooNotes(row.isoNormalized, chatter.notes, {
      candidateId: row.id,
      containerIso: row.containerIso,
    });
    return chatter.photos;
  }

  private notesFetchedAt(payload: unknown): string | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const at = (payload as { notesFetchedAt?: unknown }).notesFetchedAt;
    return at ? String(at) : null;
  }

  private async notesAlreadyFetched(cand: { payload?: unknown }) {
    return Boolean(this.notesFetchedAt(cand.payload));
  }

  private async localOdooNotes(isoNormalized: string) {
    const iso = inspectOdooIso(isoNormalized).isoNormalized || isoNormalized;
    const rows = await this.prisma.unitNote.findMany({
      where: { isoNormalized: iso, source: "odoo" },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return rows.map((n) => ({
      id: n.odooMessageId || n.id,
      body: n.body,
      author: n.author,
      date: (n.occurredAt || n.createdAt).toISOString(),
    }));
  }

  private async markNotesFetched(cand: { id: string; payload?: unknown }) {
    const prev = cand.payload && typeof cand.payload === "object" && !Array.isArray(cand.payload) ? { ...(cand.payload as object) } : {};
    await this.prisma.odooLotCandidate.update({
      where: { id: cand.id },
      data: { payload: { ...prev, notesFetchedAt: new Date().toISOString() } as Prisma.InputJsonValue },
    });
  }

  private async pullMissingNotes(lotIds: number[]) {
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: lotIds } },
      select: { id: true, isoNormalized: true, containerIso: true, odooLotId: true, payload: true },
    });
    let i = 0;
    for (const cand of cands) {
      if (this.isAborted(this.runId)) return;
      i += 1;
      if (this.notesFetchedAt(cand.payload)) continue;
      await this.writeProgress({
        status: "running",
        step: "notas",
        current: 4,
        total: 5,
        iso: cand.isoNormalized,
        message: `Notas ${i}/${cands.length} · ${cand.isoNormalized}`,
      });
      try {
        const notes = await this.pullOdooNotes(cand);
        await this.logs.add(this.runId, {
          level: "ok",
          step: "notas",
          iso: cand.isoNormalized,
          odooLotId: cand.odooLotId,
          message: `${notes.length} nota(s) Odoo.`,
        });
      } catch (e) {
        const { message, detail } = errorDetail(e);
        await this.logs.add(this.runId, {
          level: "error",
          step: "notas",
          iso: cand.isoNormalized,
          odooLotId: cand.odooLotId,
          message,
          detail,
        });
      }
    }
  }

  private async pullOdooNotes(cand: {
    id: string;
    isoNormalized: string;
    containerIso?: string | null;
    odooLotId: number;
    payload?: unknown;
  }) {
    const notes = await listOdooLotNotes(this.odoo, cand.odooLotId);
    await this.expediente.importOdooNotes(cand.isoNormalized, notes, {
      candidateId: cand.id,
      containerIso: cand.containerIso,
    });
    await this.markNotesFetched(cand);
    return notes;
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
    await this.abortActive("Reinicio: se canceló la búsqueda en Odoo.");
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
    const fresh = await this.logs.start("reset", user.name);
    await this.logs.add(fresh.id, {
      level: "info",
      step: "reset",
      message: `Módulo vaciado (${odooIsos.length} unidad(es) Odoo). Diario nuevo: pulsa Buscar en Odoo.`,
    });
    await this.logs.finish(fresh.id, "Módulo reiniciado. Listo para una búsqueda nueva.");
    return {
      ok: true,
      runId: fresh.id,
      message: "Búsqueda anterior cancelada. Módulo vaciado. El diario empieza de nuevo: pulsa Buscar en Odoo.",
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

  private async hydrateDossiers(lotIds: number[]) {
    if (!lotIds.length) return 0;
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: lotIds } },
      select: {
        id: true,
        isoNormalized: true,
        containerIso: true,
        odooPoId: true,
        odooPoName: true,
        odooVendorName: true,
        odooBillName: true,
        odooUnitPrice: true,
        odooPickingName: true,
      },
    });
    const groups = new Map<string, typeof cands>();
    for (const c of cands) {
      if (!c.odooPoId && !c.odooPoName) continue;
      const key = c.odooPoId ? `id:${c.odooPoId}` : `name:${c.odooPoName}`;
      const list = groups.get(key) || [];
      list.push(c);
      groups.set(key, list);
    }
    let hits = 0;
    for (const group of groups.values()) {
      if (this.isAborted(this.runId)) return hits;
      const sample = group[0];
      try {
        await this.hydratePurchaseGroup(group);
        hits += 1;
        await this.logs.add(this.runId, {
          level: "ok",
          step: "dossier",
          iso: sample.isoNormalized,
          message: `OC ${sample.odooPoName || sample.odooPoId} · ${group.length} serie(s)`,
          detail: group.map((c) => c.isoNormalized).join(", "),
        });
      } catch (e) {
        const { message, detail } = errorDetail(e);
        await this.logs.add(this.runId, {
          level: "error",
          step: "dossier",
          iso: sample.isoNormalized,
          product: sample.odooPoName || "",
          message: `Falló dossier ${sample.odooPoName || sample.odooPoId}: ${message}`,
          detail,
        });
      }
    }
    return hits;
  }

  private async hydratePurchaseGroup(
    group: Array<{
      id: string;
      isoNormalized: string;
      containerIso: string | null;
      odooPoId: number | null;
      odooPoName: string | null;
      odooVendorName: string | null;
      odooBillName: string | null;
      odooUnitPrice: Prisma.Decimal | number | null;
      odooPickingName: string | null;
    }>,
  ) {
    const sample = group[0];
    const domain = sample.odooPoId ? [["id", "=", sample.odooPoId]] : [["name", "=", sample.odooPoName]];
    const orders = await this.odoo.searchRead(
      "purchase.order",
      domain,
      ["id", "name", "partner_id", "state", "currency_id", "amount_total", "date_order", "invoice_ids"],
      { limit: 1 },
    );
    const order = orders[0];
    const poId = order ? Number(order.id) : sample.odooPoId || 0;
    const poName = order ? String(order.name || sample.odooPoName || "") : sample.odooPoName || "";
    const partner = order ? this.relName(order.partner_id) : sample.odooVendorName;
    const lines = poId
      ? await this.odoo.searchRead(
          "purchase.order.line",
          [["order_id", "=", poId]],
          ["name", "product_id", "product_qty", "qty_received", "price_unit", "display_type", "price_subtotal"],
          { limit: 200 },
        )
      : [];
    const lineViews = lines
      .filter((l) => String(l.display_type || "") !== "line_section")
      .map((l) => ({
        label: String(l.name || this.relName(l.product_id) || "").trim(),
        qty: l.product_qty != null ? String(l.product_qty) : undefined,
        amount: l.price_subtotal != null ? String(l.price_subtotal) : l.price_unit != null ? String(l.price_unit) : undefined,
      }))
      .filter((l) => l.label);
    const pickings = poId
      ? await this.odoo.searchRead(
          "stock.picking",
          [
            ["purchase_id", "=", poId],
            ["state", "=", "done"],
            ["picking_type_code", "=", "incoming"],
          ],
          ["id", "name", "origin", "date_done", "location_id", "location_dest_id"],
          { limit: 80 },
        )
      : [];
    const pickIds = pickings.map((p) => Number(p.id)).filter((n) => n > 0);
    const moveLines = pickIds.length
      ? await this.odoo.searchRead(
          "stock.move.line",
          [["picking_id", "in", pickIds]],
          ["picking_id", "lot_id"],
          { limit: 4000 },
        )
      : [];
    const isosByPick = new Map<number, string[]>();
    for (const ml of moveLines) {
      const pid = this.relId(ml.picking_id);
      const iso = inspectOdooIso(this.relName(ml.lot_id)).isoNormalized;
      if (!pid || !iso) continue;
      const list = isosByPick.get(pid) || [];
      if (!list.includes(iso)) list.push(iso);
      isosByPick.set(pid, list);
    }
    const pickingViews = pickings.map((p) => ({
      name: String(p.name || ""),
      date: p.date_done ? String(p.date_done) : null,
      isos: isosByPick.get(Number(p.id)) || [],
    }));
    const allIsos = [...new Set([...group.map((c) => c.isoNormalized), ...pickingViews.flatMap((p) => p.isos)])];
    const qtyReceived = lines.reduce((s, l) => s + (Number(l.qty_received) || 0), 0);
    const unitPrice = sample.odooUnitPrice != null ? Number(sample.odooUnitPrice) : Number(lines.find((l) => Number(l.price_unit) > 0)?.price_unit) || null;
    const purchaseDraft = purchaseDossierDraft({
      odooId: poId,
      name: poName,
      partner,
      state: order ? String(order.state || "") : null,
      currency: order ? this.relName(order.currency_id) || "USD" : "USD",
      amountTotal: order ? Number(order.amount_total) || null : null,
      date: order?.date_order ? String(order.date_order) : null,
      unitPrice,
      qtyReceived: qtyReceived || null,
      lines: lineViews,
      pickings: pickingViews,
    });
    await this.expediente.upsertShared(allIsos, purchaseDraft, {
      candidateId: sample.id,
      containerIso: sample.containerIso,
    });
    for (const p of pickings) {
      await this.expediente.upsertShared(allIsos, pickingDossierDraft({
        odooId: Number(p.id),
        name: String(p.name || ""),
        origin: poName,
        date: p.date_done ? String(p.date_done) : null,
        locationSrc: this.relName(p.location_id),
        locationDest: this.relName(p.location_dest_id),
        isos: isosByPick.get(Number(p.id)) || [],
      }), { candidateId: sample.id, containerIso: sample.containerIso });
    }
    const invoiceIds = order && Array.isArray(order.invoice_ids) ? (order.invoice_ids as number[]) : [];
    await this.hydrateBill({
      invoiceIds,
      billName: sample.odooBillName,
      poName,
      poId,
      isos: allIsos,
      candidateId: sample.id,
      containerIso: sample.containerIso,
    });
  }

  private async hydrateBill(input: {
    invoiceIds: number[];
    billName: string | null;
    poName: string;
    poId: number;
    isos: string[];
    candidateId: string;
    containerIso: string | null;
  }) {
    const fallbackName = input.billName || "";
    if (!input.invoiceIds.length && !fallbackName) {
      await this.expediente.upsertShared(input.isos, billDossierDraft({ name: "Factura", access: "pending", poNames: input.poName ? [input.poName] : [] }), {
        candidateId: input.candidateId,
        containerIso: input.containerIso,
      });
      return;
    }
    try {
      const invoices = input.invoiceIds.length
        ? await this.odoo.searchRead(
            "account.move",
            [
              ["id", "in", input.invoiceIds],
              ["move_type", "=", "in_invoice"],
            ],
            ["id", "name", "partner_id", "state", "amount_total", "invoice_date", "invoice_line_ids"],
            { limit: 8 },
          )
        : [];
      const inv = invoices[0];
      if (!inv) {
        await this.expediente.upsertShared(
          input.isos,
          billDossierDraft({
            name: fallbackName || "Factura",
            access: fallbackName ? "name_only" : "pending",
            poNames: input.poName ? [input.poName] : [],
          }),
          { candidateId: input.candidateId, containerIso: input.containerIso },
        );
        return;
      }
      let lines: Array<{ label: string; qty?: string; amount?: string }> = [];
      let access: "ok" | "name_only" = "name_only";
      try {
        const lineIds = Array.isArray(inv.invoice_line_ids) ? (inv.invoice_line_ids as number[]) : [];
        const raw = lineIds.length
          ? await this.odoo.searchRead(
              "account.move.line",
              [["id", "in", lineIds], ["display_type", "=", false]],
              ["name", "quantity", "price_subtotal"],
              { limit: 80 },
            )
          : [];
        lines = raw
          .map((l) => ({
            label: String(l.name || "").trim(),
            qty: l.quantity != null ? String(l.quantity) : undefined,
            amount: l.price_subtotal != null ? String(l.price_subtotal) : undefined,
          }))
          .filter((l) => l.label);
        if (lines.length) access = "ok";
      } catch {
        access = "name_only";
      }
      await this.expediente.upsertShared(
        input.isos,
        billDossierDraft({
          odooId: Number(inv.id),
          name: String(inv.name || fallbackName || "Factura"),
          access,
          partner: this.relName(inv.partner_id),
          state: String(inv.state || ""),
          amountTotal: Number(inv.amount_total) || null,
          date: inv.invoice_date ? String(inv.invoice_date) : null,
          poNames: input.poName ? [input.poName] : [],
          lines,
        }),
        { candidateId: input.candidateId, containerIso: input.containerIso },
      );
    } catch {
      await this.expediente.upsertShared(
        input.isos,
        billDossierDraft({
          name: fallbackName || "Factura",
          access: fallbackName ? "name_only" : "pending",
          poNames: input.poName ? [input.poName] : [],
        }),
        { candidateId: input.candidateId, containerIso: input.containerIso },
      );
    }
  }

  private async hydrateMoCosts(lotIds: number[]) {
    if (!lotIds.length) return 0;
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: lotIds }, odooIntakeKind: "fabrication" },
      select: {
        id: true,
        isoNormalized: true,
        containerIso: true,
        odooMoName: true,
        odooPickingName: true,
        odooSourceProductCode: true,
        odooSourceProductName: true,
        odooSourceUnitPrice: true,
        productName: true,
        productCode: true,
      },
    });
    const groups = new Map<string, typeof cands>();
    for (const c of cands) {
      const name = c.odooMoName || c.odooPickingName;
      if (!name) continue;
      const list = groups.get(name) || [];
      list.push(c);
      groups.set(name, list);
    }
    let hits = 0;
    for (const [moName, group] of groups) {
      if (this.isAborted(this.runId)) return hits;
      try {
        await this.hydrateMoGroup(moName, group);
        hits += 1;
        await this.logs.add(this.runId, {
          level: "ok",
          step: "mo_costo",
          iso: group[0]?.isoNormalized,
          product: moName,
          message: `MO ${moName} · ${group.length} serie(s)`,
        });
      } catch (e) {
        const { message, detail } = errorDetail(e);
        await this.logs.add(this.runId, {
          level: "error",
          step: "mo_costo",
          iso: group[0]?.isoNormalized,
          product: moName,
          message: `Falló costo ${moName}: ${message}`,
          detail,
        });
      }
    }
    return hits;
  }

  private async companyUsdRate() {
    const companies = await this.odoo.searchRead("res.company", [], ["currency_id"], { limit: 1 });
    const companyCurrency = this.relName(companies[0]?.currency_id) || "PEN";
    if (companyCurrency !== "PEN") return { companyCurrency, ratePenToUsd: 1 };
    const usd = await this.odoo.searchRead("res.currency", [["name", "=", "USD"]], ["rate"], { limit: 1 });
    const rate = Number(usd[0]?.rate);
    return { companyCurrency, ratePenToUsd: Number.isFinite(rate) && rate > 0 ? rate : 0.27 };
  }

  private async hydrateMoGroup(
    moName: string,
    group: Array<{
      id: string;
      isoNormalized: string;
      containerIso: string | null;
      odooSourceProductCode: string | null;
      odooSourceProductName: string | null;
      odooSourceUnitPrice: Prisma.Decimal | number | null;
      productName: string;
      productCode: string;
    }>,
  ) {
    const moFields = ["id", "name", "product_id", "product_qty", "qty_producing", "date_finished", "state"];
    const moExtra = ["dias_trabajados", "costo_agua", "costo_maquinaria", "costo_herramientas", "costo_gastos_admin", "costo_energia", "otros_costos_adicionales"];
    let mos = [];
    try {
      mos = await this.odoo.searchRead("mrp.production", [["name", "=", moName]], [...moFields, ...moExtra], { limit: 1 });
    } catch {
      mos = await this.odoo.searchRead("mrp.production", [["name", "=", moName]], moFields, { limit: 1 });
    }
    const mo = mos[0];
    const moId = mo ? Number(mo.id) : 0;
    const raw = moId
      ? await this.odoo.searchRead(
          "stock.move",
          [["raw_material_production_id", "=", moId]],
          ["id", "product_id", "product_uom_qty", "price_unit", "product_qty", "quantity"],
          { limit: 200 },
        )
      : [];
    const productIds = [...new Set(raw.map((m) => this.relId(m.product_id)).filter((n) => n > 0))];
    const products = productIds.length
      ? await this.odoo.read("product.product", productIds, ["id", "name", "default_code", "standard_price", "categ_id"])
      : [];
    const productMap = new Map(products.map((p) => [Number(p.id), p]));
    const moveIds = raw.map((m) => Number(m.id)).filter((n) => n > 0);
    let layers: Record<string, unknown>[] = [];
    try {
      layers = moveIds.length
        ? await this.odoo.searchRead(
            "stock.valuation.layer",
            [["stock_move_id", "in", moveIds]],
            ["stock_move_id", "unit_cost", "value", "quantity"],
            { limit: 400 },
          )
        : [];
    } catch {
      layers = [];
    }
    const layerByMove = new Map<number, number>();
    for (const layer of layers) {
      const moveId = this.relId(layer.stock_move_id);
      const unit = Number(layer.unit_cost);
      if (moveId && Number.isFinite(unit) && unit > 0 && !layerByMove.has(moveId)) layerByMove.set(moveId, unit);
    }
    const { companyCurrency, ratePenToUsd } = await this.companyUsdRate();
    const toUsd = (pen: number | null) => (pen != null && pen > 0 ? penToUsd(pen, companyCurrency === "PEN" ? ratePenToUsd : 1) : null);
    const sample = group[0];
    const sourceNeedle = String(sample.odooSourceProductCode || "").toUpperCase();
    const components = raw.map((m) => {
      const pid = this.relId(m.product_id);
      const prod = productMap.get(pid);
      const code = String(prod?.default_code || "");
      const name = this.relName(m.product_id) || String(prod?.name || "Insumo");
      const qty = Number(m.quantity ?? m.product_uom_qty ?? m.product_qty) || 0;
      const picked = pickComponentUnitCost({
        valuationCost: layerByMove.get(Number(m.id)) ?? null,
        standardPrice: Number(prod?.standard_price) > 0 ? Number(prod?.standard_price) : null,
        movePrice: Number(m.price_unit) > 0 ? Number(m.price_unit) : null,
      });
      const isPrecursor = Boolean(sourceNeedle && code.toUpperCase() === sourceNeedle);
      return {
        name: (code ? `[${code}] ${name.replace(/^\[[^\]]+\]\s*/, "")}` : name).replace(/\t+/g, " ").replace(/\s+/g, " ").trim(),
        qty,
        unitCost: toUsd(picked.unitCost),
        costOrigin: picked.origin,
        category: this.relName(prod?.categ_id),
        role: isPrecursor ? ("precursor" as const) : ("component" as const),
      };
    });
    const zdryOverhead = await this.readMoOverheadOverride(moName);
    const overheadPlan = inferMoOverheadPlan(
      {
        diasTrabajados: Number(mo?.dias_trabajados) || null,
        costoAgua: Number(mo?.costo_agua) || 0,
        costoHerramientas: Number(mo?.costo_herramientas) || 0,
        costoGastosAdmin: Number(mo?.costo_gastos_admin) || 0,
        costoMaquinaria: Number(mo?.costo_maquinaria) || 0,
        costoEnergia: Number(mo?.costo_energia) || 0,
        otros: Number(mo?.otros_costos_adicionales) || 0,
      },
      zdryOverhead,
    );
    const overhead = buildMoOverhead(overheadPlan);
    let linkedPos: Record<string, unknown>[] = [];
    try {
      linkedPos = moId
        ? await this.odoo.searchRead(
            "purchase.order",
            ["|", ["x_studio_nro_orden_de_produccion", "=", String(moId)], ["x_studio_nro_orden_de_produccion", "=", moName]],
            ["name", "amount_untaxed", "currency_id", "partner_id"],
            { limit: 20 },
          )
        : [];
    } catch {
      linkedPos = [];
    }
    for (const po of linkedPos) {
      const curr = this.relName(po.currency_id);
      const rawAmt = Number(po.amount_untaxed) || 0;
      const amountUsd = curr === "USD" ? rawAmt : toUsd(rawAmt) || 0;
      if (amountUsd > 0) {
        overhead.push({
          name: `OC operativa ${String(po.name || "")} · ${this.relName(po.partner_id) || ""}`.trim(),
          amountUsd,
        });
      }
    }
    const finishedQty = Number(mo?.qty_producing ?? mo?.product_qty) || 1;
    const valued = applyZdryLineCosts(components, await this.readMoLineOverrides(moName));
    const breakdown = moCostBreakdown({ components: valued, overhead, finishedQty, companyCurrency });
    const needs: string[] = [];
    if (!raw.length) needs.push("movimientos de materia prima (move_raw_ids) en la MO");
    if (!layers.length) needs.push("capas de valoración (stock.valuation.layer) o costo promedio en el producto");
    if (breakdown.missingCount) {
      needs.push(`costo promedio (standard_price) o valoración en ${breakdown.missingCount} producto(s) con costo 0`);
    }
    if (!linkedPos.length && !overhead.some((o) => o.name.startsWith("OC operativa"))) {
      needs.push("OCs de taller ligadas en x_studio_nro_orden_de_produccion (opcional)");
    }
    const draft = moDossierDraft({
      odooId: moId,
      name: moName,
      productFinished: sample.productName,
      productCode: sample.productCode,
      sourceProduct: sample.odooSourceProductCode
        ? `[${sample.odooSourceProductCode}] ${sample.odooSourceProductName || ""}`.trim()
        : sample.odooSourceProductName,
      date: mo?.date_finished ? String(mo.date_finished) : null,
      breakdown,
      needs,
      overhead: overheadPlan,
    });
    const isos = group.map((c) => c.isoNormalized);
    await this.expediente.upsertShared(isos, draft, { candidateId: sample.id, containerIso: sample.containerIso });
    if (breakdown.total > 0) {
      for (const c of group) {
        if (!c.containerIso) continue;
        const row = await this.prisma.container.findUnique({ where: { iso: c.containerIso } });
        if (!row) continue;
        const awaitingReconcile = !row.odooPoId && (row.invoicePending || row.intakeType === "pendiente_factura");
        if (awaitingReconcile) continue;
        if (row.odooIntakeKind !== "fabrication" && row.intakeType !== "fabricacion_odoo") continue;
        await this.prisma.container.update({
          where: { iso: c.containerIso },
          data: { fobCif: breakdown.unitCost, costSource: "mo" },
        });
      }
    }
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
          where: {
            iso: cand.containerIso,
            purchaseInvoiceId: null,
            intakeOrigin: "odoo",
            NOT: [{ invoicePending: true, odooPoId: null, intakeType: "pendiente_factura" }],
          },
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

  private async attachIntakeOrigins(lotIds: number[]) {
    if (!lotIds.length) return 0;
    let factsByLot = new Map<number, LotMoveFact[]>();
    try {
      factsByLot = await this.loadMoveFacts(lotIds);
    } catch {
      factsByLot = new Map();
    }
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: lotIds } },
      select: { odooLotId: true, odooPoName: true, containerIso: true },
    });
    let hits = 0;
    for (const cand of cands) {
      const facts = factsByLot.get(cand.odooLotId);
      const origin = facts?.length
        ? classifyLotOrigin(facts)
        : {
            odooIntakeKind: (cand.odooPoName ? "purchase" : "unknown") as "purchase" | "unknown",
            odooPickingName: null as string | null,
            purchaseName: cand.odooPoName || null,
            costSource: (cand.odooPoName ? "oc" : "none") as "oc" | "none",
            odooMoName: null as string | null,
          };
      const originData = {
        odooIntakeKind: origin.odooIntakeKind,
        odooPickingName: origin.odooPickingName,
        costSource: origin.costSource,
        odooMoName: origin.odooMoName,
        ...(origin.purchaseName && !cand.odooPoName ? { odooPoName: origin.purchaseName } : {}),
      };
      await this.prisma.odooLotCandidate.updateMany({
        where: { odooLotId: cand.odooLotId },
        data: originData,
      });
      if (cand.containerIso) {
        await this.prisma.container.updateMany({
          where: { iso: cand.containerIso },
          data: originData,
        });
      }
      hits += 1;
    }
    return hits;
  }

  private async attachFabricationLineage(lotIds: number[]) {
    if (!lotIds.length) return 0;
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: lotIds }, odooIntakeKind: "fabrication" },
      select: {
        odooLotId: true,
        serialRaw: true,
        isoNormalized: true,
        productCode: true,
        containerIso: true,
        odooMoName: true,
        odooPickingName: true,
      },
    });
    if (!cands.length) return 0;
    let hits = 0;
    for (const cand of cands) {
      try {
        const lineage = await this.reconstructPrecursor(cand);
        if (!lineage) continue;
        const data = {
          odooMoName: lineage.odooMoName || cand.odooMoName || cand.odooPickingName,
          odooSourceLotId: lineage.odooSourceLotId,
          odooSourceProductCode: lineage.odooSourceProductCode,
          odooSourceProductName: lineage.odooSourceProductName,
          odooSourceIntakeKind: lineage.odooSourceIntakeKind,
          odooSourcePoName: lineage.odooSourcePoName,
          odooSourceUnitPrice: lineage.odooSourceUnitPrice,
        };
        await this.prisma.odooLotCandidate.updateMany({
          where: { odooLotId: cand.odooLotId },
          data,
        });
        if (cand.containerIso) {
          await this.prisma.container.updateMany({
            where: { iso: cand.containerIso },
            data,
          });
        }
        hits += 1;
      } catch {
        /* precursor off-hand is best-effort; the finished lot stays classified as fabrication */
      }
    }
    return hits;
  }

  private async reconstructPrecursor(cand: {
    odooLotId: number;
    serialRaw: string;
    isoNormalized: string;
    productCode: string;
    odooMoName?: string | null;
    odooPickingName?: string | null;
  }) {
    const raw = String(cand.serialRaw || cand.isoNormalized || "").trim();
    if (!raw) return null;
    const compact = raw.replace(/-/g, "");
    const lots = await this.odoo.searchRead(
      "stock.lot",
      ["&", ["id", "!=", cand.odooLotId], "|", ["name", "=", raw], ["name", "=", compact]],
      ["id", "name", "product_id"],
      { limit: 20 },
    );
    if (!lots.length) return null;
    const productIds = [...new Set(lots.map((l) => this.relId(l.product_id)).filter((n): n is number => n > 0))];
    const products = productIds.length
      ? await this.odoo.searchRead(
          "product.product",
          [["id", "in", productIds]],
          ["id", "default_code", "name", "display_name"],
          { limit: productIds.length },
        )
      : [];
    const productMap = new Map(products.map((p) => [Number(p.id), p]));
    const siblings = lots
      .map((lot) => {
        const productId = this.relId(lot.product_id);
        const product = productMap.get(productId);
        const fromLabel = splitOdooProductLabel(this.relName(lot.product_id) || this.str(product?.display_name));
        const code = String(product?.default_code || fromLabel.code || "").trim();
        const name = String(product?.name || fromLabel.name || "").trim();
        return { lotId: Number(lot.id), productId, code, name };
      })
      .filter((s) => s.lotId && s.code && s.code !== cand.productCode);
    const precursor = siblings[0];
    if (!precursor) return null;

    let sourceKind: string | null = null;
    let sourcePo: string | null = null;
    let sourcePrice: number | null = null;
    try {
      const facts = await this.loadMoveFacts([precursor.lotId]);
      const origin = classifyLotOrigin(facts.get(precursor.lotId) || []);
      sourceKind = origin.odooIntakeKind;
      sourcePo = origin.purchaseName;
      if (origin.odooIntakeKind === "purchase") {
        const refs = await this.resolvePurchaseRefs([precursor.lotId]);
        const ref = refs.get(precursor.lotId);
        if (ref) {
          sourcePo = ref.odooPoName || sourcePo;
          sourcePrice = ref.odooUnitPrice != null ? Number(ref.odooUnitPrice) : null;
        }
      }
    } catch {
      /* keep product identity even if moves fail */
    }

    return {
      odooMoName: cand.odooMoName || cand.odooPickingName || null,
      odooSourceLotId: precursor.lotId,
      odooSourceProductCode: precursor.code || null,
      odooSourceProductName: precursor.name || null,
      odooSourceIntakeKind: sourceKind,
      odooSourcePoName: sourcePo,
      odooSourceUnitPrice: sourcePrice,
    };
  }

  private async loadMoveFacts(lotIds: number[]): Promise<Map<number, LotMoveFact[]>> {
    const out = new Map<number, LotMoveFact[]>();
    const moveLines = await this.odoo.searchRead(
      "stock.move.line",
      [["lot_id", "in", lotIds]],
      ["lot_id", "move_id", "picking_id", "location_id", "location_dest_id", "state", "reference"],
      { limit: 4000 },
    );
    const moveIds = [...new Set(moveLines.map((l) => this.relId(l.move_id)).filter((n): n is number => n > 0))];
    const moves = moveIds.length
      ? await this.odoo.searchRead(
          "stock.move",
          [["id", "in", moveIds]],
          ["id", "picking_id", "purchase_line_id", "location_id", "location_dest_id", "origin", "reference", "state"],
          { limit: moveIds.length },
        )
      : [];
    const moveMap = new Map(moves.map((m) => [Number(m.id), m]));
    const pickingIds = [
      ...new Set(
        [...moveLines.map((l) => this.relId(l.picking_id)), ...moves.map((m) => this.relId(m.picking_id))].filter(
          (n): n is number => n > 0,
        ),
      ),
    ];
    const pickings = pickingIds.length
      ? await this.odoo.searchRead(
          "stock.picking",
          [["id", "in", pickingIds]],
          ["id", "name", "origin", "purchase_id", "picking_type_code", "state"],
          { limit: pickingIds.length },
        )
      : [];
    const pickMap = new Map(pickings.map((p) => [Number(p.id), p]));
    const locIds = [
      ...new Set(
        [
          ...moveLines.flatMap((l) => [this.relId(l.location_id), this.relId(l.location_dest_id)]),
          ...moves.flatMap((m) => [this.relId(m.location_id), this.relId(m.location_dest_id)]),
        ].filter((n): n is number => n > 0),
      ),
    ];
    const locations = locIds.length
      ? await this.odoo.searchRead("stock.location", [["id", "in", locIds]], ["id", "name", "complete_name", "usage"], {
          limit: locIds.length,
        })
      : [];
    const locMap = new Map(locations.map((l) => [Number(l.id), l]));
    const locName = (id: number) => {
      const loc = locMap.get(id);
      return loc ? String(loc.complete_name || loc.name || "") : "";
    };
    const locUsage = (id: number) => {
      const loc = locMap.get(id);
      return loc ? String(loc.usage || "") : "";
    };

    for (const line of moveLines) {
      const lotId = this.relId(line.lot_id);
      if (!lotId) continue;
      const move = moveMap.get(this.relId(line.move_id));
      const pick = pickMap.get(this.relId(line.picking_id) || this.relId(move?.picking_id));
      const srcId = this.relId(move?.location_id) || this.relId(line.location_id);
      const destId = this.relId(move?.location_dest_id) || this.relId(line.location_dest_id);
      const fact: LotMoveFact = {
        state: String(move?.state || line.state || ""),
        origin: move?.origin ? String(move.origin) : null,
        reference: String(move?.reference || line.reference || pick?.name || ""),
        pickingCode: pick ? String(pick.picking_type_code || "") : null,
        pickingState: pick ? String(pick.state || "") : null,
        pickingName: pick ? String(pick.name || "") : null,
        purchaseId: this.relId(pick?.purchase_id) || null,
        purchaseName: this.relName(pick?.purchase_id) || null,
        purchaseLineId: this.relId(move?.purchase_line_id) || null,
        srcUsage: locUsage(srcId) || null,
        destUsage: locUsage(destId) || null,
        srcName: locName(srcId) || null,
        destName: locName(destId) || null,
      };
      const list = out.get(lotId) || [];
      list.push(fact);
      out.set(lotId, list);
    }
    return out;
  }

  private async resolvePurchaseRefs(lotIds: number[]): Promise<Map<number, OdooPurchaseRef>> {
    let out = new Map<number, OdooPurchaseRef>();
    const cands = await this.prisma.odooLotCandidate.findMany({
      where: { odooLotId: { in: lotIds } },
      select: { odooLotId: true, isoNormalized: true },
    });
    const byIso = new Map(cands.map((c) => [c.isoNormalized, c.odooLotId]));

    try {
      const moveLines = await this.odoo.searchRead(
        "stock.move.line",
        [["lot_id", "in", lotIds]],
        ["lot_id", "move_id", "picking_id"],
        { limit: 4000 },
      );
      const lineLots = moveLines
        .map((l) => ({ lotId: this.relId(l.lot_id), moveId: this.relId(l.move_id), pickingId: this.relId(l.picking_id) }))
        .filter((l) => l.lotId && l.moveId);
      const moveIds = [...new Set(lineLots.map((l) => l.moveId))];
      const pickingIds = [...new Set(lineLots.map((l) => l.pickingId).filter(Boolean))];
      if (moveIds.length) {
        const moves = await this.odoo.searchRead(
          "stock.move",
          [["id", "in", moveIds]],
          ["id", "purchase_line_id", "picking_id"],
          { limit: moveIds.length },
        );
        const pickings = pickingIds.length
          ? await this.odoo.searchRead(
              "stock.picking",
              [["id", "in", pickingIds]],
              ["id", "purchase_id", "origin"],
              { limit: pickingIds.length },
            )
          : [];
        const pickMap = new Map(pickings.map((p) => [Number(p.id), p]));
        const plIds = [...new Set(moves.map((m) => this.relId(m.purchase_line_id)).filter((n): n is number => n > 0))];
        const poIdsFromPick = [
          ...new Set(pickings.map((p) => this.relId(p.purchase_id)).filter((n): n is number => n > 0)),
        ];
        const polines = plIds.length
          ? await this.odoo.searchRead(
              "purchase.order.line",
              [["id", "in", plIds]],
              ["id", "order_id", "price_unit"],
              { limit: plIds.length },
            )
          : [];
        const orderIds = [
          ...new Set([
            ...polines.map((p) => this.relId(p.order_id)),
            ...poIdsFromPick,
          ].filter((n): n is number => n > 0)),
        ];
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
        const pricedByOrder = await this.pricedUnitByOrders(orderIds);
        const refByMoveId = new Map<number, OdooPurchaseRef>();
        for (const m of moves) {
          const pl = polines.find((p) => Number(p.id) === this.relId(m.purchase_line_id));
          const pick = pickMap.get(this.relId(m.picking_id));
          const order = orderMap.get(this.relId(pl?.order_id) || this.relId(pick?.purchase_id) || 0);
          if (!order) continue;
          const oid = Number(order.id);
          refByMoveId.set(
            Number(m.id),
            purchaseRefFromOrder({
              poId: oid,
              poName: String(order.name || ""),
              vendorName: this.relName(order.partner_id),
              billName: bills.get(oid) || null,
              unitPrice: Number(pl?.price_unit) || pricedByOrder.get(oid) || null,
            }),
          );
        }
        out = assignRefsBySharedMove(lineLots, refByMoveId);
      }
    } catch {
      /* sigue con el texto de la OC */
    }

    try {
      let noteLines: Record<string, unknown>[] = [];
      try {
        noteLines = await this.odoo.searchRead(
          "purchase.order.line",
          ["|", ["name", "ilike", "//"], ["display_type", "=", "line_note"]],
          ["id", "order_id", "name", "price_unit"],
          { limit: 800 },
        );
      } catch {
        noteLines = await this.odoo.searchRead(
          "purchase.order.line",
          [["name", "ilike", "//"]],
          ["id", "order_id", "name", "price_unit"],
          { limit: 800 },
        );
      }
      const orderIds = [...new Set(noteLines.map((l) => this.relId(l.order_id)).filter((n): n is number => n > 0))];
      if (!orderIds.length) return out;
      const pricedByOrder = await this.pricedUnitByOrders(orderIds);
      const orders = await this.odoo.searchRead(
        "purchase.order",
        [["id", "in", orderIds]],
        ["id", "name", "partner_id", "invoice_ids"],
        { limit: orderIds.length },
      );
      const bills = await this.billsByOrders(orders);
      const refByOrder = new Map<number, OdooPurchaseRef>();
      for (const po of orders) {
        const oid = Number(po.id);
        refByOrder.set(
          oid,
          purchaseRefFromOrder({
            poId: oid,
            poName: String(po.name || ""),
            vendorName: this.relName(po.partner_id),
            billName: bills.get(oid) || null,
            unitPrice: pricedByOrder.get(oid) || null,
          }),
        );
      }
      out = applySerialTextRefs(
        noteLines.map((l) => ({ name: String(l.name || ""), orderId: this.relId(l.order_id) })),
        byIso,
        refByOrder,
        out,
      );
    } catch {
      /* sin OC en texto */
    }
    return out;
  }

  private async pricedUnitByOrders(orderIds: number[]) {
    const priceByOrder = new Map<number, number>();
    if (!orderIds.length) return priceByOrder;
    const priced = await this.odoo.searchRead(
      "purchase.order.line",
      [
        ["order_id", "in", orderIds],
        ["product_id", "!=", false],
        ["price_unit", ">", 0],
      ],
      ["order_id", "price_unit"],
      { limit: 800 },
    );
    for (const l of priced) {
      const oid = this.relId(l.order_id);
      if (oid && !priceByOrder.has(oid)) priceByOrder.set(oid, Number(l.price_unit) || 0);
    }
    return priceByOrder;
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
      odooDescription?: string | null;
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
        odooDescription: cand.odooDescription ?? undefined,
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
          odooDescription: attrs.description ?? cand.odooDescription,
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
    odooDescription?: string | null;
    payload?: unknown;
  }) {
    const extra = (cand.payload && typeof cand.payload === "object" ? cand.payload : {}) as {
      attrs?: { material?: string | null; zgroupCode?: string | null; description?: string | null };
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
      description: cand.odooDescription ?? extra.attrs?.description ?? null,
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
      odooDescription?: string | null;
      payload?: unknown;
      odooIntakeKind?: string | null;
      odooPickingName?: string | null;
      costSource?: string | null;
      odooMoName?: string | null;
      odooSourceLotId?: number | null;
      odooSourceProductCode?: string | null;
      odooSourceProductName?: string | null;
      odooSourceIntakeKind?: string | null;
      odooSourcePoName?: string | null;
      odooSourceUnitPrice?: Prisma.Decimal | number | null;
      fobCif?: number | null;
      intakeType?: string | null;
      invoicePending?: boolean;
    },
  ) {
    const c = await this.prisma.container.findUnique({ where: { iso } });
    if (!c) return;
    const mapped = this.mappedFromCandidate(cand);
    const source = this.sourceFromCandidate(cand);
    const awaitingReconcile = !c.odooPoId && (c.invoicePending || c.intakeType === "pendiente_factura");
    const data: Prisma.ContainerUpdateInput = {
      odooSource: source as Prisma.InputJsonValue,
      odooLotId: c.odooLotId || cand.odooLotId || undefined,
      intakeOrigin: awaitingReconcile ? c.intakeOrigin : c.intakeOrigin === "manual" ? "odoo" : c.intakeOrigin,
    };
    if (!awaitingReconcile && !c.odooIntakeKind && cand.odooIntakeKind) data.odooIntakeKind = cand.odooIntakeKind;
    if (!awaitingReconcile && !c.odooPickingName && cand.odooPickingName) data.odooPickingName = cand.odooPickingName;
    if (!awaitingReconcile && !c.costSource && cand.costSource) data.costSource = cand.costSource;
    if (!c.odooMoName && cand.odooMoName) data.odooMoName = cand.odooMoName;
    if (!c.odooSourceLotId && cand.odooSourceLotId) data.odooSourceLotId = cand.odooSourceLotId;
    if (!c.odooSourceProductCode && cand.odooSourceProductCode) data.odooSourceProductCode = cand.odooSourceProductCode;
    if (!c.odooSourceProductName && cand.odooSourceProductName) data.odooSourceProductName = cand.odooSourceProductName;
    if (!c.odooSourceIntakeKind && cand.odooSourceIntakeKind) data.odooSourceIntakeKind = cand.odooSourceIntakeKind;
    if (!c.odooSourcePoName && cand.odooSourcePoName) data.odooSourcePoName = cand.odooSourcePoName;
    if (c.odooSourceUnitPrice == null && cand.odooSourceUnitPrice != null) data.odooSourceUnitPrice = cand.odooSourceUnitPrice;
    if (!awaitingReconcile && (!c.fobCif || Number(c.fobCif) === 0) && cand.fobCif && cand.fobCif > 0) data.fobCif = cand.fobCif;
    if (!awaitingReconcile && c.intakeType === "pendiente_factura" && cand.intakeType && cand.intakeType !== "pendiente_factura") {
      data.intakeType = cand.intakeType;
      if (cand.invoicePending !== undefined) data.invoicePending = cand.invoicePending;
    }
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
    if (!c.odooDescription && cand.odooDescription) data.odooDescription = cand.odooDescription;
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
