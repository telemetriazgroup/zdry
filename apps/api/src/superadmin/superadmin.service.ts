import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AuditService } from "../audit/audit.service";
import { DemoService } from "../demo/demo.service";
import { AuthUser } from "../auth/auth.types";
import { envOdooConfig, normalizeOdooConfig, ODOO_CONFIG_KEY, publicOdooConfig } from "../domain/odoo-config";

const KEEP_SETTINGS = new Set([
  "system_initialized",
  ODOO_CONFIG_KEY,
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
    return {
      config: publicOdooConfig(cfg),
      source: row ? "guardado" : "entorno",
      queue,
    };
  }

  async saveOdoo(
    body: { enabled?: boolean; url?: string; db?: string; user?: string; apiKey?: string },
    user: AuthUser,
    ip?: string,
  ) {
    const current = await this.odooStatus();
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_CONFIG_KEY } });
    const prev = normalizeOdooConfig(row?.value, envOdooConfig());
    const next = normalizeOdooConfig(
      {
        enabled: body.enabled,
        url: body.url,
        db: body.db,
        user: body.user,
        apiKey: body.apiKey?.trim() ? body.apiKey : prev.apiKey,
      },
      prev,
    );
    await this.prisma.appSetting.upsert({
      where: { key: ODOO_CONFIG_KEY },
      update: { value: next },
      create: { key: ODOO_CONFIG_KEY, value: next },
    });
    await this.audit.log({
      user,
      action: "update",
      entity: "AppSetting",
      entityId: ODOO_CONFIG_KEY,
      after: { enabled: next.enabled, url: next.url, db: next.db, user: next.user, apiKeySet: Boolean(next.apiKey) },
      ip,
    });
    return { ...current, config: publicOdooConfig(next), source: "guardado" as const };
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
