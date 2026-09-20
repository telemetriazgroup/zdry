-- AlterTable
ALTER TABLE "OdooDryDeal" ADD COLUMN "partnerVat" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "paymentTerm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "warehouse" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "validityDate" TIMESTAMP(3);
ALTER TABLE "OdooDryDeal" ADD COLUMN "opportunityName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "clientRef" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "amountTax" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "OdooDryDeal" ADD COLUMN "paymentState" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "note" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "dossierStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "OdooDryDeal" ADD COLUMN "dossierAt" TIMESTAMP(3);
ALTER TABLE "OdooDryDeal" ADD COLUMN "dossierError" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooDryDeal" ADD COLUMN "outCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OdooDryDeal" ADD COLUMN "inCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OdooDryDeal" ADD COLUMN "invoiceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OdooDryDeal" ADD COLUMN "noteCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OdooDryStatsMeta" ADD COLUMN "hydrate" JSONB;

-- CreateTable
CREATE TABLE "OdooDryDealLine" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "odooId" INTEGER NOT NULL,
    "productCode" TEXT NOT NULL DEFAULT '',
    "productName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL,
    "qtyDelivered" DECIMAL(12,2) NOT NULL,
    "qtyInvoiced" DECIMAL(12,2) NOT NULL,
    "priceUnit" DECIMAL(14,2) NOT NULL,
    "priceSubtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(8,2) NOT NULL,
    "tax" TEXT NOT NULL DEFAULT '',
    "lotName" TEXT NOT NULL DEFAULT '',
    "studioTipo" TEXT NOT NULL DEFAULT '',
    "studioEquipo" TEXT NOT NULL DEFAULT '',
    "displayType" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OdooDryDealLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OdooDryDealDoc" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "odooModel" TEXT NOT NULL,
    "odooId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3),
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT '',
    "paymentState" TEXT NOT NULL DEFAULT '',
    "isos" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OdooDryDealDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OdooDryDealNote" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "odooMsgId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3),
    "messageType" TEXT NOT NULL DEFAULT 'comment',

    CONSTRAINT "OdooDryDealNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OdooDryDeal_dossierStatus_idx" ON "OdooDryDeal"("dossierStatus");
CREATE INDEX "OdooDryDealLine_dealId_idx" ON "OdooDryDealLine"("dealId");
CREATE INDEX "OdooDryDealDoc_dealId_kind_idx" ON "OdooDryDealDoc"("dealId", "kind");
CREATE UNIQUE INDEX "OdooDryDealNote_dealId_odooMsgId_key" ON "OdooDryDealNote"("dealId", "odooMsgId");
CREATE INDEX "OdooDryDealNote_dealId_date_idx" ON "OdooDryDealNote"("dealId", "date");

-- AddForeignKey
ALTER TABLE "OdooDryDealLine" ADD CONSTRAINT "OdooDryDealLine_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "OdooDryDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OdooDryDealDoc" ADD CONSTRAINT "OdooDryDealDoc_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "OdooDryDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OdooDryDealNote" ADD CONSTRAINT "OdooDryDealNote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "OdooDryDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
