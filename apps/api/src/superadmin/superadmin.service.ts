import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AuditService } from "../audit/audit.service";
import { DemoService } from "../demo/demo.service";
import { AuthUser } from "../auth/auth.types";
import {
  envOdooConfig,
  inferOdooModes,
  normalizeOdooConfig,
  normalizeOdooModes,
  ODOO_CONFIG_KEY,
  ODOO_MODES_KEY,
  publicOdooConfig,
  publicOdooMode,
  type OdooConfig,
  type OdooModeName,
  type OdooModeStore,
} from "../domain/odoo-config";
import { sameOdooOrigin } from "../domain/odoo-link";
import { OdooClient } from "../odoo/odoo.client";
import { OdooLinkService } from "../odoo/odoo-link.service";
import { auditEquipment, TypeAuditRow, TypeMaster } from "../domain/type-from-product";
import { refreshRulePrices } from "../odoo-import/acquisition-overlay.store";

function productText(src: unknown): { name: string; code: string } {
  if (!src || typeof src !== "object") return { name: "", code: "" };
  const row = src as { productName?: string; productCode?: string; product?: string };
  return { name: String(row.productName || row.product || ""), code: String(row.productCode || "") };
}

const KEEP_SETTINGS = new Set([
  "system_initialized",
  ODOO_CONFIG_KEY,
  ODOO_MODES_KEY,
  "catalog_copy",
  "layout_rules",
  "yard_config",
  "payment_accounts",
]);

@Injectable()
export class SuperadminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly demo: DemoService,
    private readonly odoo: OdooClient,
    private readonly links: OdooLinkService,
  ) {}

  async odooStatus() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_CONFIG_KEY } });
    const cfg = normalizeOdooConfig(row?.value, envOdooConfig());
    const queue = await this.prisma.odooSyncJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        quoteId: true,
        event: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const cutover = await this.links.cutoverState();
    const modes = await this.readModes(cfg);
    return {
      config: publicOdooConfig(cfg),
      source: row ? "guardado" : "entorno",
      mode: modes.active,
      modes: {
        staging: publicOdooMode(modes.staging),
        production: publicOdooMode(modes.production),
      },
      queue,
      cutover,
    };
  }

  async saveOdoo(
    body: { mode?: OdooModeName; activate?: boolean; enabled?: boolean; url?: string; db?: string; user?: string; apiKey?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_CONFIG_KEY } });
    const live = normalizeOdooConfig(row?.value, envOdooConfig());
    const modes = await this.readModes(live);
    const mode: OdooModeName = body.mode === "production" || body.mode === "staging" ? body.mode : modes.active || "staging";
    const slotPrev = modes[mode] || { enabled: false, url: "", db: "", user: "", apiKey: "" };
    const next = normalizeOdooConfig(
      {
        enabled: body.enabled,
        url: body.url,
        db: body.db,
        user: body.user,
        apiKey: body.apiKey?.trim() ? body.apiKey : slotPrev.apiKey,
      },
      slotPrev,
    );
    const stored: OdooModeStore = { ...modes, [mode]: next };
    const activate = body.activate === true;
    if (!activate) {
      await this.writeModes(stored);
      await this.audit.log({
        user,
        action: "odoo_mode_save",
        entity: "AppSetting",
        entityId: ODOO_MODES_KEY,
        after: { mode, url: next.url, db: next.db, user: next.user, apiKeySet: Boolean(next.apiKey), active: stored.active },
        ip,
      });
      return this.odooStatus();
    }
    const originChanged = !sameOdooOrigin(live, next);
    if (originChanged && !next.apiKey) {
      throw new BadRequestException("Para activar este modo hace falta la clave API de la cuenta principal de ese servidor.");
    }
    if (originChanged) {
      const probe = await this.probeConfig(next);
      if (!probe.ok) {
        throw new BadRequestException(probe.message || "La Odoo nueva rechazó la cuenta principal. No se cambió el modo.");
      }
    }
    stored.active = mode;
    await this.prisma.appSetting.upsert({
      where: { key: ODOO_CONFIG_KEY },
      update: { value: next },
      create: { key: ODOO_CONFIG_KEY, value: next },
    });
    await this.writeModes(stored);
    await this.audit.log({
      user,
      action: "odoo_mode_activate",
      entity: "AppSetting",
      entityId: ODOO_CONFIG_KEY,
      after: { mode, enabled: next.enabled, url: next.url, db: next.db, user: next.user, apiKeySet: Boolean(next.apiKey), originChanged },
      ip,
    });
    if (originChanged) await this.links.onOriginChange(user, live, next);
    return this.odooStatus();
  }

  private async readModes(live: OdooConfig): Promise<OdooModeStore> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_MODES_KEY } });
    if (!row?.value) return inferOdooModes(live);
    return normalizeOdooModes(row.value, live);
  }

  private async writeModes(modes: OdooModeStore) {
    const value = {
      active: modes.active,
      staging: modes.staging,
      production: modes.production,
    };
    await this.prisma.appSetting.upsert({
      where: { key: ODOO_MODES_KEY },
      update: { value },
      create: { key: ODOO_MODES_KEY, value },
    });
  }

  private async probeConfig(cfg: OdooConfig) {
    if (!cfg.url || !cfg.db || !cfg.user || !cfg.apiKey) {
      return { ok: false, message: "Faltan URL, base, usuario o clave de la cuenta principal." };
    }
    try {
      const uid = await this.odoo.authenticate(cfg);
      await this.odoo.executeKw(cfg, uid, "res.users", "read", [[uid], ["name", "login"]]);
      return { ok: true, message: "Conexión correcta." };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  listOdooLinks() {
    return this.links.listForAdmin();
  }

  setOdooBypass(userId: string, bypass: boolean, user: AuthUser, ip?: string) {
    return this.links.setBypass(user, userId, bypass, ip);
  }

  async listBackups() {
    const rows = await this.prisma.dataBackup.findMany({ orderBy: { createdAt: "desc" }, take: 80 });
    return rows.map((b) => ({
      ...b,
      mediaFiles: typeof (b.notes as { mediaFiles?: number } | null)?.mediaFiles === "number"
        ? (b.notes as { mediaFiles: number }).mediaFiles
        : 0,
    }));
  }

  async createBackup(label: string, kind: string, user: AuthUser) {
    const row = await this.demo.createBackup(label || "Respaldo del sistema", kind, user);
    const mediaFiles = await this.copyLiveMedia(`system-backups/${row.id}/media/`);
    const notes = {
      ...(typeof row.notes === "object" && row.notes ? row.notes : {}),
      mediaFiles,
      full: true,
    };
    return this.prisma.dataBackup.update({
      where: { id: row.id },
      data: { notes },
    });
  }

  async restore(id: string, user: AuthUser, ip?: string) {
    const row = await this.prisma.dataBackup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Backup no encontrado.");
    await this.demo.restore(id, user, ip);
    const prefix = `system-backups/${id}/media/`;
    const keys = await this.storage.listKeys(prefix);
    let restored = 0;
    for (const key of keys) {
      const original = key.slice(prefix.length);
      if (!original || this.storage.isArchiveKey(original)) continue;
      const { buffer, contentType } = await this.storage.getBuffer(key);
      await this.storage.put(original, buffer, contentType || "application/octet-stream");
      restored += 1;
    }
    await this.audit.log({
      user,
      action: "system_restore",
      entity: "DataBackup",
      entityId: id,
      after: { label: row.label, mediaRestored: restored },
      ip,
    });
    return { ok: true, restored: row, mediaRestored: restored };
  }

  async wipe(confirm: string, user: AuthUser, ip?: string) {
    const phrase = (confirm || "").trim().toUpperCase();
    if (phrase !== "VACIAR") {
      throw new BadRequestException("Escribe VACIAR para confirmar. Primero se exporta un respaldo interno.");
    }
    const backup = await this.createBackup("Antes de vaciar el sistema", "pre_wipe", user);
    if (!backup?.storageKey) {
      throw new BadRequestException("No se pudo exportar el respaldo. El vaciado no se ejecutó.");
    }

    const mediaDeleted = await this.deleteLiveMedia();
    const removed = await this.deleteOperationalData(user.id);

    await this.audit.log({
      user,
      action: "system_wipe",
      entity: "DataBackup",
      entityId: backup.id,
      after: { backupId: backup.id, removed, mediaDeleted },
      ip,
    });

    return {
      ok: true,
      backup,
      removed,
      mediaDeleted,
      note: "Quedó solo el superadmin. El respaldo interno se puede restaurar desde esta pantalla.",
    };
  }

  private async copyLiveMedia(destPrefix: string) {
    const keys = await this.storage.listKeys();
    let n = 0;
    for (const key of keys) {
      if (this.storage.isArchiveKey(key)) continue;
      const { buffer, contentType } = await this.storage.getBuffer(key);
      await this.storage.put(`${destPrefix}${key}`, buffer, contentType || "application/octet-stream");
      n += 1;
    }
    return n;
  }

  private async deleteLiveMedia() {
    const keys = await this.storage.listKeys();
    let n = 0;
    for (const key of keys) {
      if (this.storage.isArchiveKey(key)) continue;
      try {
        await this.storage.delete(key);
        n += 1;
      } catch {
        /* orphan ok */
      }
    }
    return n;
  }

  async typeAudit() {
    const built = await this.collectTypeAudit();
    return {
      scannedContainers: built.scannedContainers,
      scannedLots: built.scannedLots,
      typeCount: built.rows.filter((row) => row.suggestedType).length,
      conditionCount: built.rows.filter((row) => row.suggestedCat).length,
      rows: built.rows,
    };
  }

  async applyTypeAudit(body: { ids?: string[]; applyCondition?: boolean }, user: AuthUser, ip: string | undefined) {
    const ids = [...new Set((body.ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException("Elige al menos un equipo.");
    const wanted = new Set(ids);
    const built = await this.collectTypeAudit();
    const chosen = built.rows.filter((row) => wanted.has(row.id) && (row.suggestedType || (body.applyCondition && row.suggestedCat)));
    if (!chosen.length) throw new BadRequestException("Ninguna fila elegida tiene una sugerencia aplicable.");
    const applyCondition = body.applyCondition === true;
    let types = 0;
    let conditions = 0;
    const priced: string[] = [];
    for (const row of chosen) {
      if (row.source === "contenedor" && row.suggestedType && row.suggestedType !== row.currentType) {
        await this.prisma.container.update({ where: { iso: row.iso }, data: { type: row.suggestedType } });
        await this.prisma.containerHistory.create({
          data: {
            iso: row.iso,
            type: "Tipo",
            detail: `Tipo corregido de ${row.currentType} a ${row.suggestedType} según «${row.productName}». No cambia el producto en Odoo ni las cotizaciones ya emitidas.`,
          },
        });
        if (row.candidateId) {
          await this.prisma.odooLotCandidate.update({ where: { id: row.candidateId }, data: { zdryType: row.suggestedType } });
        }
        priced.push(row.iso);
        types += 1;
      } else if (row.source === "lote" && row.candidateId && row.suggestedType && row.suggestedType !== row.currentType) {
        await this.prisma.odooLotCandidate.update({ where: { id: row.candidateId }, data: { zdryType: row.suggestedType } });
        types += 1;
      }
      if (applyCondition && row.suggestedCat && row.suggestedCat !== row.currentCat) {
        if (row.source === "contenedor") {
          await this.prisma.container.update({ where: { iso: row.iso }, data: { cat: row.suggestedCat } });
          await this.prisma.containerHistory.create({
            data: {
              iso: row.iso,
              type: "Condición",
              detail: `Condición corregida de ${row.currentCat || "vacía"} a ${row.suggestedCat} según «${row.productName}».`,
            },
          });
          if (row.candidateId) {
            await this.prisma.odooLotCandidate.update({ where: { id: row.candidateId }, data: { zdryCat: row.suggestedCat } });
          }
          priced.push(row.iso);
        } else if (row.candidateId) {
          await this.prisma.odooLotCandidate.update({ where: { id: row.candidateId }, data: { zdryCat: row.suggestedCat } });
        }
        conditions += 1;
      }
    }
    const prices = priced.length ? await refreshRulePrices(this.prisma, { isos: [...new Set(priced)] }) : { updated: 0 };
    await this.audit.log({
      user,
      action: "type_audit_apply",
      entity: "Container",
      entityId: "type-audit",
      after: { types, conditions, prices: prices.updated, ids: chosen.map((row) => row.id) },
      ip,
    });
    return { types, conditions, pricesRecalculated: prices.updated };
  }

  private async collectTypeAudit() {
    const [types, containers, candidates] = await Promise.all([
      this.prisma.containerType.findMany(),
      this.prisma.container.findMany({
        where: { archivedAt: null },
        select: { iso: true, type: true, cat: true, odooLotId: true, odooSource: true },
      }),
      this.prisma.odooLotCandidate.findMany({
        where: { status: { not: "ignored" } },
        select: {
          id: true,
          isoNormalized: true,
          containerIso: true,
          odooLotId: true,
          productName: true,
          productCode: true,
          zdryType: true,
          zdryCat: true,
        },
      }),
    ]);
    const masters: TypeMaster[] = types.map((row) => ({
      code: row.code,
      label: row.label,
      dims: row.dims,
      archivedAt: row.archivedAt,
    }));
    const byLot = new Map(candidates.filter((row) => row.odooLotId).map((row) => [row.odooLotId, row]));
    const byIso = new Map<string, (typeof candidates)[number]>();
    for (const row of candidates) {
      const key = (row.containerIso || row.isoNormalized || "").toUpperCase();
      if (key && !byIso.has(key)) byIso.set(key, row);
    }
    const usedCandidate = new Set<string>();
    const rows: Array<TypeAuditRow & { candidateId: string | null }> = [];
    let scannedContainers = 0;
    for (const unit of containers) {
      const cand = (unit.odooLotId ? byLot.get(unit.odooLotId) : undefined) || byIso.get(unit.iso.toUpperCase());
      const source = productText(unit.odooSource);
      const productName = cand?.productName || source.name;
      const productCode = cand?.productCode || source.code;
      if (!productName && !productCode) continue;
      scannedContainers += 1;
      if (cand) usedCandidate.add(cand.id);
      const found = auditEquipment({
        id: unit.iso,
        iso: unit.iso,
        source: "contenedor",
        currentType: unit.type,
        currentCat: unit.cat,
        productName,
        productCode,
      }, masters);
      if (found) rows.push({ ...found, candidateId: cand?.id || null });
    }
    let scannedLots = 0;
    for (const cand of candidates) {
      if (usedCandidate.has(cand.id) || cand.containerIso) continue;
      if (!cand.productName && !cand.productCode) continue;
      scannedLots += 1;
      const found = auditEquipment({
        id: `cand:${cand.id}`,
        iso: cand.isoNormalized || cand.containerIso || "",
        source: "lote",
        currentType: cand.zdryType || "",
        currentCat: cand.zdryCat || "",
        productName: cand.productName,
        productCode: cand.productCode,
      }, masters);
      if (found) rows.push({ ...found, candidateId: cand.id });
    }
    rows.sort((a, b) => a.iso.localeCompare(b.iso) || a.id.localeCompare(b.id));
    return { rows, scannedContainers, scannedLots };
  }

  private async deleteOperationalData(keepUserId: string) {
    await this.prisma.odooFieldWriteback.deleteMany();
    await this.prisma.odooLotCandidate.deleteMany();
    await this.prisma.dispatch.deleteMany();
    await this.prisma.quote.deleteMany();
    await this.prisma.container.deleteMany();
    await this.prisma.purchaseInvoice.deleteMany();
    await this.prisma.auditLog.deleteMany();
    await this.prisma.provider.deleteMany();
    await this.prisma.pricingRule.deleteMany();
    await this.prisma.visibilityRule.deleteMany();
    await this.prisma.commercialService.deleteMany();

    await this.prisma.user.deleteMany({
      where: { NOT: { OR: [{ id: keepUserId }, { role: "superadmin" }] } },
    });
    await this.prisma.customer.deleteMany();
    await this.prisma.depot.deleteMany();

    const settings = await this.prisma.appSetting.findMany({ select: { key: true } });
    for (const s of settings) {
      if (!KEEP_SETTINGS.has(s.key)) {
        await this.prisma.appSetting.delete({ where: { key: s.key } });
      }
    }

    return {
      quotes: true,
      containers: true,
      users: "solo superadmin",
      customers: true,
      invoices: true,
    };
  }
}
