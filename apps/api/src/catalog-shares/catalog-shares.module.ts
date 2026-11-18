import { Module } from "@nestjs/common";
import { SalidaModule } from "../salida/salida.module";
import { CommercialModule } from "../commercial/commercial.module";
import { CatalogSharesController } from "./catalog-shares.controller";
import { CatalogSharesService } from "./catalog-shares.service";
import { ShareFollowService } from "./share-follow.service";

@Module({
  imports: [SalidaModule, CommercialModule],
  controllers: [CatalogSharesController],
  providers: [CatalogSharesService, ShareFollowService],
  exports: [CatalogSharesService],
})
export class CatalogSharesModule {}
