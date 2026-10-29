import { Module } from "@nestjs/common";
import { ConfigController } from "./config.controller";
import { EvaluationModule } from "../evaluation/evaluation.module";
import { CatalogSharesModule } from "../catalog-shares/catalog-shares.module";
import { SalidaModule } from "../salida/salida.module";

@Module({
  imports: [EvaluationModule, CatalogSharesModule, SalidaModule],
  controllers: [ConfigController],
})
export class ConfigAppModule {}
