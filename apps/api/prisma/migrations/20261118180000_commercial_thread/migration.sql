ALTER TABLE "CatalogShare" ADD COLUMN "executiveId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "executiveName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "executiveWhatsapp" TEXT NOT NULL DEFAULT '';

CREATE TABLE "CommercialDesk" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "executiveId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommercialDesk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialDesk_vendorId_key" ON "CommercialDesk"("vendorId");
CREATE INDEX "CommercialDesk_executiveId_idx" ON "CommercialDesk"("executiveId");
CREATE INDEX "CommercialDesk_enabled_idx" ON "CommercialDesk"("enabled");

ALTER TABLE "CommercialDesk" ADD CONSTRAINT "CommercialDesk_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommercialDesk" ADD CONSTRAINT "CommercialDesk_executiveId_fkey" FOREIGN KEY ("executiveId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommercialThread" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "unitType" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'abierto',
    "priceList" DECIMAL(12,2) NOT NULL,
    "priceMin" DECIMAL(12,2) NOT NULL,
    "priceNet" DECIMAL(12,2),
    "contactAskedAt" TIMESTAMP(3),
    "vendorOkAt" TIMESTAMP(3),
    "lastVendorPingAt" TIMESTAMP(3),
    "executivePingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommercialThread_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommercialThread_shareId_iso_status_idx" ON "CommercialThread"("shareId", "iso", "status");
CREATE INDEX "CommercialThread_status_contactAskedAt_idx" ON "CommercialThread"("status", "contactAskedAt");

ALTER TABLE "CommercialThread" ADD CONSTRAINT "CommercialThread_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "CatalogShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommercialMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommercialMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommercialMessage_threadId_createdAt_idx" ON "CommercialMessage"("threadId", "createdAt");

ALTER TABLE "CommercialMessage" ADD CONSTRAINT "CommercialMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommercialThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
