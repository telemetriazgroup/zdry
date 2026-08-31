import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { DealCloseModule } from "./deal-close/deal-close.module";
import { OdooModule } from "./odoo/odoo.module";

@Module({
  imports: [DealCloseModule, OdooModule],
  controllers: [HealthController],
})
export class AppModule {}
