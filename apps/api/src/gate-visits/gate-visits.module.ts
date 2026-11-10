import { Module } from "@nestjs/common";
import { GateVisitsController } from "./gate-visits.controller";
import { GateVisitsService } from "./gate-visits.service";
import { DriverRegistryService } from "./driver-registry.service";
import { SalidaModule } from "../salida/salida.module";

@Module({
  imports: [SalidaModule],
  controllers: [GateVisitsController],
  providers: [GateVisitsService, DriverRegistryService],
  exports: [GateVisitsService],
})
export class GateVisitsModule {}
