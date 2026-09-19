import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { IncomingOdooEvent } from "../domain/odoo-event";
import { OdooEventsService } from "./odoo-events.service";

@Controller()
export class OdooEventsController {
  constructor(private readonly svc: OdooEventsService) {}

  @Public()
  @Post("internal/odoo-events")
  async webhook(
    @Body() body: { events?: IncomingOdooEvent[] } | IncomingOdooEvent[],
    @Headers("x-zdry-webhook-secret") secret?: string,
  ) {
    await this.svc.assertSecret(secret);
    const events = Array.isArray(body) ? body : body?.events || [];
    return this.svc.ingest(events);
  }

  @Get("odoo-import/events")
  @Roles("superadmin", "admin")
  inbox() {
    return this.svc.listInbox();
  }

  @Get("odoo-import/conflicts")
  @Roles("superadmin", "admin")
  conflicts() {
    return this.svc.listConflicts();
  }

  @Post("odoo-import/events/poll")
  @Roles("superadmin", "admin")
  poll() {
    return this.svc.pollPending();
  }
}
