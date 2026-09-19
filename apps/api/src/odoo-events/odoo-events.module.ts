import { Module } from "@nestjs/common";
import { OdooImportModule } from "../odoo-import/odoo-import.module";
import { OdooEventsController } from "./odoo-events.controller";
import { OdooEventsService } from "./odoo-events.service";

@Module({
  imports: [OdooImportModule],
  controllers: [OdooEventsController],
  providers: [OdooEventsService],
})
export class OdooEventsModule {}
