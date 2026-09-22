ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "CatalogShare" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "vendorName" TEXT NOT NULL,
  "vendorWhatsapp" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "clientCompany" TEXT NOT NULL DEFAULT '',
  "clientPhone" TEXT NOT NULL DEFAULT '',
  "clientNote" TEXT NOT NULL DEFAULT '',
  "hours" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogShare_token_key" ON "CatalogShare"("token");
CREATE INDEX IF NOT EXISTS "CatalogShare_vendorId_createdAt_idx" ON "CatalogShare"("vendorId", "createdAt");
CREATE INDEX IF NOT EXISTS "CatalogShare_expiresAt_idx" ON "CatalogShare"("expiresAt");

CREATE TABLE IF NOT EXISTS "CatalogShareEvent" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "iso" TEXT,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogShareEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CatalogShareEvent_shareId_createdAt_idx" ON "CatalogShareEvent"("shareId", "createdAt");
CREATE INDEX IF NOT EXISTS "CatalogShareEvent_iso_idx" ON "CatalogShareEvent"("iso");

ALTER TABLE "CatalogShare" DROP CONSTRAINT IF EXISTS "CatalogShare_vendorId_fkey";
ALTER TABLE "CatalogShare" ADD CONSTRAINT "CatalogShare_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CatalogShareEvent" DROP CONSTRAINT IF EXISTS "CatalogShareEvent_shareId_fkey";
ALTER TABLE "CatalogShareEvent" ADD CONSTRAINT "CatalogShareEvent_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "CatalogShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
