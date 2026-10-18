import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ACQUISITION_REFS_KEY, computeListPrices, normalizeAcquisitionRefs } from "../domain/pricing";
import { EXIT_VERDICT_LABEL, exitOriginLabel, judgeExitDeal, saleMargin } from "../domain/exit-economics";
import {
  loadOverlayConcepts,
  loadSafetyMarginRules,
  overlayUnitFrom,
} from "../odoo-import/acquisition-overlay.store";
import { presentDryReferential } from "../odoo-import/dry-referential.store";

type QuoteHit = {
  number: string;
  kind: string;
  dealStatus: string;
  updatedAt: Date;
  vendorName: string;
  customerName: string;
  priceNet: number;
  odooSaleName: string | null;
  odooState: string | null;
  odooInvoiceName: string | null;
  odooInvoiceStatus: string | null;
  odooAmountUntaxed: number | null;
  rentPriceNet: number | null;
  rentMonths: number | null;
};

@Injectable()
export class ExitEconomicsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const units = await this.prisma.container.findMany({
      where: { status: "Vendido", intakeOrigin: "odoo", demo: false, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 400,
    });
    const isos = units.map((row) => row.iso);
    const [rules, refsRow, dry, overlays, safety, lines, sales] = await Promise.all([
      this.prisma.pricingRule.findMany(),
      this.prisma.appSetting.findUnique({ where: { key: ACQUISITION_REFS_KEY } }),
      presentDryReferential(this.prisma),
      loadOverlayConcepts(this.prisma),
      loadSafetyMarginRules(this.prisma),
      isos.length
        ? this.prisma.quoteLine.findMany({
            where: { iso: { in: isos } },
            include: {
              quote: {
                include: {
                  vendor: { select: { name: true } },
                  customer: { select: { companyName: true } },
                },
              },
            },
          })
        : [],
      isos.length
        ? this.prisma.odooDocSnapshot.findMany({
            where: { isoNormalized: { in: isos }, kind: "sale" },
            orderBy: [{ version: "desc" }, { createdAt: "desc" }],
          })
        : [],
    ]);
    const pricing = rules.map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      target: rule.target,
      marginPct: Number(rule.marginPct),
      maxDiscountPct: Number(rule.maxDiscountPct),
    }));
    const refs = normalizeAcquisitionRefs(refsRow?.value);
    const lotIds = [...new Set(units.map((row) => row.odooLotId).filter((id): id is number => !!id))];
    const lots = lotIds.length
      ? await this.prisma.odooLotCandidate.findMany({
          where: { odooLotId: { in: lotIds } },
          select: { odooLotId: true, productCode: true },
        })
      : [];
    const sku = new Map(lots.map((lot) => [lot.odooLotId, lot.productCode || ""]));
    const byIso = new Map<string, QuoteHit>();
    for (const line of lines) {
      const quote = line.quote;
      if (!quote || quote.demo) continue;
      const hit: QuoteHit = {
        number: quote.number,
        kind: quote.kind === "alquiler" ? "alquiler" : "venta",
        dealStatus: quote.dealStatus,
        updatedAt: quote.updatedAt,
        vendorName: quote.vendor?.name || "—",
        customerName: quote.customer?.companyName || "—",
        priceNet: Number(line.priceNet) || 0,
        odooSaleName: quote.odooSaleName,
        odooState: quote.odooState,
        odooInvoiceName: quote.odooInvoiceName,
        odooInvoiceStatus: quote.odooInvoiceStatus,
        odooAmountUntaxed: quote.odooAmountUntaxed != null ? Number(quote.odooAmountUntaxed) : null,
        rentPriceNet: quote.rentPriceNet != null ? Number(quote.rentPriceNet) : null,
        rentMonths: quote.rentMonths,
      };
      const prev = byIso.get(line.iso);
      if (!prev || hit.updatedAt > prev.updatedAt) byIso.set(line.iso, hit);
    }
    const saleByIso = new Map<string, { name: string; summary: string }>();
    for (const snap of sales) {
      if (!saleByIso.has(snap.isoNormalized)) saleByIso.set(snap.isoNormalized, { name: snap.name, summary: snap.summary });
    }

    const rows = units.map((unit) => {
      const productCode = sku.get(unit.odooLotId ?? -1) || unit.odooSourceProductCode || "";
      const priced = computeListPrices(
        overlayUnitFrom({ ...unit, productCode }, dry),
        pricing,
        refs,
        overlays,
        safety,
      );
      const quote = byIso.get(unit.iso) || null;
      const kind = quote ? (quote.kind === "alquiler" ? "alquiler" : "venta") : null;
      const soldNet = quote
        ? kind === "alquiler"
          ? Math.round((quote.rentPriceNet || quote.priceNet) * (quote.rentMonths || 1))
          : Math.round(quote.priceNet)
        : null;
      const judged = judgeExitDeal({
        priceSource: unit.priceSource,
        soldNet,
        kind,
        ruleMin: priced.priceMin,
        ruleList: priced.priceList,
        inventoryList: unit.priceList != null ? Number(unit.priceList) : null,
      });
      const result = saleMargin(soldNet, priced.securedBase, kind);
      const odooSale = saleByIso.get(unit.iso);
      return {
        iso: unit.iso,
        type: unit.type,
        cat: unit.cat,
        origin: exitOriginLabel(unit),
        warehouse: unit.odooWarehouse || "",
        vendorName: unit.odooVendorName || "",
        rawBase: priced.rawBase,
        overlayTotal: priced.overlayTotal,
        overlayLines: priced.overlayLines.map((line) => ({ label: line.label, amount: line.amount })),
        safetyAdd: priced.safetyAdd,
        costBase: priced.securedBase,
        ruleMin: priced.priceMin,
        ruleList: priced.priceList,
        priceSource: unit.priceSource || "rule",
        inventoryList: unit.priceList != null ? Number(unit.priceList) : null,
        quoteNumber: quote?.number || null,
        quoteKind: kind,
        dealStatus: quote?.dealStatus || null,
        responsible: quote?.vendorName || null,
        customer: quote?.customerName || null,
        soldNet,
        result,
        verdict: judged.verdict,
        verdictLabel: EXIT_VERDICT_LABEL[judged.verdict],
        comparedTo: judged.comparedTo,
        referenceMin: judged.referenceMin,
        referenceList: judged.referenceList,
        odooSaleName: quote?.odooSaleName || odooSale?.name || null,
        odooState: quote?.odooState || null,
        odooInvoiceName: quote?.odooInvoiceName || null,
        odooInvoiceStatus: quote?.odooInvoiceStatus || null,
        odooAmountUntaxed: quote?.odooAmountUntaxed ?? null,
        odooSaleSummary: odooSale?.summary || "",
      };
    });

    const salesRows = rows.filter((row) => row.quoteKind === "venta" && row.result != null);
    return {
      summary: {
        units: rows.length,
        withQuote: rows.filter((row) => row.quoteNumber).length,
        sales: rows.filter((row) => row.quoteKind === "venta").length,
        rents: rows.filter((row) => row.quoteKind === "alquiler").length,
        salesGain: salesRows.reduce((sum, row) => sum + (row.result || 0), 0),
        below: rows.filter((row) => row.verdict === "debajo" || row.verdict === "bajo_inventario").length,
        inside: rows.filter((row) => row.verdict === "en_rango" || row.verdict === "igual_inventario").length,
        above: rows.filter((row) => row.verdict === "encima" || row.verdict === "sobre_inventario").length,
        rentIncome: rows.filter((row) => row.quoteKind === "alquiler").reduce((sum, row) => sum + (row.result || 0), 0),
      },
      rows,
    };
  }
}
