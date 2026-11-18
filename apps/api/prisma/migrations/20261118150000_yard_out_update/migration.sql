CREATE TABLE "YardOutUpdate" (
    "id" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "leftCount" INTEGER NOT NULL,
    "dropCount" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "moves" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "YardOutUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "YardOutUpdate_depotId_createdAt_idx" ON "YardOutUpdate"("depotId", "createdAt");
