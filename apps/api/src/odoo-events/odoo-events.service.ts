import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { OdooImportService } from "../odoo-import/odoo-import.service";
import {
  applyOdooEvent,
  normalizeIncomingEvent,
  webhookSecretFrom,
  webhookSecretOk,
  ODOO_WEBHOOK_SECRET_KEY,
  type IncomingOdooEvent,
} from "../domain/odoo-event";
import { inspectOdooIso, type OdooOwnedField } from "../domain/odoo-lot-map";
import { ExpedienteStore } from "./expediente.store";

@Injectable()
export class OdooEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OdooEventsService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly imports: OdooImportService,
  ) {
    this.expediente = new ExpedienteStore(prisma);
  }

  private readonly expediente: ExpedienteStore;

  onModuleInit() {
    this.timer = setInterval(() => {
      this.pollPending().catch((e) => this.log.warn(`poll eventos Odoo: ${(e as Error).message}`));
    }, 45_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async assertSecret(provided?: string) {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_WEBHOOK_SECRET_KEY } });
    const expected = webhookSecretFrom(row?.value);
    if (!webhookSecretOk(provided, expected)) {
      throw new UnauthorizedException("Secreto de webhook inválido o no configurado.");
    }
  }

  async listInbox(limit = 50) {
    return this.prisma.odooBridgeEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }

  async listConflicts() {
    return this.prisma.odooFieldConflict.findMany({
      where: { status: "pending" },
      include: { candidate: { select: { id: true, serialRaw: true, isoNormalized: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async ingest(rawEvents: IncomingOdooEvent[]) {
    const items: { odooEventId: number | null; action: string; reason?: string }[] = [];
    for (const raw of rawEvents || []) {
      items.push(await this.applyOne(raw));
    }
    return { ok: true, accepted: items.length, items };
  }

  async pollPending() {
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await this.odoo.searchRead(
      "zdry.sync.event",
      [
        ["state", "=", "pending"],
        ["origin", "=", "odoo"],
      ],
      ["id", "model", "res_id", "iso", "event", "origin", "payload", "source_write_date"],
      { limit: 50, order: "id asc" },
    );
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/zdry\.sync\.event|Object .* does not exist|no existe/i.test(msg)) {
        return { polled: 0, skipped: "modulo_no_instalado" };
      }
      throw e;
    }
    if (!rows.length) return { polled: 0 };
    const incoming = rows.map((r) => this.fromOdooRow(r));
    const result = await this.ingest(incoming);
    const ids = rows.map((r) => Number(r.id)).filter((n) => n > 0);
    if (ids.length) {
      try {
        await this.odoo.write("zdry.sync.event", ids, { state: "sent" }, { context: { zdry_sync: true } });
      } catch (e) {
        this.log.warn(`no se pudo marcar sent: ${(e as Error).message}`);
      }
    }
    return { polled: rows.length, ...result };
  }

  private fromOdooRow(r: Record<string, unknown>): IncomingOdooEvent {
    let payload = r.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    return {
      id: Number(r.id) || undefined,
      model: r.model ? String(r.model) : undefined,
      res_id: Number(r.res_id) || undefined,
      iso: r.iso ? String(r.iso) : undefined,
      event: r.event ? String(r.event) : undefined,
      origin: r.origin ? String(r.origin) : undefined,
      payload: payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {},
      write_date: r.source_write_date ? String(r.source_write_date) : r.write_date ? String(r.write_date) : undefined,
    };
  }

  private async applyOne(raw: IncomingOdooEvent) {
    const ev = normalizeIncomingEvent(raw);
    if (!ev) return { odooEventId: null, action: "ignore", reason: "evento vacío" };
    if (ev.odooEventId) {
      const seen = await this.prisma.odooBridgeEvent.findUnique({ where: { odooEventId: ev.odooEventId } });
      if (seen) return { odooEventId: ev.odooEventId, action: "ignore", reason: "duplicado" };
    }

    const cand = await this.findCandidate(ev.resId, ev.iso, ev.isoNormalized, ev.model);
    const decision = applyOdooEvent({
      event: raw,
      localTouched: cand?.localTouched,
      current: cand
        ? {
            color: cand.color,
            tareKg: cand.tareKg,
            mgwKg: cand.mgwKg,
            year: cand.year,
            manufacturer: cand.manufacturer,
            dua: cand.dua,
            originCountry: cand.originCountry,
            material: cand.material,
            qtyOnHand: cand.qtyOnHand,
          }
        : undefined,
    });

    if (decision.action === "apply" && cand) {
      const data: Prisma.OdooLotCandidateUpdateInput = {
        lastSyncedAt: new Date(),
        odooSyncStatus: "live",
        odooSyncError: null,
        localTouched: false,
      };
      this.assignOwned(data, decision.updates);
      if (decision.qtyOnHand != null) data.qtyOnHand = decision.qtyOnHand;
      await this.prisma.odooLotCandidate.update({ where: { id: cand.id }, data });
      const overwrittenFields = Object.keys(decision.updates);
      if (overwrittenFields.length) {
        await this.prisma.odooFieldWriteback.updateMany({
          where: { candidateId: cand.id, field: { in: overwrittenFields }, status: { in: ["pending", "error"] } },
          data: { status: "cancelled", lastError: "Odoo prevaleció" },
        });
      }
    }

    if (decision.action === "conflict" && cand) {
      if (Object.keys(decision.updates).length) {
        const data: Prisma.OdooLotCandidateUpdateInput = { lastSyncedAt: new Date() };
        this.assignOwned(data, decision.updates);
        await this.prisma.odooLotCandidate.update({ where: { id: cand.id }, data });
      }
    }

    if (decision.action === "refresh") {
      await this.imports.refreshByKeys({ isos: decision.isos, lotIds: decision.lotIds });
    }

    if (decision.action !== "ignore") await this.expediente.appendEvent(raw, {
      candidateId: cand?.id,
      containerIso: cand?.containerIso,
      current: cand
        ? {
            color: cand.color,
            tareKg: cand.tareKg,
            mgwKg: cand.mgwKg,
            year: cand.year,
            manufacturer: cand.manufacturer,
            dua: cand.dua,
            originCountry: cand.originCountry,
            material: cand.material,
          }
        : undefined,
      applied: decision.action === "apply" || decision.action === "conflict" ? decision.updates : {},
      conflicts: decision.action === "conflict" ? decision.conflicts : [],
      odooEventId: ev.odooEventId,
    });

    await this.prisma.odooBridgeEvent.create({
      data: {
        odooEventId: ev.odooEventId,
        model: ev.model,
        resId: ev.resId,
        iso: ev.iso,
        event: ev.event,
        origin: ev.origin,
        payload: ev.payload as Prisma.InputJsonValue,
        sourceWriteDate: this.parseDate(ev.sourceWriteDate),
        action: decision.action,
        reason: "reason" in decision ? decision.reason : null,
      },
    });

    return {
      odooEventId: ev.odooEventId,
      action: decision.action,
      reason: "reason" in decision ? decision.reason : undefined,
    };
  }

  private assignOwned(data: Prisma.OdooLotCandidateUpdateInput, updates: Partial<Record<OdooOwnedField, string | number | null>>) {
    if (updates.color !== undefined) data.color = updates.color == null ? null : String(updates.color);
    if (updates.tareKg !== undefined) data.tareKg = updates.tareKg == null ? null : Number(updates.tareKg);
    if (updates.mgwKg !== undefined) data.mgwKg = updates.mgwKg == null ? null : Number(updates.mgwKg);
    if (updates.year !== undefined) data.year = updates.year == null ? null : Number(updates.year);
    if (updates.manufacturer !== undefined) data.manufacturer = updates.manufacturer == null ? null : String(updates.manufacturer);
    if (updates.dua !== undefined) data.dua = updates.dua == null ? null : String(updates.dua);
    if (updates.originCountry !== undefined) data.originCountry = updates.originCountry == null ? null : String(updates.originCountry);
    if (updates.material !== undefined) data.material = updates.material == null ? null : String(updates.material);
  }

  private async findCandidate(resId: number, iso: string | null, isoNormalized: string | null, model: string) {
    if (model === "stock.lot" && resId) {
      const byId = await this.prisma.odooLotCandidate.findUnique({ where: { odooLotId: resId } });
      if (byId) return byId;
    }
    const needle = isoNormalized || (iso ? inspectOdooIso(iso).isoNormalized : "");
    if (!needle) return null;
    return this.prisma.odooLotCandidate.findFirst({ where: { isoNormalized: needle } });
  }

  private parseDate(raw: string | null) {
    if (!raw) return null;
    const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
