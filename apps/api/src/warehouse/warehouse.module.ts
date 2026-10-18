import { Module } from "@nestjs/common";
import { WarehouseController } from "./warehouse.controller";
import { YardController } from "./yard.controller";
import { WarehouseService } from "./warehouse.service";
import { ExitEconomicsService } from "./exit-economics.service";
import { RealizedSalesService } from "./realized-sales.service";
import { EvaluationModule } from "../evaluation/evaluation.module";
import { OdooImportModule } from "../odoo-import/odoo-import.module";

@Module({
  imports: [EvaluationModule, OdooImportModule],
  controllers: [WarehouseController, YardController],
  providers: [WarehouseService, ExitEconomicsService, RealizedSalesService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
