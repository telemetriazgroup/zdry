import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser, canSeeRealCosts } from "../auth/auth.types";
import { limaDayRange } from "../odoo/odoo-lot-photos";
import { addCostBucket, countByDay, limaLastDays, rankCostBuckets } from "../domain/dashboard";
import { inspectOdooIso } from "../domain/odoo-lot-map";
import { labelOdooEvent } from "../domain/odoo-event";
import { pendingValuationWhere } from "../domain/odoo-reconcile";
import { computeListPrices, DEFAULT_PRICING_RULES, normalizeAcquisitionRefs, ACQUISITION_REFS_KEY } from "../domain/pricing";
import { presentDryReferential } from "../odoo-import/dry-referential.store";
import { loadOverlayConcepts, overlayUnitFrom } from "../odoo-import/acquisition-overlay.store";
const STOCK_STATUS = ["Disponible", "Reservado"];
const DAYS = 14;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async present(user: AuthUser) {
    const showCost = canSeeRealCosts(user.role);
    const live = await this.prisma.liveContainers();
    const since = limaDayRange(limaLastDays(DAYS)[0]).start;
    const week = limaDayRange(limaLastDays(7)[0]).start;

    const [units, ingresos, visits, confirms, logins, published, activeUsers, quotesWeek, catalogCounts, loginsWeek, pendingValueRows, pendingValueCount, odooEvents, assimilated] = await Promise.all([
      this.prisma.container.findMany({
        where: {
          ...live,
          status: { in: STOCK_STATUS },
          OR: [{ physicallyReceived: true }, { lado: { not: null } }],
        },
        select: {
          iso: true,
          type: true,
          cat: true,
          manufacturer: true,
          fobCif: true,
          costSource: true,
          odooWarehouse: true,
          odooVendorName: true,
          overlaySkipKeys: true,
          overlayExtras: true,
          mediaStatus: true,
        },
      }),
      this.prisma.container.findMany({
        where: { ...live, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.gateVisit.findMany({
        where: { archivedAt: null, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { action: "confirm", entity: "Container", createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { action: "login", createdAt: { gte: since } },
        select: { createdAt: true, userId: true, user: { select: { name: true, email: true, role: true } } },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
      this.prisma.container.findMany({
        where: { ...live, mediaStatus: "aprobado", mediaApprovedAt: { not: null } },
        select: { iso: true, type: true, cat: true, mediaApprovedAt: true, mediaApprovedBy: true },
        orderBy: { mediaApprovedAt: "desc" },
        take: 8,
      }),
      this.prisma.user.count({ where: { active: true, role: { not: "cliente" } } }),
      this.prisma.quote.count({ where: { createdAt: { gte: week } } }),
      this.prisma.container.groupBy({
        by: ["mediaStatus"],
        where: live,
        _count: { iso: true },
      }),
      this.prisma.auditLog.count({ where: { action: "login", createdAt: { gte: week } } }),
      this.prisma.container.findMany({
        where: { ...pendingValuationWhere(), ...live },
        select: {
          iso: true,
          type: true,
          cat: true,
          intakeType: true,
          intakeOrigin: true,
          invoicePending: true,
          createdAt: true,
          registeredByName: true,
          odooVendorName: true,
          depot: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.container.count({ where: { ...pendingValuationWhere(), ...live } }),
      this.prisma.odooBridgeEvent.findMany({
        where: { createdAt: { gte: since } },
        select: { iso: true, event: true, action: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 400,
      }),
      this.prisma.container.findMany({
        where: { ...live, intakeOrigin: "odoo" },
        select: { iso: true },
      }),
    ]);

    const [pricingRows, refsRow, dry, overlays] = showCost
      ? await Promise.all([
          this.prisma.pricingRule.findMany(),
          this.prisma.appSetting.findUnique({ where: { key: ACQUISITION_REFS_KEY } }),
          presentDryReferential(this.prisma),
          loadOverlayConcepts(this.prisma),
        ])
      : [[], null, null, []];
    const pricing = pricingRows.length
      ? pricingRows.map((r) => ({
          id: r.id,
          scope: r.scope,
          target: r.target,
          marginPct: Number(r.marginPct),
          maxDiscountPct: Number(r.maxDiscountPct),
        }))
      : DEFAULT_PRICING_RULES;
    const refs = normalizeAcquisitionRefs(refsRow?.value);

    const byType = new Map();
    const byVendor = new Map();
    let cost = 0;
    let extras = 0;
    for (const c of units) {
      if (!showCost) {
        addCostBucket(byType, c.type, 0, 0);
        addCostBucket(byVendor, c.odooVendorName || "Sin proveedor", 0, 0);
        continue;
      }
      const priced = computeListPrices(overlayUnitFrom(c, dry), pricing, refs, overlays);
      cost += priced.rawBase;
      extras += priced.overlayTotal;
      addCostBucket(byType, `${c.type}${c.cat ? ` · ${c.cat}` : ""}`, priced.rawBase, priced.overlayTotal);
      addCostBucket(byVendor, c.odooVendorName || "Sin proveedor", priced.rawBase, priced.overlayTotal);
    }

    const seen = new Set<string>();
    const lastUsers = [];
    for (const row of logins) {
      const id = row.userId || row.user?.email || "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      lastUsers.push({
        name: row.user?.name || "Usuario",
        email: row.user?.email || "",
        role: row.user?.role || "",
        at: row.createdAt,
      });
      if (lastUsers.length >= 8) break;
    }

    const approverIds = [...new Set(published.map((p) => p.mediaApprovedBy).filter((id): id is string => !!id))];
    const approvers = approverIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
      : [];
    const approverName = new Map(approvers.map((u) => [u.id, u.name]));

    const media = Object.fromEntries(catalogCounts.map((r) => [r.mediaStatus, r._count.iso]));
    const publishedCount = media.aprobado || 0;
    const pendingCount = media.pendiente || 0;

    const assimilatedIsos = new Set<string>();
    for (const c of assimilated) {
      assimilatedIsos.add(c.iso);
      const n = inspectOdooIso(c.iso).isoNormalized;
      if (n) assimilatedIsos.add(n);
    }
    const assimilatedEvents = odooEvents.filter((e) => {
      if (!e.iso) return false;
      if (assimilatedIsos.has(e.iso)) return true;
      const n = inspectOdooIso(e.iso).isoNormalized;
      return !!n && assimilatedIsos.has(n);
    });
    const eventByType = new Map<string, number>();
    for (const e of assimilatedEvents) {
      const key = labelOdooEvent(e.event);
      eventByType.set(key, (eventByType.get(key) || 0) + 1);
    }

    return {
      showCost,
      generatedAt: new Date().toISOString(),
      pendingValue: {
        count: pendingValueCount,
        items: pendingValueRows.map((c) => ({
          iso: c.iso,
          type: c.type,
          cat: c.cat,
          depot: c.depot?.name || "—",
          origin: c.intakeOrigin,
          intakeType: c.intakeType,
          at: c.createdAt,
          by: c.registeredByName || "—",
        })),
      },
      odooChanges: {
        total: assimilatedEvents.length,
        week: assimilatedEvents.filter((e) => e.createdAt >= week).length,
        assimilatedUnits: assimilated.length,
        series: countByDay(assimilatedEvents.map((e) => e.createdAt), DAYS),
        byEvent: [...eventByType.entries()]
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
        last: assimilatedEvents.slice(0, 8).map((e) => ({
          iso: e.iso,
          event: e.event,
          label: labelOdooEvent(e.event),
          action: e.action,
          at: e.createdAt,
        })),
      },
      stock: {
        units: units.length,
        cost: showCost ? Math.round(cost * 100) / 100 : null,
        extras: showCost ? Math.round(extras * 100) / 100 : null,
        base: showCost ? Math.round((cost + extras) * 100) / 100 : null,
        byType: rankCostBuckets(byType),
        byVendor: rankCostBuckets(byVendor),
      },
      series: {
        ingresos: countByDay(ingresos.map((r) => r.createdAt), DAYS),
        visitas: countByDay(visits.map((r) => r.createdAt), DAYS),
        recepciones: countByDay(confirms.map((r) => r.createdAt), DAYS),
      },
      lastUsers,
      lastPublished: published.map((p) => ({
        iso: p.iso,
        type: p.type,
        cat: p.cat,
        at: p.mediaApprovedAt,
        by: p.mediaApprovedBy ? approverName.get(p.mediaApprovedBy) || "—" : "—",
      })),
      usage: {
        activeUsers,
        loginsWeek,
        visitsWeek: visits.filter((v) => v.createdAt >= week).length,
        ingresosWeek: ingresos.filter((v) => v.createdAt >= week).length,
        quotesWeek,
        published: publishedCount,
        pendingPublish: pendingCount,
        stockUnits: units.length,
        pendingValue: pendingValueCount,
        odooChangesWeek: assimilatedEvents.filter((e) => e.createdAt >= week).length,
      },
    };
  }
}
