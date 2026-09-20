-- CreateTable
CREATE TABLE "OdooDryDeal" (
    "id" TEXT NOT NULL,
    "odooId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "dateOrder" TIMESTAMP(3) NOT NULL,
    "partnerName" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "amountTotal" DECIMAL(14,2) NOT NULL,
    "amountUntaxed" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "invoiceStatus" TEXT NOT NULL,
    "isSubscription" BOOLEAN NOT NULL DEFAULT false,
    "pipeline" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OdooDryDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OdooDryStatsMeta" (
    "id" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "fetchedBy" TEXT,
    "excluded" JSONB,
    "baseline" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OdooDryStatsMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OdooDryDeal_odooId_key" ON "OdooDryDeal"("odooId");

-- CreateIndex
CREATE INDEX "OdooDryDeal_year_kind_idx" ON "OdooDryDeal"("year", "kind");

-- CreateIndex
CREATE INDEX "OdooDryDeal_vendorName_idx" ON "OdooDryDeal"("vendorName");

-- CreateIndex
CREATE INDEX "OdooDryDeal_pipeline_idx" ON "OdooDryDeal"("pipeline");

-- CreateIndex
CREATE INDEX "OdooDryDeal_month_idx" ON "OdooDryDeal"("month");
