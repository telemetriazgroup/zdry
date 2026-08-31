import { Module } from "@nestjs/common";
import { CatalogMediaController } from "./catalog-media.controller";
import { CatalogMediaService } from "./catalog-media.service";
import { WarehouseModule } from "../warehouse/warehouse.module";

@Module({
  imports: [WarehouseModule],
  controllers: [CatalogMediaController],
  providers: [CatalogMediaService],
})
export class CatalogMediaModule {}
