import { Module } from "@nestjs/common";
import { CatalogSharesController } from "./catalog-shares.controller";
import { CatalogSharesService } from "./catalog-shares.service";

@Module({
  controllers: [CatalogSharesController],
  providers: [CatalogSharesService],
  exports: [CatalogSharesService],
})
export class CatalogSharesModule {}
