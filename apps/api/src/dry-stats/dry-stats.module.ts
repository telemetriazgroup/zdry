import { Module } from "@nestjs/common";
import { DryStatsController } from "./dry-stats.controller";
import { DryStatsService } from "./dry-stats.service";

@Module({
  controllers: [DryStatsController],
  providers: [DryStatsService],
})
export class DryStatsModule {}
