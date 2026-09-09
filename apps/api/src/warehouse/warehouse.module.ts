import { Module } from "@nestjs/common";
import { WarehouseController } from "./warehouse.controller";
import { YardController } from "./yard.controller";
import { WarehouseService } from "./warehouse.service";
import { EvaluationModule } from "../evaluation/evaluation.module";

@Module({
  imports: [EvaluationModule],
  controllers: [WarehouseController, YardController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
