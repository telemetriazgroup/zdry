-- Sprint 4b: publicación de ficha multimedia al catálogo (aprobación admin/gerente)

ALTER TABLE "Container" ADD COLUMN "mediaStatus" TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE "Container" ADD COLUMN "mediaApprovedBy" TEXT;
ALTER TABLE "Container" ADD COLUMN "mediaApprovedAt" TIMESTAMP(3);
ALTER TABLE "Container" ADD COLUMN "mediaReviewNote" TEXT;

CREATE INDEX "Container_mediaStatus_idx" ON "Container"("mediaStatus");

-- Unidades que ya tenían fotos de recepción quedan publicadas para no vaciar el catálogo demo.
UPDATE "Container" c
SET "mediaStatus" = 'aprobado',
    "mediaApprovedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "InspectionPhoto" p WHERE p.iso = c.iso);
