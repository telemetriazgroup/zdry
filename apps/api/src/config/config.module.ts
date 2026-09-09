import { Module } from "@nestjs/common";
import { ConfigController } from "./config.controller";
import { EvaluationModule } from "../evaluation/evaluation.module";

@Module({
  imports: [EvaluationModule],
  controllers: [ConfigController],
})
export class ConfigAppModule {}
