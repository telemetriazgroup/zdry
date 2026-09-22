import { Injectable, Logger } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import { StorageService } from "../storage/storage.service";
import { loadQuoteIssueConfig } from "./quote-issue.store";
import { ZDRY_SYNC_CONTEXT } from "../domain/quote-issue-draft";
import { buildPeruV2Report } from "../domain/peru-v2-report";
import { renderPeruV2Pdf } from "../domain/peru-v2-pdf";
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
  source: "odoo" | "zdry" | "prototype";
  storageKey: string | null;
};

function loadZgroupLogo(): Buffer | null {
  const paths = [
    join(__dirname, "..", "assets", "zg_marca.png"),
    join(process.cwd(), "dist/assets/zg_marca.png"),
    join(process.cwd(), "src/assets/zg_marca.png"),
  ];
  for (const p of paths) {
    try {
      return readFileSync(p);
    } catch {
      /* next */
    }
  }
  return null;
}

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
    if (!q) return null;
    if (q.pdfStorageKey && q.pdfSource === "zdry" && !force) {
      try {
        const stored = await this.storage.getBuffer(q.pdfStorageKey);
        if (isPdfBuffer(stored.buffer) && pdfLooksLikePeruV2(stored.buffer, q.odooSaleName || q.number).ok) {
          return {
            buffer: stored.buffer,
            filename: presupuestoFilename(q.odooSaleName, q.number),
            source: "zdry",
            storageKey: q.pdfStorageKey,
          };
        }
      } catch {
        /* re-render */
      }
    }
    return this.renderLocal(quoteId);
  }

  private async captureFromOdoo(quoteId: string): Promise<QuotePdfResult> {
    const q = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!q?.odooSaleId) throw new Error("Sin SO Odoo.");

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

  async renderLocal(quoteId: string): Promise<QuotePdfResult | null> {
    const q = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, vendor: true, lines: true, extras: true },
    });
    if (!q) return null;
    const contact = await this.prisma.user.findFirst({
      where: { customerId: q.customerId },
      select: { name: true },
      orderBy: { createdAt: "asc" },
    });
    const cfg = await loadQuoteIssueConfig(this.prisma);
    const report = buildPeruV2Report({
      number: q.number,
      odooSaleName: q.odooSaleName,
      kind: q.kind,
      createdAt: q.createdAt,
      vendorName: q.vendor.name,
      contactName: contact?.name,
      dispatchNotes: q.dispatchNotes,
      customer: q.customer,
      lines: q.lines.map((l) => ({
        iso: l.iso,
        type: l.type,
        cat: l.cat,
        priceNet: Number(l.priceNet),
      })),
      extras: q.extras.map((e) => ({ label: e.label, amount: Number(e.amount) })),
      validityDays: cfg.defaults.validityDays,
      validityLabel: cfg.defaults.validityLabel,
      deliveryTime: cfg.defaults.deliveryTime,
      deliveryPlace: cfg.defaults.deliveryPlace,
      paymentTerm: cfg.paymentTermName,
      note: cfg.defaults.note,
    });
    const buffer = await renderPeruV2Pdf(report, loadZgroupLogo());
    const key = quotePdfStorageKey(q.id, q.odooSaleName || q.number);
    await this.storage.put(key, buffer, "application/pdf");
    await this.prisma.quote.update({
      where: { id: q.id },
      data: { pdfStorageKey: key, pdfSource: "zdry", pdfRenderedAt: new Date() },
    });
    await this.prisma.quoteEvent.create({
      data: {
        quoteId: q.id,
        type: "odoo_pdf",
        detail: `PDF Perú v2 (réplica ZDRY) ${report.saleName} (${buffer.length} bytes).`,
      },
    });
    return {
      buffer,
      filename: presupuestoFilename(q.odooSaleName, q.number),
      source: "zdry",
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
    try {
      return await this.odoo.callKw("ir.actions.report", "_render_qweb_pdf", [reportName, [saleId]]);
    } catch (e) {
      this.log.warn(`_render_qweb_pdf ${reportName}: ${(e as Error).message}`);
    }
    return this.renderPdfHttp(reportName, saleId);
  }

  private async renderPdfHttp(reportName: string, saleId: number): Promise<Buffer> {
    const cfg = await this.odoo.readConfig();
    const base = cfg.url.replace(/\/$/, "");
    const auth = await fetch(`${base}/web/session/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { db: cfg.db, login: cfg.user, password: cfg.apiKey },
        id: Date.now(),
      }),
    });
    if (!auth.ok) throw new Error(`Odoo sesión HTTP ${auth.status}`);
    const payload = (await auth.json()) as {
      result?: { session_id?: string; uid?: number | false; csrf_token?: string };
      error?: { message?: string; data?: { message?: string } };
    };
    if (payload.error) throw new Error(payload.error.data?.message || payload.error.message || "Odoo rechazó la sesión HTTP.");
    if (!payload.result?.uid) throw new Error("Odoo no autenticó la sesión para el PDF.");
    const cookies = (auth.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).filter(Boolean);
    const fromHeader = cookies.join("; ") || String(auth.headers.get("set-cookie") || "").split(";")[0];
    const cookieHeader = fromHeader || (payload.result.session_id ? `session_id=${payload.result.session_id}` : "");
    if (!cookieHeader) throw new Error("Odoo no devolvió cookie de sesión para el PDF.");
    const headers: Record<string, string> = { Cookie: cookieHeader };
    if (payload.result.csrf_token) headers["X-CSRF-Token"] = payload.result.csrf_token;
    const res = await fetch(`${base}/report/pdf/${reportName}/${saleId}`, { headers });
    if (!res.ok) {
      const hint = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
      throw new Error(`Odoo PDF HTTP ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isPdfBuffer(buf)) throw new Error("Odoo HTTP no devolvió un PDF (%PDF).");
    return buf;
  }
}
