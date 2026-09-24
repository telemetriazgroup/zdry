import { Module } from "@nestjs/common";
import { OdooModule } from "../odoo/odoo.module";
import { OdooImportController } from "./odoo-import.controller";
import { OdooImportService } from "./odoo-import.service";
import { OdooImportWatchWorker } from "./odoo-import-watch.worker";
import { QuoteIssueService } from "./quote-issue.service";
import { QuoteIssueWorker } from "./quote-issue-worker.service";
import { QuotePdfService } from "./quote-pdf.service";
import { QuoteAmendService } from "./quote-amend.service";
import { SaleCloseWorker } from "./sale-close-worker.service";
import { RentIssueWorker } from "./rent-issue-worker.service";
import { RentCloseWorker } from "./rent-close-worker.service";
import { QuoteOdooFollowService } from "./quote-odoo-follow.service";

@Module({
  imports: [OdooModule],
  controllers: [OdooImportController],
  providers: [
    OdooImportService,
    OdooImportWatchWorker,
    QuoteIssueService,
    QuoteIssueWorker,
    QuotePdfService,
    QuoteAmendService,
    SaleCloseWorker,
    RentIssueWorker,
    RentCloseWorker,
    QuoteOdooFollowService,
  ],
  exports: [
    OdooImportService,
    QuoteIssueService,
    QuoteIssueWorker,
    QuotePdfService,
    QuoteAmendService,
    SaleCloseWorker,
    RentIssueWorker,
    RentCloseWorker,
    QuoteOdooFollowService,
  ],
})
export class OdooImportModule {}
