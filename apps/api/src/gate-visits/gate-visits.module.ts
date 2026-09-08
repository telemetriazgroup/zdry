import { Module } from "@nestjs/common";
import { GateVisitsController } from "./gate-visits.controller";
import { GateVisitsService } from "./gate-visits.service";

@Module({
  controllers: [GateVisitsController],
  providers: [GateVisitsService],
  exports: [GateVisitsService],
})
export class GateVisitsModule {}
