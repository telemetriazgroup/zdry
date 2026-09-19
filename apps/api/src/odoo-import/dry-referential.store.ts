import { PrismaService } from "../prisma/prisma.service";
import {
  DRY_REFERENTIAL_KEY,
  averageOcUnitPrices,
  effectiveDryReferential,
  normalizeDryReferential,
  pricesFromOriginRows,
} from "../domain/dry-referential";

export async function presentDryReferential(prisma: PrismaService) {
  const [row, oc] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: DRY_REFERENTIAL_KEY } }),
    prisma.odooLotCandidate.findMany({
      where: {
        odooUnitPrice: { not: null },
        OR: [{ costSource: "oc" }, { odooIntakeKind: "purchase" }],
      },
      select: { odooUnitPrice: true, costSource: true, odooIntakeKind: true },
    }),
  ]);
  const setting = normalizeDryReferential(row?.value);
  const computed = averageOcUnitPrices(
    pricesFromOriginRows(
      oc.map((r) => ({
        costSource: r.costSource,
        odooIntakeKind: r.odooIntakeKind,
        odooUnitPrice: r.odooUnitPrice != null ? Number(r.odooUnitPrice) : null,
      })),
    ),
  );
  return {
    ...setting,
    computed,
    effective: effectiveDryReferential(setting, computed),
    sample: oc.length,
  };
}
