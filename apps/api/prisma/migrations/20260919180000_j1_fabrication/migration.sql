-- J1: origen fabricación (MO) y precursor del mismo serial
ALTER TABLE "Container" ADD COLUMN "odooMoName" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooSourceLotId" INTEGER;
ALTER TABLE "Container" ADD COLUMN "odooSourceProductCode" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooSourceProductName" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooSourceIntakeKind" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooSourcePoName" TEXT;
ALTER TABLE "Container" ADD COLUMN "odooSourceUnitPrice" DECIMAL(12,2);

ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooMoName" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSourceLotId" INTEGER;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSourceProductCode" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSourceProductName" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSourceIntakeKind" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSourcePoName" TEXT;
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooSourceUnitPrice" DECIMAL(12,2);
