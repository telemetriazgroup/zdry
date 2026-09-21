import { Module } from "@nestjs/common";
import { OdooModule } from "../odoo/odoo.module";
import { OdooImportController } from "./odoo-import.controller";
import { OdooImportService } from "./odoo-import.service";
import { QuoteIssueService } from "./quote-issue.service";

@Module({
  imports: [OdooModule],
  controllers: [OdooImportController],
  providers: [OdooImportService, QuoteIssueService],
  exports: [OdooImportService, QuoteIssueService],
})
export class OdooImportModule {}
