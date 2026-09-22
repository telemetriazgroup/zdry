import { PrismaService } from "../prisma/prisma.service";
import { inferCatFromProduct, inferTypeFromProduct } from "../domain/odoo-lot-map";
import {
  DRY_REFERENTIAL_KEY,
  averageOcUnitPrices,
  buildReferentialBuckets,
  effectiveDryReferential,
  lookupDryReferential,
  normalizeDryReferential,
  ocRowsForAverage,
  type ReferentialBucket,
  type ReferentialHit,
} from "../domain/dry-referential";

export type PresentDryReferential = {
  amount: number | null;
  windowMonths: number;
  computed: number | null;
  effective: number | null;
  sample: number;
  buckets: ReferentialBucket[];
};

export async function presentDryReferential(prisma: PrismaService): Promise<PresentDryReferential> {
  const [row, oc] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: DRY_REFERENTIAL_KEY } }),
    prisma.odooLotCandidate.findMany({
      where: {
        odooUnitPrice: { not: null },
        OR: [{ costSource: "oc" }, { odooIntakeKind: "purchase" }],
      },
      select: {
        odooUnitPrice: true,
        costSource: true,
        odooIntakeKind: true,
        zdryType: true,
        zdryCat: true,
        odooWarehouse: true,
        productCode: true,
        productName: true,
        lastSyncedAt: true,
      },
    }),
  ]);
  const setting = normalizeDryReferential(row?.value);
  const mapped = oc.map((r) => ({
    type: r.zdryType || inferTypeFromProduct(r.productName, r.productCode, ""),
    cat: r.zdryCat || inferCatFromProduct(r.productName, ""),
    warehouse: r.odooWarehouse,
    productCode: r.productCode,
    odooUnitPrice: r.odooUnitPrice != null ? Number(r.odooUnitPrice) : null,
    costSource: r.costSource,
    odooIntakeKind: r.odooIntakeKind,
    at: r.lastSyncedAt,
  }));
  const windowed = ocRowsForAverage(mapped, setting.windowMonths);
  const computed = averageOcUnitPrices(windowed.map((r) => r.odooUnitPrice));
  const buckets = buildReferentialBuckets(mapped, setting.windowMonths);
  return {
    ...setting,
    computed,
    effective: effectiveDryReferential(setting, computed),
    sample: windowed.length,
    buckets,
  };
}

export function referentialAmountFor(
  dry: PresentDryReferential | null | undefined,
  unit: { type?: string | null; cat?: string | null; odooWarehouse?: string | null; productCode?: string | null },
): number | null {
  if (!dry) return null;
  const hit = lookupDryReferential(unit, dry.buckets || [], dry.effective);
  return hit?.amount ?? dry.effective ?? null;
}

export function referentialHitFor(
  dry: PresentDryReferential | null | undefined,
  unit: { type?: string | null; cat?: string | null; odooWarehouse?: string | null; productCode?: string | null },
): ReferentialHit | null {
  if (!dry) return null;
  return lookupDryReferential(unit, dry.buckets || [], dry.effective);
}
