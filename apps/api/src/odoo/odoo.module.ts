import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { OdooClient } from "./odoo.client";
import { OdooLinkService } from "./odoo-link.service";
import { OdooLinkController } from "./odoo-link.controller";
import { OdooActorInterceptor } from "./odoo-actor.interceptor";

@Global()
@Module({
  controllers: [OdooLinkController],
  providers: [OdooClient, OdooLinkService, { provide: APP_INTERCEPTOR, useClass: OdooActorInterceptor }],
  exports: [OdooClient, OdooLinkService],
})
export class OdooModule {}
