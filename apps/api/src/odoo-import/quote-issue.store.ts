import { PrismaService } from "../prisma/prisma.service";
import {
  ODOO_QUOTE_ISSUE_KEY,
  applyQuoteIssueHits,
  normalizeQuoteIssueConfig,
  quoteIssueChecks,
  quoteIssueReady,
  type OdooQuoteIssueConfig,
  type QuoteIssueHits,
} from "../domain/odoo-quote-issue";

export async function loadQuoteIssueConfig(prisma: PrismaService): Promise<OdooQuoteIssueConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: ODOO_QUOTE_ISSUE_KEY } });
  return normalizeQuoteIssueConfig(row?.value);
}

export async function saveQuoteIssueConfig(prisma: PrismaService, raw: unknown): Promise<OdooQuoteIssueConfig> {
  const value = normalizeQuoteIssueConfig(raw);
  await prisma.appSetting.upsert({
    where: { key: ODOO_QUOTE_ISSUE_KEY },
    update: { value: value as object },
    create: { key: ODOO_QUOTE_ISSUE_KEY, value: value as object },
  });
  return value;
}

export function presentQuoteIssue(cfg: OdooQuoteIssueConfig, extra: { resolvedAt?: string | null } = {}) {
  const ready = quoteIssueReady(cfg);
  return {
    config: cfg,
    ready: ready.ok,
    missing: ready.missing,
    checks: quoteIssueChecks(cfg),
    resolvedAt: extra.resolvedAt || null,
  };
}

export function mergeHits(cfg: OdooQuoteIssueConfig, hits: QuoteIssueHits) {
  return applyQuoteIssueHits(cfg, hits);
}
