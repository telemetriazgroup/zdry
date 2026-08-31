-- AlterTable
ALTER TABLE "Depot" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContainerType" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "archivedAt" TIMESTAMP(3);
