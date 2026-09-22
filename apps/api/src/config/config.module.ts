import { Module } from "@nestjs/common";
import { ConfigController } from "./config.controller";
import { EvaluationModule } from "../evaluation/evaluation.module";
import { CatalogSharesModule } from "../catalog-shares/catalog-shares.module";

@Module({
  imports: [EvaluationModule, CatalogSharesModule],
  controllers: [ConfigController],
})
export class ConfigAppModule {}
