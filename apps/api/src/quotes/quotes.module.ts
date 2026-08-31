import { Module } from "@nestjs/common";
import { QuotesService } from "./quotes.service";
import { CatalogController } from "./catalog.controller";
import { QuotesController, AccountController, AdminOdooController } from "./quotes.controller";
import { DealCloseModule } from "../deal-close/deal-close.module";

@Module({
  imports: [DealCloseModule],
  controllers: [CatalogController, QuotesController, AccountController, AdminOdooController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
