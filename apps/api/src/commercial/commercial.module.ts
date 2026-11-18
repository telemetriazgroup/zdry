import { Module } from "@nestjs/common";
import { SalidaModule } from "../salida/salida.module";
import { CommercialController } from "./commercial.controller";
import { CommercialService } from "./commercial.service";

@Module({
  imports: [SalidaModule],
  controllers: [CommercialController],
  providers: [CommercialService],
  exports: [CommercialService],
})
export class CommercialModule {}
