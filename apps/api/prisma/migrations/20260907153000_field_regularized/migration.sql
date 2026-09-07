-- AlterTable
ALTER TABLE "Container" ADD COLUMN "fieldRegularizedAt" TIMESTAMP(3);
ALTER TABLE "Container" ADD COLUMN "fieldRegularizedByName" TEXT;

-- CreateIndex
CREATE INDEX "Container_fieldRegularizedAt_idx" ON "Container"("fieldRegularizedAt");
CREATE INDEX "Container_mediaApprovedAt_idx" ON "Container"("mediaApprovedAt");
