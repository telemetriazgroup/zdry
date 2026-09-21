import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { StorageService } from "../storage/storage.service";
import { loadQuoteIssueConfig } from "./quote-issue.store";
import { ZDRY_SYNC_CONTEXT } from "../domain/quote-issue-draft";
import {
  decodeOdooPdf,
  isPdfBuffer,
  pdfLooksLikePeruV2,
  presupuestoFilename,
  quoteMailBody,
  quotePdfStorageKey,
  cronogramaFilename,
  cronogramaStorageKey,
} from "../domain/odoo-quote-pdf";

const SYNC = { context: { ...ZDRY_SYNC_CONTEXT } };

export type QuotePdfResult = {
  buffer: Buffer;
  filename: string;
  source: "odoo" | "prototype";
  storageKey: string | null;
};

@Injectable()
export class QuotePdfService {
  private readonly log = new Logger(QuotePdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
    private readonly storage: StorageService,
  ) {}

  async capture(quoteId: string, force = false): Promise<QuotePdfResult | null> {
    const q = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!q?.odooSaleId) return null;
    if (q.pdfStorageKey && q.pdfSource === "odoo" && !force) {
      try {
        const stored = await this.storage.getBuffer(q.pdfStorageKey);
        if (isPdfBuffer(stored.buffer)) {
          return {
            buffer: stored.buffer,
            filename: presupuestoFilename(q.odooSaleName, q.number),
            source: "odoo",
            storageKey: q.pdfStorageKey,
          };
        }
      } catch {
        /* re-render */
      }
    }

    const cfg = await loadQuoteIssueConfig(this.prisma);
    const reportName = cfg.reportName || "sale.report_saleorder_copy_1_copy_4";
    const raw = await this.renderPdf(reportName, q.odooSaleId);
    const buffer = decodeOdooPdf(raw);
    if (!isPdfBuffer(buffer)) throw new Error("Odoo no devolvió un PDF (%PDF).");
    const check = pdfLooksLikePeruV2(buffer, q.odooSaleName);
    if (!check.ok) {
      this.log.warn(`PDF ${q.number} sin marcas visibles (${check.missing.join(", ")}); se guarda igual (puede ir comprimido).`);
    }
    const key = quotePdfStorageKey(q.id, q.odooSaleName);
    await this.storage.put(key, buffer, "application/pdf");
    await this.prisma.quote.update({
      where: { id: q.id },
      data: { pdfStorageKey: key, pdfSource: "odoo", pdfRenderedAt: new Date() },
    });
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: q.id,
        type: "odoo_pdf",
        detail: `PDF Perú v2 ${q.odooSaleName} (${buffer.length} bytes).`,
      },
    });
    return {
      buffer,
      filename: presupuestoFilename(q.odooSaleName, q.number),
      source: "odoo",
      storageKey: key,
    };
  }

  async captureCronograma(quoteId: string, force = false): Promise<QuotePdfResult | null> {
    const q = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!q?.odooSaleId) return null;
    if (q.cronogramaStorageKey && !force) {
      try {
        const stored = await this.storage.getBuffer(q.cronogramaStorageKey);
        if (isPdfBuffer(stored.buffer)) {
          return {
            buffer: stored.buffer,
            filename: cronogramaFilename(q.odooSaleName, q.number),
            source: "odoo",
            storageKey: q.cronogramaStorageKey,
          };
        }
      } catch {
        /* re-render */
      }
    }
    const cfg = await loadQuoteIssueConfig(this.prisma);
    const reportName = cfg.rentReportName || "zgroup_subscription_report.report_proyeccion_template";
    const raw = await this.renderPdf(reportName, q.odooSaleId);
    const buffer = decodeOdooPdf(raw);
    if (!isPdfBuffer(buffer)) throw new Error("Odoo no devolvió el cronograma PDF.");
    const key = cronogramaStorageKey(q.id, q.odooSaleName);
    await this.storage.put(key, buffer, "application/pdf");
    await this.prisma.quote.update({
      where: { id: q.id },
      data: { cronogramaStorageKey: key, cronogramaRenderedAt: new Date() },
    });
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: q.id,
        type: "odoo_cronograma",
        detail: `Cronograma ${q.odooSaleName} (${buffer.length} bytes).`,
      },
    });
    return {
      buffer,
      filename: cronogramaFilename(q.odooSaleName, q.number),
      source: "odoo",
      storageKey: key,
    };
  }

  async postToSale(quoteId: string): Promise<void> {
    const q = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true },
    });
    if (!q?.odooSaleId || !q.pdfStorageKey) return;
    const { buffer } = await this.storage.getBuffer(q.pdfStorageKey);
    const filename = presupuestoFilename(q.odooSaleName, q.number);
    const attachmentId = Number(
      await this.odoo.create(
        "ir.attachment",
        {
          name: filename,
          res_model: "sale.order",
          res_id: q.odooSaleId,
          type: "binary",
          mimetype: "application/pdf",
          datas: buffer.toString("base64"),
        },
        SYNC,
      ),
    );
    if (!attachmentId) throw new Error("Odoo no guardó el adjunto PDF.");
    const partnerId = q.odooPartnerId || q.customer.odooPartnerId || undefined;
    await this.odoo.callKw("sale.order", "message_post", [[q.odooSaleId]], {
      body: quoteMailBody(q.odooSaleName || q.number, q.number),
      subject: `Cotización ${q.odooSaleName || q.number}`,
      message_type: "comment",
      attachment_ids: [attachmentId],
      ...(partnerId ? { partner_ids: [partnerId] } : {}),
      context: { ...ZDRY_SYNC_CONTEXT },
    });
  }

  private async renderPdf(reportName: string, saleId: number): Promise<unknown> {
    const reports = await this.odoo.searchRead(
      "ir.actions.report",
      [["report_name", "=", reportName]],
      ["id", "report_name"],
      { limit: 1 },
    );
    const reportId = Number(reports[0]?.id);
    if (reportId) {
      try {
        return await this.odoo.callKw("ir.actions.report", "render_qweb_pdf", [[reportId], [saleId]]);
      } catch (e) {
        this.log.warn(`render_qweb_pdf id=${reportId}: ${(e as Error).message}`);
      }
    }
    return this.odoo.callKw("ir.actions.report", "_render_qweb_pdf", [reportName, [saleId]]);
  }
}
