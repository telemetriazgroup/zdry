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
import { PurchasesModule } from "./purchases/purchases.module";
import { StorageModule } from "./storage/storage.module";
import { ConfigAppModule } from "./config/config.module";
import { RedisModule } from "./redis/redis.module";
import { WarehouseModule } from "./warehouse/warehouse.module";
import { QuotesModule } from "./quotes/quotes.module";
import { CatalogMediaModule } from "./catalog-media/catalog-media.module";
import { DemoModule } from "./demo/demo.module";

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    DealCloseModule,
    OdooModule,
    StorageModule,
    RedisModule,
    MastersModule,
    PeopleModule,
    InventoryModule,
    PurchasesModule,
    WarehouseModule,
    QuotesModule,
    CatalogMediaModule,
    ConfigAppModule,
    DemoModule,
  ],
  controllers: [HealthController],
  providers: [SeedService],
})
export class AppModule {}
