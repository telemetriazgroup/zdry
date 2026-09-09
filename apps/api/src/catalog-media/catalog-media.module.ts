import { Module } from "@nestjs/common";
import { CatalogMediaController } from "./catalog-media.controller";
import { CatalogMediaService } from "./catalog-media.service";
import { WarehouseModule } from "../warehouse/warehouse.module";
import { EvaluationModule } from "../evaluation/evaluation.module";

@Module({
  imports: [WarehouseModule, EvaluationModule],
  controllers: [CatalogMediaController],
  providers: [CatalogMediaService],
})
export class CatalogMediaModule {}
