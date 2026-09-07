import { Module } from "@nestjs/common";
import { OdooModule } from "../odoo/odoo.module";
import { OdooImportController } from "./odoo-import.controller";
import { OdooImportService } from "./odoo-import.service";

@Module({
  imports: [OdooModule],
  controllers: [OdooImportController],
  providers: [OdooImportService],
})
export class OdooImportModule {}
