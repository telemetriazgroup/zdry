import { Module } from "@nestjs/common";
import { OdooModule } from "../odoo/odoo.module";
import { OdooImportController } from "./odoo-import.controller";
import { OdooImportService } from "./odoo-import.service";
import { QuoteIssueService } from "./quote-issue.service";
import { QuoteIssueWorker } from "./quote-issue-worker.service";

@Module({
  imports: [OdooModule],
  controllers: [OdooImportController],
  providers: [OdooImportService, QuoteIssueService, QuoteIssueWorker],
  exports: [OdooImportService, QuoteIssueService, QuoteIssueWorker],
})
export class OdooImportModule {}
