-- AlterTable
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "clientIp" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "referer" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "originHost" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "acceptLanguage" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "forwardedFor" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "originMeta" JSONB;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "archiveReason" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "archivedById" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN IF NOT EXISTS "archivedByName" TEXT;

CREATE INDEX IF NOT EXISTS "GateVisit_archivedAt_idx" ON "GateVisit"("archivedAt");
CREATE INDEX IF NOT EXISTS "GateVisit_clientIp_idx" ON "GateVisit"("clientIp");

-- CreateTable
CREATE TABLE "EvaluationConcept" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationConcept_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvaluationConcept_key_key" ON "EvaluationConcept"("key");
CREATE INDEX "EvaluationConcept_archivedAt_sortOrder_idx" ON "EvaluationConcept"("archivedAt", "sortOrder");

CREATE TABLE "EvaluationLevel" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#5c6370',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationLevel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvaluationLevel_key_key" ON "EvaluationLevel"("key");
CREATE INDEX "EvaluationLevel_archivedAt_sortOrder_idx" ON "EvaluationLevel"("archivedAt", "sortOrder");

CREATE TABLE "ContainerRating" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "conceptLabel" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "levelKey" TEXT NOT NULL,
    "levelLabel" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'patio',
    "setById" TEXT,
    "setByName" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContainerRating_iso_conceptId_key" ON "ContainerRating"("iso", "conceptId");
CREATE INDEX "ContainerRating_iso_setAt_idx" ON "ContainerRating"("iso", "setAt");

CREATE TABLE "ContainerRatingHistory" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "conceptLabel" TEXT NOT NULL,
    "fromLevelKey" TEXT,
    "fromLevelLabel" TEXT,
    "toLevelKey" TEXT NOT NULL,
    "toLevelLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "setById" TEXT,
    "setByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerRatingHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContainerRatingHistory_iso_createdAt_idx" ON "ContainerRatingHistory"("iso", "createdAt");

CREATE TABLE "GateVisitAccessLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tractorPlate" TEXT,
    "visitId" TEXT,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "referer" TEXT NOT NULL DEFAULT '',
    "originHost" TEXT NOT NULL DEFAULT '',
    "acceptLanguage" TEXT NOT NULL DEFAULT '',
    "forwardedFor" TEXT NOT NULL DEFAULT '',
    "extra" JSONB,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateVisitAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GateVisitAccessLog_ip_createdAt_idx" ON "GateVisitAccessLog"("ip", "createdAt");
CREATE INDEX "GateVisitAccessLog_createdAt_idx" ON "GateVisitAccessLog"("createdAt");
CREATE INDEX "GateVisitAccessLog_blocked_createdAt_idx" ON "GateVisitAccessLog"("blocked", "createdAt");

ALTER TABLE "ContainerRating" ADD CONSTRAINT "ContainerRating_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContainerRating" ADD CONSTRAINT "ContainerRating_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "EvaluationConcept"("id") ON UPDATE CASCADE;
ALTER TABLE "ContainerRating" ADD CONSTRAINT "ContainerRating_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "EvaluationLevel"("id") ON UPDATE CASCADE;
ALTER TABLE "ContainerRatingHistory" ADD CONSTRAINT "ContainerRatingHistory_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;
