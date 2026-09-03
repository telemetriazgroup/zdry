import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { envOdooConfig, normalizeOdooConfig, ODOO_CONFIG_KEY, type OdooConfig } from "../domain/odoo-config";

export type OdooSaleClosePayload = {
  from: string;
  to: string;
  at: string;
  quoteId?: string;
};

@Injectable()
export class OdooClient {
  private readonly log = new Logger(OdooClient.name);

  constructor(private readonly prisma: PrismaService) {}

  async readConfig(): Promise<OdooConfig> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: ODOO_CONFIG_KEY } });
    return normalizeOdooConfig(row?.value, envOdooConfig());
  }

  enqueueSaleClose(payload: OdooSaleClosePayload) {
    void this.readConfig().then((cfg) => {
      if (cfg.enabled && cfg.url) {
        this.log.log(`Odoo encolado hacia ${cfg.url} / ${cfg.db}: ${JSON.stringify(payload)}`);
        return;
      }
      this.log.log(`Odoo en espera — cierre: ${JSON.stringify(payload)}`);
    });
    return { queued: true, mode: "queued" as const };
  }
}
