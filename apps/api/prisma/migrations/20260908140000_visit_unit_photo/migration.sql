ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoKey" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoMime" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoName" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoApprovedAt" TIMESTAMP(3);
ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoApprovedBy" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoRejectedAt" TIMESTAMP(3);
