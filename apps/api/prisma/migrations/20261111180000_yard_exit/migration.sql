CREATE TABLE "YardExit" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "YardExit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "YardExit_depotId_status_idx" ON "YardExit"("depotId", "status");
CREATE INDEX "YardExit_iso_status_idx" ON "YardExit"("iso", "status");
