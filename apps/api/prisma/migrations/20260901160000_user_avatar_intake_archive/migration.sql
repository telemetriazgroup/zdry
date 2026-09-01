-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;

-- AlterTable
ALTER TABLE "Container" ADD COLUMN "registeredById" TEXT;
ALTER TABLE "Container" ADD COLUMN "registeredByName" TEXT;
ALTER TABLE "Container" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Container" ADD COLUMN "archiveReason" TEXT;
ALTER TABLE "Container" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "Container" ADD COLUMN "archivedByName" TEXT;

-- CreateIndex
CREATE INDEX "Container_archivedAt_idx" ON "Container"("archivedAt");
