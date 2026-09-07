-- AlterTable
ALTER TABLE "Container" ADD COLUMN "intakeOrigin" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Container" ADD COLUMN "odooLotId" INTEGER;
ALTER TABLE "Container" ADD COLUMN "odooLocation" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooDua" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooPoName" TEXT;
ALTER TABLE "Container" ADD COLUMN "originCountry" TEXT;

CREATE INDEX "Container_odooLotId_idx" ON "Container"("odooLotId");
CREATE INDEX "Container_intakeOrigin_idx" ON "Container"("intakeOrigin");

-- CreateTable
CREATE TABLE "OdooLotCandidate" (
    "id" TEXT NOT NULL,
    "odooLotId" INTEGER NOT NULL,
    "odooWriteDate" TIMESTAMP(3),
    "serialRaw" TEXT NOT NULL,
    "isoNormalized" TEXT NOT NULL,
    "iso6346Ok" BOOLEAN NOT NULL DEFAULT false,
    "productName" TEXT NOT NULL DEFAULT '',
    "productCode" TEXT NOT NULL DEFAULT '',
    "locationName" TEXT NOT NULL DEFAULT '',
    "locationOdooId" INTEGER,
    "qtyOnHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" TEXT,
    "tareKg" INTEGER,
    "mgwKg" INTEGER,
    "year" INTEGER,
    "manufacturer" TEXT,
    "dua" TEXT,
    "originCountry" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "containerIso" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assimilatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OdooLotCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OdooLotCandidate_odooLotId_key" ON "OdooLotCandidate"("odooLotId");
CREATE INDEX "OdooLotCandidate_isoNormalized_idx" ON "OdooLotCandidate"("isoNormalized");
CREATE INDEX "OdooLotCandidate_status_idx" ON "OdooLotCandidate"("status");
CREATE INDEX "OdooLotCandidate_lastSyncedAt_idx" ON "OdooLotCandidate"("lastSyncedAt");
