-- AlterTable Container
ALTER TABLE "Container" ADD COLUMN "odooPoId" INTEGER;
ALTER TABLE "Container" ADD COLUMN "odooVendorName" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooBillName" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooUnitPrice" DECIMAL(12,2);
ALTER TABLE "Container" ADD COLUMN "conditionFloor" TEXT;
ALTER TABLE "Container" ADD COLUMN "conditionRoof" TEXT;
ALTER TABLE "Container" ADD COLUMN "conditionDoors" TEXT;
ALTER TABLE "Container" ADD COLUMN "conditionPaint" TEXT;

-- AlterTable InspectionPhoto
ALTER TABLE "InspectionPhoto" ADD COLUMN "publicKey" TEXT;

-- AlterTable OdooLotCandidate
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooPoName" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooPoId" INTEGER;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooVendorName" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooBillName" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooUnitPrice" DECIMAL(12,2);
