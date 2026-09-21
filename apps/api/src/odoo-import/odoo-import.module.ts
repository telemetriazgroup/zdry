import { Module } from "@nestjs/common";
import { OdooModule } from "../odoo/odoo.module";
import { OdooImportController } from "./odoo-import.controller";
import { OdooImportService } from "./odoo-import.service";
import { QuoteIssueService } from "./quote-issue.service";
import { QuoteIssueWorker } from "./quote-issue-worker.service";
import { QuotePdfService } from "./quote-pdf.service";

@Module({
  imports: [OdooModule],
  controllers: [OdooImportController],
  providers: [OdooImportService, QuoteIssueService, QuoteIssueWorker, QuotePdfService],
  exports: [OdooImportService, QuoteIssueService, QuoteIssueWorker, QuotePdfService],
})
export class OdooImportModule {}
