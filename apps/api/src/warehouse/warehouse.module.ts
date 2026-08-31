import { Module } from "@nestjs/common";
import { WarehouseController } from "./warehouse.controller";
import { YardController } from "./yard.controller";
import { WarehouseService } from "./warehouse.service";

@Module({
  controllers: [WarehouseController, YardController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
