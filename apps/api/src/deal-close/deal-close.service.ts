import { BadRequestException, Injectable } from "@nestjs/common";
import {
  type DealStatus,
  assertTransition,
  canAssignProduct,
  holdClockPaused,
  IllegalDealTransitionError,
  shouldEnqueueOdoo,
} from "./deal-close.types";
import { OdooClient } from "../odoo/odoo.client";

@Injectable()
export class DealCloseService {
  constructor(private readonly odoo: OdooClient) {}

  transition(from: DealStatus, to: DealStatus) {
    try {
      assertTransition(from, to);
    } catch (err) {
      if (err instanceof IllegalDealTransitionError) {
        throw new BadRequestException({
          error: "illegal_deal_transition",
          from: err.from,
          to: err.to,
          message: err.message,
        });
      }
      throw err;
    }

    const odooQueued = shouldEnqueueOdoo(from, to);
    if (odooQueued) {
      this.odoo.enqueueSaleClose({ from, to, at: new Date().toISOString() });
    }

    return {
      from,
      to,
      holdClockPaused: holdClockPaused(to),
      canAssignProduct: canAssignProduct(to) || to === "asignacion_confirmada",
      odooQueued,
    };
  }
}
