import { Module } from "@nestjs/common";
import { OdooImportModule } from "../odoo-import/odoo-import.module";
import { PurchasesController } from "./purchases.controller";
import { PurchasesService } from "./purchases.service";

@Module({
  imports: [OdooImportModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
