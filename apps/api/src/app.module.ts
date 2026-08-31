import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { DealCloseModule } from "./deal-close/deal-close.module";
import { OdooModule } from "./odoo/odoo.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SeedService } from "./prisma/seed.service";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { MastersModule } from "./masters/masters.module";
import { PeopleModule } from "./people/people.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ConfigAppModule } from "./config/config.module";

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    DealCloseModule,
    OdooModule,
    MastersModule,
    PeopleModule,
    InventoryModule,
    ConfigAppModule,
  ],
  controllers: [HealthController],
  providers: [SeedService],
})
export class AppModule {}
