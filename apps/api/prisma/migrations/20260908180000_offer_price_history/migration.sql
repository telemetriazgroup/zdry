-- AlterTable
ALTER TABLE "Container" ADD COLUMN "priceSource" TEXT;
ALTER TABLE "Container" ADD COLUMN "priceAdjustedAt" TIMESTAMP(3);
ALTER TABLE "Container" ADD COLUMN "priceAdjustedByName" TEXT;

-- CreateTable
CREATE TABLE "ContainerPriceChange" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "priceList" DECIMAL(12,2) NOT NULL,
    "priceMin" DECIMAL(12,2) NOT NULL,
    "showPrice" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT,
    "changedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContainerPriceChange_iso_createdAt_idx" ON "ContainerPriceChange"("iso", "createdAt");

-- AddForeignKey
ALTER TABLE "ContainerPriceChange" ADD CONSTRAINT "ContainerPriceChange_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;
