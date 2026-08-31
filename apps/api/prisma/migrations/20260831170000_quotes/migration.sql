-- Sprint 4: catálogo, cotizaciones, cierre por comprobante, cuenta cliente

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'cliente';

ALTER TABLE "User" ADD COLUMN "customerId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Container" ADD COLUMN "commercialStatus" TEXT NOT NULL DEFAULT 'disponible';
ALTER TABLE "Container" ADD COLUMN "physicalStatus" TEXT NOT NULL DEFAULT 'en_transito_ingreso';
ALTER TABLE "Container" ADD COLUMN "reservedBy" TEXT;
ALTER TABLE "Container" ADD COLUMN "reservationExpiry" TIMESTAMP(3);
ALTER TABLE "Container" ADD COLUMN "reservedQuoteId" TEXT;
ALTER TABLE "Container" ADD COLUMN "showPriceOverride" BOOLEAN;

CREATE INDEX "Container_commercialStatus_idx" ON "Container"("commercialStatus");

CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "target" TEXT,
    "marginPct" DECIMAL(6,2) NOT NULL,
    "maxDiscountPct" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityRule" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "target" TEXT,
    "show" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisibilityRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommercialService" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "CommercialService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'venta',
    "dealStatus" TEXT NOT NULL DEFAULT 'nueva',
    "customerId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "lostReason" TEXT,
    "holdExpiresAt" TIMESTAMP(3),
    "holdPausedAt" TIMESTAMP(3),
    "freightZoneId" TEXT,
    "freightVehicle" TEXT,
    "freightSnapshot" JSONB,
    "movementInformed" BOOLEAN NOT NULL DEFAULT false,
    "movementWaived" BOOLEAN NOT NULL DEFAULT false,
    "clientPickup" BOOLEAN NOT NULL DEFAULT false,
    "dispatchDate" TIMESTAMP(3),
    "dispatchDepotId" TEXT,
    "dispatchNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");
CREATE INDEX "Quote_dealStatus_idx" ON "Quote"("dealStatus");
CREATE INDEX "Quote_vendorId_idx" ON "Quote"("vendorId");
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "listPrice" DECIMAL(12,2) NOT NULL,
    "minPrice" DECIMAL(12,2) NOT NULL,
    "priceNet" DECIMAL(12,2) NOT NULL,
    "frozenAt" TIMESTAMP(3),
    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QuoteExtra" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    CONSTRAINT "QuoteExtra_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "QuoteExtra" ADD CONSTRAINT "QuoteExtra_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DealMessage" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealMessage_quoteId_createdAt_idx" ON "DealMessage"("quoteId", "createdAt");
ALTER TABLE "DealMessage" ADD CONSTRAINT "DealMessage_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PaymentVoucher" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bank" TEXT NOT NULL DEFAULT '',
    "operationNumber" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3),
    "declaredAmount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'subido',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentVoucher_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentVoucher_quoteId_status_idx" ON "PaymentVoucher"("quoteId", "status");
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QuoteEvent" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuoteEvent_quoteId_createdAt_idx" ON "QuoteEvent"("quoteId", "createdAt");
ALTER TABLE "QuoteEvent" ADD CONSTRAINT "QuoteEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OdooSyncJob" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OdooSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OdooSyncJob_status_idx" ON "OdooSyncJob"("status");
ALTER TABLE "OdooSyncJob" ADD CONSTRAINT "OdooSyncJob_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'venta',
    "status" TEXT NOT NULL DEFAULT 'Pendiente de programar',
    "depotId" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "isos" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dispatch_status_idx" ON "Dispatch"("status");
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Container" SET "physicalStatus" = 'en_patio' WHERE "physicallyReceived" = true;
UPDATE "Container" SET "commercialStatus" = 'custodia' WHERE "intakeType" = 'almacenaje_cliente';
UPDATE "Container" SET "commercialStatus" = 'disponible' WHERE "status" = 'Disponible' AND "intakeType" <> 'almacenaje_cliente';
