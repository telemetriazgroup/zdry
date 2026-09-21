import { Module } from "@nestjs/common";
import { QuotesService } from "./quotes.service";
import { CatalogController } from "./catalog.controller";
import { QuotesController, AccountController, AdminOdooController } from "./quotes.controller";
import { DealCloseModule } from "../deal-close/deal-close.module";
import { OdooModule } from "../odoo/odoo.module";
import { SunatRucService } from "./sunat-ruc.service";

@Module({
  imports: [DealCloseModule, OdooModule],
  controllers: [CatalogController, QuotesController, AccountController, AdminOdooController],
  providers: [QuotesService, SunatRucService],
  exports: [QuotesService],
})
export class QuotesModule {}
