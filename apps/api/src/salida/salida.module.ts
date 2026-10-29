import { Module } from "@nestjs/common";
import { SalidaService } from "./salida.service";

@Module({
  providers: [SalidaService],
  exports: [SalidaService],
})
export class SalidaModule {}
