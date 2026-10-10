ALTER TABLE "CatalogShare" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "PriceException" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientCompany" TEXT NOT NULL DEFAULT '',
    "ruc" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "requestedPrice" DECIMAL(12,2) NOT NULL,
    "approvedPrice" DECIMAL(12,2),
    "priceList" DECIMAL(12,2) NOT NULL,
    "priceMin" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceException_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceException_status_createdAt_idx" ON "PriceException"("status", "createdAt");
CREATE INDEX "PriceException_iso_idx" ON "PriceException"("iso");
CREATE INDEX "PriceException_vendorId_createdAt_idx" ON "PriceException"("vendorId", "createdAt");
