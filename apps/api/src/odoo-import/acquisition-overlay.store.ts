import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ACQUISITION_OVERLAYS_KEY,
  normalizeOverlayConcepts,
  type OverlayConcept,
  type OverlayExtra,
} from "../domain/acquisition-overlay";
import { ACQUISITION_REFS_KEY, computeListPrices, DEFAULT_PRICING_RULES, normalizeAcquisitionRefs, type PricedUnit } from "../domain/pricing";
import { presentDryReferential, referentialAmountFor, type PresentDryReferential } from "./dry-referential.store";

export async function loadOverlayConcepts(prisma: PrismaService): Promise<OverlayConcept[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: ACQUISITION_OVERLAYS_KEY } });
  return normalizeOverlayConcepts(row?.value);
}

export async function saveOverlayConcepts(prisma: PrismaService, concepts: OverlayConcept[]): Promise<OverlayConcept[]> {
  const value = concepts as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: ACQUISITION_OVERLAYS_KEY },
    update: { value },
    create: { key: ACQUISITION_OVERLAYS_KEY, value },
  });
  return concepts;
}

function amountFromDry(
  dry: PresentDryReferential | number | null | undefined,
  unit: { type?: string | null; cat?: string | null; odooWarehouse?: string | null; productCode?: string | null },
): number | null {
  if (typeof dry === "number") return dry > 0 ? dry : null;
  return referentialAmountFor(dry, unit);
}

export function overlayUnitFrom(c: {
  iso: string;
  type: string;
  cat: string;
  manufacturer?: string | null;
  fobCif?: unknown;
  costSource?: string | null;
  odooWarehouse?: string | null;
  odooVendorName?: string | null;
  productCode?: string | null;
  overlaySkipKeys?: unknown;
  overlayExtras?: unknown;
}, dry?: PresentDryReferential | number | null): PricedUnit {
  return {
    iso: c.iso,
    type: c.type,
    cat: c.cat,
    manufacturer: c.manufacturer,
    fobCif: Number(c.fobCif) || 0,
    costSource: c.costSource,
    dryReferential: amountFromDry(dry, {
      type: c.type,
      cat: c.cat,
      odooWarehouse: c.odooWarehouse,
      productCode: c.productCode,
    }),
    odooWarehouse: c.odooWarehouse,
    odooVendorName: c.odooVendorName,
    overlaySkipKeys: Array.isArray(c.overlaySkipKeys) ? (c.overlaySkipKeys as string[]) : null,
    overlayExtras: Array.isArray(c.overlayExtras) ? (c.overlayExtras as OverlayExtra[]) : null,
  };
}

export async function refreshRulePrices(prisma: PrismaService, filter: { warehouse?: string; vendor?: string } = {}) {
  const [rules, refsRow, dry, overlays] = await Promise.all([
    prisma.pricingRule.findMany(),
    prisma.appSetting.findUnique({ where: { key: ACQUISITION_REFS_KEY } }),
    presentDryReferential(prisma),
    loadOverlayConcepts(prisma),
  ]);
  const pricing = rules.length
    ? rules.map((r) => ({
        id: r.id,
        scope: r.scope,
        target: r.target,
        marginPct: Number(r.marginPct),
        maxDiscountPct: Number(r.maxDiscountPct),
      }))
    : DEFAULT_PRICING_RULES;
  const refs = normalizeAcquisitionRefs(refsRow?.value);
  const where: Prisma.ContainerWhereInput = {
    priceSource: { not: "manual" },
    archivedAt: null,
  };
  if (filter.warehouse) where.odooWarehouse = filter.warehouse;
  if (filter.vendor) where.odooVendorName = filter.vendor;
  const rows = await prisma.container.findMany({ where, select: {
    iso: true, type: true, cat: true, manufacturer: true, fobCif: true, costSource: true,
    odooWarehouse: true, odooVendorName: true, overlaySkipKeys: true, overlayExtras: true,
    odooLotId: true, odooSourceProductCode: true,
  } });
  const lotIds = [...new Set(rows.map((r) => r.odooLotId).filter((id): id is number => Number.isFinite(id)))];
  const lots = lotIds.length
    ? await prisma.odooLotCandidate.findMany({
        where: { odooLotId: { in: lotIds } },
        select: { odooLotId: true, productCode: true },
      })
    : [];
  const skuByLot = new Map(lots.map((l) => [l.odooLotId, l.productCode]));
  let updated = 0;
  for (const c of rows) {
    const productCode = skuByLot.get(c.odooLotId ?? -1) || c.odooSourceProductCode || "";
    const computed = computeListPrices(overlayUnitFrom({ ...c, productCode }, dry), pricing, refs, overlays);
    await prisma.container.update({
      where: { iso: c.iso },
      data: { priceList: computed.priceList, priceMin: computed.priceMin, priceSource: "rule" },
    });
    updated += 1;
  }
  return { updated };
}
