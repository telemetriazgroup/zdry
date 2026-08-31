import { Module } from "@nestjs/common";
import { DealCloseController } from "./deal-close.controller";
import { DealCloseService } from "./deal-close.service";
import { OdooModule } from "../odoo/odoo.module";

@Module({
  imports: [OdooModule],
  controllers: [DealCloseController],
  providers: [DealCloseService],
  exports: [DealCloseService],
})
export class DealCloseModule {}
