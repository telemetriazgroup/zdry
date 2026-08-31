import { Injectable, Logger } from "@nestjs/common";

export type OdooSaleClosePayload = {
  from: string;
  to: string;
  at: string;
  quoteId?: string;
};

@Injectable()
export class OdooClient {
  private readonly log = new Logger(OdooClient.name);

  enqueueSaleClose(payload: OdooSaleClosePayload) {
    if (process.env.ODOO_ENABLED === "true") {
      this.log.log(`Odoo real aún no cableado; payload: ${JSON.stringify(payload)}`);
      return { queued: true, mode: "odoo" as const };
    }
    this.log.log(`Odoo noop — cierre encolado: ${JSON.stringify(payload)}`);
    return { queued: true, mode: "noop" as const };
  }
}
