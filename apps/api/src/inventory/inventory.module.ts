import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { PurchasesModule } from "../purchases/purchases.module";

@Module({
  imports: [PurchasesModule],
  controllers: [InventoryController],
})
export class InventoryModule {}
