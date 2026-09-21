import { Module } from "@nestjs/common";
import { OdooModule } from "../odoo/odoo.module";
import { OdooImportController } from "./odoo-import.controller";
import { OdooImportService } from "./odoo-import.service";
import { QuoteIssueService } from "./quote-issue.service";
import { QuoteIssueWorker } from "./quote-issue-worker.service";
import { QuotePdfService } from "./quote-pdf.service";
import { QuoteAmendService } from "./quote-amend.service";

@Module({
  imports: [OdooModule],
  controllers: [OdooImportController],
  providers: [OdooImportService, QuoteIssueService, QuoteIssueWorker, QuotePdfService, QuoteAmendService],
  exports: [OdooImportService, QuoteIssueService, QuoteIssueWorker, QuotePdfService, QuoteAmendService],
})
export class OdooImportModule {}
