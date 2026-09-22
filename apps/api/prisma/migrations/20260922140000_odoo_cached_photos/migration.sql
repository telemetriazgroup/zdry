-- Fotos de chatter Odoo copiadas a MinIO al asimilar (o al primer uso).
CREATE TABLE "OdooCachedPhoto" (
    "id" TEXT NOT NULL,
    "odooLotId" INTEGER NOT NULL,
    "odooAttId" INTEGER NOT NULL,
    "containerIso" TEXT,
    "candidateId" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'inbox',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OdooCachedPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OdooCachedPhoto_odooLotId_odooAttId_key" ON "OdooCachedPhoto"("odooLotId", "odooAttId");
CREATE INDEX "OdooCachedPhoto_containerIso_idx" ON "OdooCachedPhoto"("containerIso");
CREATE INDEX "OdooCachedPhoto_candidateId_idx" ON "OdooCachedPhoto"("candidateId");
CREATE INDEX "OdooCachedPhoto_odooLotId_idx" ON "OdooCachedPhoto"("odooLotId");

ALTER TABLE "OdooCachedPhoto" ADD CONSTRAINT "OdooCachedPhoto_containerIso_fkey" FOREIGN KEY ("containerIso") REFERENCES "Container"("iso") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OdooCachedPhoto" ADD CONSTRAINT "OdooCachedPhoto_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "OdooLotCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
