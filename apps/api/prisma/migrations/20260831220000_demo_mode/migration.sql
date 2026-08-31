-- AlterTable
ALTER TABLE "User" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Container" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DataBackup" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdBy" TEXT,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_demo_idx" ON "User"("demo");

-- CreateIndex
CREATE INDEX "Container_demo_idx" ON "Container"("demo");

-- CreateIndex
CREATE INDEX "Customer_demo_idx" ON "Customer"("demo");

-- CreateIndex
CREATE INDEX "Quote_demo_idx" ON "Quote"("demo");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_demo_idx" ON "PurchaseInvoice"("demo");

-- CreateIndex
CREATE INDEX "DataBackup_createdAt_idx" ON "DataBackup"("createdAt");
