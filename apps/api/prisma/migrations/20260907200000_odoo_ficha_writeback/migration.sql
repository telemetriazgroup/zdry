ALTER TABLE "OdooLotCandidate" ADD COLUMN "material" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "zgroupCode" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "zdryType" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "zdryCat" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "zdryNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooLotCandidate" ADD COLUMN "localTouched" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSyncStatus" TEXT NOT NULL DEFAULT 'live';
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSyncError" TEXT;

CREATE INDEX "OdooLotCandidate_odooSyncStatus_idx" ON "OdooLotCandidate"("odooSyncStatus");

CREATE TABLE "OdooFieldWriteback" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OdooFieldWriteback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OdooFieldWriteback_candidateId_status_idx" ON "OdooFieldWriteback"("candidateId", "status");
CREATE INDEX "OdooFieldWriteback_status_idx" ON "OdooFieldWriteback"("status");

ALTER TABLE "OdooFieldWriteback" ADD CONSTRAINT "OdooFieldWriteback_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "OdooLotCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
