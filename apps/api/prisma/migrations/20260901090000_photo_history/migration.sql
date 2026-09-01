-- Rechazo por foto (historial) independiente de publicar/ocultar el catálogo.

ALTER TABLE "InspectionPhoto" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'activa';
ALTER TABLE "InspectionPhoto" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "InspectionPhoto" ADD COLUMN "rejectedById" TEXT;
ALTER TABLE "InspectionPhoto" ADD COLUMN "rejectedByName" TEXT;
ALTER TABLE "InspectionPhoto" ADD COLUMN "rejectNote" TEXT;

DROP INDEX IF EXISTS "InspectionPhoto_iso_slot_key";

CREATE UNIQUE INDEX "InspectionPhoto_iso_slot_activa_key"
  ON "InspectionPhoto"("iso", "slot")
  WHERE "status" = 'activa';

CREATE INDEX "InspectionPhoto_iso_status_idx" ON "InspectionPhoto"("iso", "status");
CREATE INDEX "InspectionPhoto_iso_slot_idx" ON "InspectionPhoto"("iso", "slot");
