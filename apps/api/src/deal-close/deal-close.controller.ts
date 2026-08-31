import { Body, Controller, Get, Post } from "@nestjs/common";
import { DealCloseService } from "./deal-close.service";
import {
  DEAL_STATUSES,
  HOLD_PAUSING_STATUSES,
  type DealStatus,
} from "./deal-close.types";

@Controller("deal-close")
export class DealCloseController {
  constructor(private readonly deals: DealCloseService) {}

  @Get("machine")
  machine() {
    return {
      statuses: DEAL_STATUSES,
      holdPausesOn: HOLD_PAUSING_STATUSES,
      notes: {
        sunat: false,
        odoo: "sync after asignacion_confirmada",
        payment: "cliente sube comprobante; comercial valida (interbancario puede demorar)",
        discount: "hablar con comercial ANTES del pago (en_negociacion)",
      },
    };
  }

  @Post("preview-transition")
  preview(@Body() body: { from: DealStatus; to: DealStatus }) {
    return this.deals.transition(body.from, body.to);
  }
}
