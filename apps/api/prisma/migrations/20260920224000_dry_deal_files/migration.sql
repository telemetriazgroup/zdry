-- AlterTable
ALTER TABLE "OdooDryDeal" ADD COLUMN "fileCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OdooDryDealFile" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "odooAttId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL DEFAULT '',
    "size" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'so',
    "storageKey" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OdooDryDealFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OdooDryDealFile_dealId_odooAttId_key" ON "OdooDryDealFile"("dealId", "odooAttId");
CREATE INDEX "OdooDryDealFile_dealId_kind_idx" ON "OdooDryDealFile"("dealId", "kind");

-- AddForeignKey
ALTER TABLE "OdooDryDealFile" ADD CONSTRAINT "OdooDryDealFile_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "OdooDryDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
