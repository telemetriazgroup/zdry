import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OdooClient } from "../odoo/odoo.client";
import {
  pickNamed,
  type NamedOdooRow,
  type QuoteIssueHits,
} from "../domain/odoo-quote-issue";
import { loadQuoteIssueConfig, mergeHits, presentQuoteIssue, saveQuoteIssueConfig } from "./quote-issue.store";

@Injectable()
export class QuoteIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odoo: OdooClient,
  ) {}

  async get() {
    const cfg = await loadQuoteIssueConfig(this.prisma);
    return presentQuoteIssue(cfg);
  }

  async put(body: unknown) {
    const cfg = await saveQuoteIssueConfig(this.prisma, body);
    return presentQuoteIssue(cfg);
  }

  async resolve() {
    const cfg = await loadQuoteIssueConfig(this.prisma);
    const errors: string[] = [];
    const hits: QuoteIssueHits = {};

    hits.report = await this.first(
      "ir.actions.report",
      [["report_name", "=", cfg.reportName]],
      ["id", "name", "report_name"],
      errors,
      "reporte PDF",
    );
    hits.tax = pickNamed(
      await this.search("account.tax", [["type_tax_use", "=", "sale"], ["amount", "=", cfg.taxAmount]], ["id", "name", "amount"], errors, "impuesto 18 %"),
      [cfg.taxName, "igv"],
    );
    hits.pricelist = pickNamed(
      await this.search("product.pricelist", [["name", "ilike", cfg.pricelistName.split(" ").slice(-1)[0] || "USD"]], ["id", "name"], errors, "lista de precios"),
      [cfg.pricelistName, "usd"],
    );
    hits.warehouse = pickNamed(
      await this.search("stock.warehouse", [["name", "ilike", "Callao"]], ["id", "name"], errors, "almacén Callao"),
      [cfg.warehouseName, "callao"],
    );
    hits.fiscalPosition = pickNamed(
      await this.search("account.fiscal.position", [["name", "ilike", "LOCAL"]], ["id", "name"], errors, "posición fiscal"),
      [cfg.fiscalPositionName, "peru", "local"],
    );
    hits.paymentTerm = pickNamed(
      await this.search("account.payment.term", [["name", "ilike", "Immediate"]], ["id", "name"], errors, "plazo de pago"),
      [cfg.paymentTermName, "immediate"],
    );
    hits.company = pickNamed(
      await this.search("res.company", [["vat", "ilike", cfg.companyVat.slice(-8)]], ["id", "name", "vat"], errors, "compañía"),
      [cfg.companyVat, "zgroup"],
    );
    hits.identificationType = pickNamed(
      await this.search("l10n_latam.identification.type", [["name", "ilike", "RUC"]], ["id", "name"], errors, "tipo RUC", true),
      [cfg.identificationTypeName, "ruc"],
    );

    const products: NonNullable<QuoteIssueHits["products"]> = [];
    for (const p of cfg.products) {
      if (p.key === "flete" && !p.defaultCode) {
        const byFlete = await this.search(
          "product.product",
          [["sale_ok", "=", true], ["name", "ilike", "flete"]],
          ["id", "name", "default_code", "display_name"],
          errors,
          "producto flete",
          true,
        );
        const rows = byFlete.length
          ? byFlete
          : await this.search(
              "product.product",
              [["sale_ok", "=", true], ["name", "ilike", "transporte"]],
              ["id", "name", "default_code", "display_name"],
              errors,
              "producto transporte",
              true,
            );
        products.push({ key: p.key, row: pickNamed(rows, ["flete", "transporte"]) });
        continue;
      }
      if (!p.defaultCode) {
        products.push({ key: p.key, row: null });
        continue;
      }
      const rows = await this.search(
        "product.product",
        [["default_code", "=", p.defaultCode]],
        ["id", "name", "default_code", "display_name"],
        errors,
        `producto ${p.defaultCode}`,
      );
      products.push({ key: p.key, row: rows[0] || null });
    }
    hits.products = products;

    const next = mergeHits(cfg, hits);
    await saveQuoteIssueConfig(this.prisma, next);
    return { ...presentQuoteIssue(next, { resolvedAt: new Date().toISOString() }), errors };
  }

  private async search(
    model: string,
    domain: unknown[],
    fields: string[],
    errors: string[],
    label: string,
    optional = false,
  ): Promise<NamedOdooRow[]> {
    try {
      const rows = await this.odoo.searchRead(model, domain, fields, { limit: 20 });
      return rows as NamedOdooRow[];
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (!optional) errors.push(`${label}: ${msg}`);
      return [];
    }
  }

  private async first(
    model: string,
    domain: unknown[],
    fields: string[],
    errors: string[],
    label: string,
  ): Promise<NamedOdooRow | null> {
    const rows = await this.search(model, domain, fields, errors, label);
    return rows[0] || null;
  }
}
