import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { odooQuoteSyncReady } from "../domain/odoo-config";
import { many2oneId } from "../domain/quote-issue-draft";
import {
  SALE_CLOSE_EVENT,
  SALE_CLOSE_MAX_ATTEMPTS,
  SALE_CLOSE_SOURCE,
  QuoteSaleCloseError,
  assertCloseable,
  assertHasLots,
  closeKwargs,
  equipoWriteValue,
  matchSolToIso,
} from "../domain/quote-sale-close";

const SYNC = closeKwargs();

@Injectable()
export class SaleCloseWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SaleCloseWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log.warn(`sale_close: ${(e as Error).message}`));
    }, 12_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.busy) return;
    const cfg = await this.odoo.readConfig();
    if (!odooQuoteSyncReady(cfg)) return;
    this.busy = true;
    try {
      const jobs = await this.prisma.odooSyncJob.findMany({
        where: { event: SALE_CLOSE_EVENT, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 2,
      });
      for (const job of jobs) {
        await this.runJob(job.id);
      }
    } finally {
      this.busy = false;
    }
  }

  async retry(jobId: string) {
    const job = await this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("Trabajo no encontrado.");
    await this.prisma.odooSyncJob.update({
      where: { id: jobId },
      data: { status: "pending", lastError: null, attempts: 0 },
    });
    return this.runJob(jobId);
  }

  async runJob(jobId: string) {
    const job = await this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    if (!job || job.event !== SALE_CLOSE_EVENT) return job;
    if (job.status === "sent") return job;
    if (job.attempts >= SALE_CLOSE_MAX_ATTEMPTS && job.status === "error") return job;

    await this.prisma.odooSyncJob.update({
      where: { id: jobId },
      data: { status: "running", attempts: { increment: 1 } },
    });

    try {
      const result = await this.closeQuote(job.quoteId);
      await this.prisma.odooSyncJob.update({
        where: { id: jobId },
        data: { status: "sent", lastError: null, payload: result as Prisma.InputJsonValue },
      });
      return this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    } catch (e) {
      const message = (e as Error).message || String(e);
      const attempts = job.attempts + 1;
      await this.prisma.odooSyncJob.update({
        where: { id: jobId },
        data: {
          status: attempts >= SALE_CLOSE_MAX_ATTEMPTS ? "error" : "pending",
          lastError: message.slice(0, 500),
        },
      });
      await this.prisma.quoteEvent.create({
        data: { quoteId: job.quoteId, type: "odoo_close_error", detail: message.slice(0, 280) },
      });
      this.log.warn(`sale_close ${job.quoteId}: ${message}`);
      return this.prisma.odooSyncJob.findUnique({ where: { id: jobId } });
    }
  }

  private async closeQuote(quoteId: string) {
    const q = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, lines: true },
    });
    if (!q) throw new QuoteSaleCloseError("Cotización no encontrada.", "missing_sale");
    assertCloseable({
      kind: q.kind,
      demo: q.demo,
      odooSaleId: q.odooSaleId,
      vat: q.customer.rucDni,
      lines: q.lines,
    });
    const saleId = q.odooSaleId as number;

    const soRows = await this.odoo.read("sale.order", [saleId], [
      "name",
      "state",
      "invoice_status",
      "amount_untaxed",
      "amount_tax",
      "amount_total",
      "order_line",
      "picking_ids",
      "invoice_ids",
    ]);
    const so = soRows[0];
    if (!so) throw new QuoteSaleCloseError("No se encontró la SO en Odoo.", "missing_sale");

    const lineIds = Array.isArray(so.order_line) ? (so.order_line as number[]) : [];
    const sols = lineIds.length
      ? await this.odoo.read("sale.order.line", lineIds, ["id", "name", "x_studio_tipo", "product_id"])
      : [];
    const matched = matchSolToIso(
      sols.map((l) => ({
        id: Number(l.id),
        name: l.name != null ? String(l.name) : "",
        x_studio_tipo: l.x_studio_tipo != null ? String(l.x_studio_tipo) : "",
      })),
      q.lines.map((l) => l.iso),
    );
    const binds = [];
    for (const m of matched) {
      const c = await this.prisma.container.findUnique({ where: { iso: m.iso } });
      binds.push({ ...m, lotId: c?.odooLotId ?? null });
    }
    assertHasLots(binds);

    const lineFields = await this.odoo.fieldsGet("sale.order.line");
    const equipoType = lineFields.x_studio_equipo?.type;
    if (equipoType) {
      for (const b of binds) {
        const value = equipoWriteValue(equipoType, b.lotId, b.iso);
        if (value == null) continue;
        await this.odoo.write("sale.order.line", [b.lineId], { x_studio_equipo: value }, SYNC);
      }
    }

    let state = String(so.state || "draft");
    if (state !== "sale" && state !== "done") {
      await this.odoo.callKw("sale.order", "action_confirm", [[saleId]], SYNC);
    }

    const after = (
      await this.odoo.read("sale.order", [saleId], [
        "state",
        "invoice_status",
        "amount_untaxed",
        "amount_tax",
        "amount_total",
        "picking_ids",
        "invoice_ids",
        "name",
      ])
    )[0];
    state = String(after?.state || state);

    const pickingIds = Array.isArray(after?.picking_ids) ? (after.picking_ids as number[]) : [];
    let pickingName: string | null = q.odooPickingName;
    let pickingState: string | null = q.odooPickingState;
    let pickingId: number | null = q.odooPickingId;
    if (pickingIds.length) {
      const picks = await this.odoo.read("stock.picking", pickingIds, ["id", "name", "state", "picking_type_code"]);
      const outgoing = picks.find((p) => String(p.picking_type_code) === "outgoing") || picks[0];
      pickingId = Number(outgoing.id);
      pickingName = String(outgoing.name || "");
      pickingState = String(outgoing.state || "");
      await this.assignLotsOnPicking(pickingId, binds);
    }

    let invoiceName = q.odooInvoiceName;
    let invoiceId = q.odooInvoiceId;
    const invoiceStatus = String(after?.invoice_status || "");
    if (invoiceStatus === "to_invoice") {
      try {
        const created = await this.odoo.callKw("sale.order", "_create_invoices", [[saleId]]);
        const ids = this.asIds(created);
        if (ids.length) {
          invoiceId = ids[0];
          try {
            await this.odoo.callKw("account.move", "action_post", [ids]);
          } catch (postErr) {
            this.log.warn(`factura draft ${q.number}: ${(postErr as Error).message}`);
          }
          const inv = (await this.odoo.read("account.move", ids, ["id", "name", "state"]))[0];
          invoiceName = String(inv?.name || invoiceName || "");
          invoiceId = Number(inv?.id || invoiceId);
        }
      } catch (invErr) {
        this.log.warn(`_create_invoices ${q.number}: ${(invErr as Error).message}`);
      }
    } else if (Array.isArray(after?.invoice_ids) && (after.invoice_ids as number[]).length) {
      const ids = after.invoice_ids as number[];
      const inv = (await this.odoo.read("account.move", ids, ["id", "name", "state"]))[0];
      invoiceId = Number(inv?.id || ids[0]);
      invoiceName = String(inv?.name || "");
    }

    const fresh = (
      await this.odoo.read("sale.order", [saleId], ["state", "invoice_status", "amount_untaxed", "amount_tax", "amount_total"])
    )[0];

    await this.prisma.quote.update({
      where: { id: q.id },
      data: {
        odooState: String(fresh?.state || state),
        odooInvoiceStatus: fresh?.invoice_status != null ? String(fresh.invoice_status) : invoiceStatus,
        odooAmountUntaxed: Number(fresh?.amount_untaxed) || undefined,
        odooAmountTax: Number(fresh?.amount_tax) || undefined,
        odooAmountTotal: Number(fresh?.amount_total) || undefined,
        odooInvoiceId: invoiceId,
        odooInvoiceName: invoiceName,
        odooPickingId: pickingId,
        odooPickingName: pickingName,
        odooPickingState: pickingState,
      },
    });
    await this.prisma.quoteOdooRevision.create({
      data: {
        quoteId: q.id,
        source: SALE_CLOSE_SOURCE,
        state: String(fresh?.state || state),
        invoiceStatus: fresh?.invoice_status != null ? String(fresh.invoice_status) : invoiceStatus,
        amountUntaxed: Number(fresh?.amount_untaxed) || 0,
        amountTax: Number(fresh?.amount_tax) || 0,
        amountTotal: Number(fresh?.amount_total) || 0,
        linesJson: binds as object,
        diffJson: { state: { before: String(so.state), after: String(fresh?.state || state) } } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: q.id,
        type: "odoo_close",
        detail: `SO ${q.odooSaleName} confirmada (${fresh?.state}). Factura ${invoiceName || "pendiente"}. OUT ${pickingName || "—"} ${pickingState || ""} (no validado).`.replace(
          /\s+/g,
          " ",
        ),
      },
    });

    return {
      saleId,
      saleName: q.odooSaleName,
      state: fresh?.state,
      invoiceName,
      pickingName,
      pickingState,
      validatedOut: false,
    };
  }

  private async assignLotsOnPicking(pickingId: number, binds: Array<{ iso: string; lotId: number | null }>) {
    const moves = await this.odoo.searchRead(
      "stock.move",
      [["picking_id", "=", pickingId]],
      ["id", "move_line_ids", "product_id"],
      { limit: 40 },
    );
    const remaining = [...binds];
    for (const move of moves) {
      const mlIds = Array.isArray(move.move_line_ids) ? (move.move_line_ids as number[]) : [];
      if (!mlIds.length) continue;
      const lines = await this.odoo.read("stock.move.line", mlIds, ["id", "lot_id", "product_id"]);
      for (const ml of lines) {
        if (many2oneId(ml.lot_id)) continue;
        const next = remaining.shift();
        if (!next?.lotId) continue;
        try {
          await this.odoo.write("stock.move.line", [Number(ml.id)], { lot_id: next.lotId }, SYNC);
        } catch (e) {
          this.log.warn(`lot en move.line ${ml.id}: ${(e as Error).message}`);
          remaining.unshift(next);
        }
      }
    }
  }

  private asIds(raw: unknown): number[] {
    if (Array.isArray(raw)) return raw.map((n) => Number(n)).filter((n) => n > 0);
    if (typeof raw === "number" && raw > 0) return [raw];
    if (raw && typeof raw === "object" && "id" in (raw as object)) {
      const id = Number((raw as { id: unknown }).id);
      return id > 0 ? [id] : [];
    }
    return [];
  }
}
