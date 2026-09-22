-- AlterTable
ALTER TABLE "Depot" ADD COLUMN IF NOT EXISTS "code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Depot_code_key" ON "Depot"("code");

-- AlterTable
ALTER TABLE "Container" ADD COLUMN IF NOT EXISTS "odooWarehouse" TEXT;
ALTER TABLE "Container" ADD COLUMN IF NOT EXISTS "overlaySkipKeys" JSONB;
ALTER TABLE "Container" ADD COLUMN IF NOT EXISTS "overlayExtras" JSONB;
CREATE INDEX IF NOT EXISTS "Container_odooWarehouse_idx" ON "Container"("odooWarehouse");

-- AlterTable
ALTER TABLE "OdooLotCandidate" ADD COLUMN IF NOT EXISTS "odooWarehouse" TEXT;
