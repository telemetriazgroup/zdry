ALTER TABLE "CatalogShare" ADD COLUMN "ruc" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "clientEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "contactName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "street" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "district" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "province" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "department" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "sunatState" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "sunatCondition" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "customerId" TEXT;
ALTER TABLE "CatalogShare" ADD COLUMN "suspendedAt" TIMESTAMP(3);

CREATE INDEX "CatalogShare_ruc_suspendedAt_idx" ON "CatalogShare"("ruc", "suspendedAt");

ALTER TABLE "CatalogShareEvent" ADD COLUMN "ip" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShareEvent" ADD COLUMN "userAgent" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShareEvent" ADD COLUMN "device" TEXT NOT NULL DEFAULT '';
