import { Module } from "@nestjs/common";
import { QuotesService } from "./quotes.service";
import { CatalogController } from "./catalog.controller";
import { CatalogAccessGuard } from "./catalog-access.guard";
import { QuotesController, AccountController, AdminOdooController } from "./quotes.controller";
import { DealCloseModule } from "../deal-close/deal-close.module";
import { OdooModule } from "../odoo/odoo.module";
import { SunatRucService } from "./sunat-ruc.service";
import { OdooImportModule } from "../odoo-import/odoo-import.module";
import { CatalogSharesModule } from "../catalog-shares/catalog-shares.module";

@Module({
  imports: [DealCloseModule, OdooModule, OdooImportModule, CatalogSharesModule],
  controllers: [CatalogController, QuotesController, AccountController, AdminOdooController],
  providers: [QuotesService, SunatRucService, CatalogAccessGuard],
  exports: [QuotesService],
})
export class QuotesModule {}
