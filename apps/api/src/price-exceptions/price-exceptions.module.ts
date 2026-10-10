import { Module } from "@nestjs/common";
import { PriceExceptionsController } from "./price-exceptions.controller";
import { PriceExceptionsService } from "./price-exceptions.service";

@Module({
  controllers: [PriceExceptionsController],
  providers: [PriceExceptionsService],
})
export class PriceExceptionsModule {}
