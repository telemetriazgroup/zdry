import { BadRequestException, HttpException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ACQUISITION_REFS_KEY, computeListPrices, normalizeAcquisitionRefs } from "../domain/pricing";
import { EXIT_VERDICT_LABEL, exitOriginLabel, judgeExitDeal, saleMargin, type ExitVerdict } from "../domain/exit-economics";
import { vendorWeek, withinLastDays, type DealKind } from "../domain/sale-realized";
import { loadOverlayConcepts, loadSafetyMarginRules, overlayUnitFrom } from "../odoo-import/acquisition-overlay.store";
import { presentDryReferential } from "../odoo-import/dry-referential.store";
import { OdooImportService } from "../odoo-import/odoo-import.service";

const OPTIMAL = new Set<ExitVerdict>(["en_rango", "encima", "igual_inventario", "sobre_inventario"]);
const BELOW = new Set<ExitVerdict>(["debajo", "bajo_inventario"]);

type Snap = {
  isoNormalized: string;
  kind: string;
  name: string;
  version: number;
  summary: string;
  data: unknown;
  createdAt: Date;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  const out = String(value ?? "").trim();
  return out && out !== "null" ? out : null;
}

function positive(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function stamp(raw: string | null) {
  if (!raw) return 0;
  const t = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
  return Number.isFinite(t) ? t : 0;
}

function latestByName(rows: Snap[]) {
  const map = new Map<string, Snap>();
  for (const row of rows) {
    const prev = map.get(row.name);
    if (!prev || row.version > prev.version) map.set(row.name, row);
  }
  return [...map.values()];
}

@Injectable()
export class RealizedSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: OdooImportService,
  ) {}

  async list(now = new Date()) {
    const units = await this.prisma.container.findMany({
      where: { status: "Vendido", intakeOrigin: "odoo", demo: false, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 400,
    });
    const isos = units.map((row) => row.iso);
    const [rules, refsRow, dry, overlays, safety, snaps, lots, types, cats] = await Promise.all([
      this.prisma.pricingRule.findMany(),
      this.prisma.appSetting.findUnique({ where: { key: ACQUISITION_REFS_KEY } }),
      presentDryReferential(this.prisma),
      loadOverlayConcepts(this.prisma),
      loadSafetyMarginRules(this.prisma),
      isos.length
        ? this.prisma.odooDocSnapshot.findMany({
            where: { isoNormalized: { in: isos }, kind: { in: ["sale", "picking_out"] } },
            orderBy: [{ version: "desc" }, { createdAt: "desc" }],
          })
        : [],
      this.prisma.odooLotCandidate.findMany({
        where: { odooLotId: { in: [...new Set(units.map((row) => row.odooLotId).filter((id): id is number => !!id))] } },
        select: { odooLotId: true, productCode: true },
      }),
      this.prisma.containerType.findMany({ select: { code: true, label: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true } }),
    ]);
    const pricing = rules.map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      target: rule.target,
      marginPct: Number(rule.marginPct),
      maxDiscountPct: Number(rule.maxDiscountPct),
    }));
    const refs = normalizeAcquisitionRefs(refsRow?.value);
    const sku = new Map(lots.map((lot) => [lot.odooLotId, lot.productCode || ""]));
    const typeLabel = new Map(types.map((row) => [row.code, row.label]));
    const catLabel = new Map(cats.map((row) => [row.code, row.label]));
    const byIso = new Map<string, Snap[]>();
    for (const snap of snaps) {
      const list = byIso.get(snap.isoNormalized) || [];
      list.push(snap);
      byIso.set(snap.isoNormalized, list);
    }

    let openExits = 0;
    const events: Array<{ vendor: string | null; kind: DealKind | null; date: string | null; result: number | null }> = [];
    const rows = units.map((unit) => {
      const productCode = sku.get(unit.odooLotId ?? -1) || unit.odooSourceProductCode || "";
      const priced = computeListPrices(overlayUnitFrom({ ...unit, productCode }, dry), pricing, refs, overlays, safety);
      const docs = byIso.get(unit.iso) || [];
      const sales = latestByName(docs.filter((doc) => doc.kind === "sale"));
      const outs = latestByName(docs.filter((doc) => doc.kind === "picking_out"));
      const history = sales
        .map((sale) => {
          const data = record(sale.data);
          const pickingName = text(data.pickingName);
          const out =
            outs.find((row) => row.name === pickingName) ||
            outs.find((row) => text(record(row.data).origin) === sale.name) ||
            null;
          const outData = record(out?.data);
          const saleDate = text(data.date);
          const outDate = text(outData.date);
          const date = outDate || saleDate;
          const soldNet = positive(data.unitNet);
          const storedKind = text(data.dealKind);
          const dealKind: DealKind | null =
            storedKind === "alquiler" || storedKind === "transformacion" ? storedKind : soldNet != null ? "venta" : null;
          const judged = judgeExitDeal({
            priceSource: unit.priceSource,
            soldNet,
            kind: dealKind,
            ruleMin: priced.priceMin,
            ruleList: priced.priceList,
            inventoryList: unit.priceList != null ? Number(unit.priceList) : null,
          });
          const verdict: ExitVerdict = judged.verdict;
          const result = saleMargin(soldNet, priced.securedBase, dealKind);
          return {
            saleName: sale.name,
            dealKind,
            vendorName: text(data.vendorName),
            rentEnd: text(data.rentEnd),
            state: text(data.state),
            customer: text(data.partner),
            saleDate,
            outName: out?.name || pickingName,
            outDate,
            date,
            unitPrice: positive(data.unitPrice),
            discount: data.discount != null && data.discount !== "" ? Number(data.discount) : null,
            soldNet,
            result,
            verdict,
            verdictLabel:
              dealKind === "alquiler"
                ? "Alquiler: el equipo vuelve al almacén al terminar. No se resta el costo."
                : dealKind === "transformacion"
                  ? "Transformación: el dry fue el insumo del módulo. No se toma el precio de esa venta."
                  : soldNet == null && sale.name
                    ? "Falta el precio de la línea en Odoo"
                    : EXIT_VERDICT_LABEL[verdict],
            optimal: OPTIMAL.has(verdict),
            invoiceName: text(data.invoiceName),
            invoicePayment: text(data.invoicePayment),
            invoicePending: !text(data.invoiceName),
            invoiceDate: text(data.invoiceDate),
            referenceMin: judged.referenceMin,
            referenceList: judged.referenceList,
            comparedTo: judged.comparedTo,
          };
        })
        .sort((a, b) => stamp(b.date) - stamp(a.date) || b.saleName.localeCompare(a.saleName));

      for (const item of history) {
        events.push({ vendor: item.vendorName, kind: item.dealKind, date: item.date, result: item.result });
      }
      if (!history.length && outs.some((out) => withinLastDays(text(record(out.data).date), now, 7))) openExits += 1;

      const current = history[0] || null;
      return {
        iso: unit.iso,
        type: unit.type,
        typeLabel: typeLabel.get(unit.type) || unit.type,
        cat: unit.cat,
        catLabel: catLabel.get(unit.cat) || unit.cat,
        origin: exitOriginLabel(unit),
        warehouse: unit.odooWarehouse || "",
        rawBase: priced.rawBase,
        overlayTotal: priced.overlayTotal,
        overlayLines: priced.overlayLines.map((line) => ({ key: line.key, label: line.label, amount: line.amount })),
        safetyAdd: priced.safetyAdd,
        costBase: priced.securedBase,
        priceSource: unit.priceSource || "rule",
        saleName: current?.saleName || null,
        dealKind: current?.dealKind || null,
        vendorName: current?.vendorName || null,
        rentEnd: current?.rentEnd || null,
        customer: current?.customer || null,
        date: current?.date || null,
        saleDate: current?.saleDate || null,
        outName: current?.outName || outs[0]?.name || null,
        unitPrice: current?.unitPrice ?? null,
        discount: current?.discount ?? null,
        soldNet: current?.soldNet ?? null,
        result: current?.result ?? null,
        verdict: current?.verdict || "sin_cotizacion",
        verdictLabel: current?.verdictLabel || (outs.length ? "Salida detectada, falta el pedido" : "Salida sin pedido"),
        optimal: current?.optimal || false,
        invoiceName: current?.invoiceName || null,
        invoicePayment: current?.invoicePayment || null,
        invoicePending: current ? current.invoicePending : true,
        referenceMin: current?.referenceMin ?? null,
        referenceList: current?.referenceList ?? null,
        comparedTo: current?.comparedTo || "ninguno",
        history,
      };
    });

    rows.sort((a, b) => stamp(b.date) - stamp(a.date) || a.iso.localeCompare(b.iso));
    const salesOnly = rows.filter((row) => row.dealKind === "venta" && row.result != null);
    const vendors = vendorWeek(events, now);
    const last7Sales = events.filter((event) => event.kind === "venta" && withinLastDays(event.date, now, 7)).length;
    const last7Rents = events.filter((event) => event.kind === "alquiler" && withinLastDays(event.date, now, 7)).length;
    return {
      summary: {
        units: rows.length,
        last7: last7Sales,
        last7Sales,
        last7Rents,
        openExits,
        withPrice: rows.filter((row) => row.dealKind === "venta" && row.soldNet != null).length,
        missingPrice: rows.filter((row) => row.dealKind !== "alquiler" && row.dealKind !== "transformacion" && row.soldNet == null).length,
        rents: rows.filter((row) => row.dealKind === "alquiler").length,
        optimal: rows.filter((row) => row.optimal).length,
        below: rows.filter((row) => BELOW.has(row.verdict)).length,
        gain: salesOnly.filter((row) => (row.result || 0) > 0).reduce((sum, row) => sum + (row.result || 0), 0),
        loss: salesOnly.filter((row) => (row.result || 0) < 0).reduce((sum, row) => sum + (row.result || 0), 0),
        vendors,
      },
      rows,
    };
  }

  async refresh() {
    try {
      const pulled = await this.imports.refreshDepartedSaleFiles();
      const list = await this.list();
      return { ...pulled, missingPrice: list.summary.missingPrice, units: list.summary.units };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException("Odoo no respondió. Se mantienen los expedientes ya guardados.");
    }
  }
}
