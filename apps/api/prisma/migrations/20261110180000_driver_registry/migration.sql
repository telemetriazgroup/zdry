ALTER TABLE "GateVisit" ADD COLUMN "publicCode" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN "siteId" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN "siteName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GateVisit" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'REGISTRADO';
ALTER TABLE "GateVisit" ADD COLUMN "observations" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GateVisit" ADD COLUMN "motiveDetail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoArchivedAt" TIMESTAMP(3);
ALTER TABLE "GateVisit" ADD COLUMN "unitPhotoArchivedBy" TEXT;
ALTER TABLE "GateVisit" ADD COLUMN "notifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "GateVisit_publicCode_key" ON "GateVisit"("publicCode");
CREATE INDEX "GateVisit_status_archivedAt_idx" ON "GateVisit"("status", "archivedAt");
CREATE INDEX "GateVisit_siteId_idx" ON "GateVisit"("siteId");

UPDATE "GateVisit" SET "status" = 'FINALIZADO' WHERE "linkedAt" IS NOT NULL;

CREATE TABLE "VisitSite" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "replyPhone" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitSite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitSite_name_key" ON "VisitSite"("name");

CREATE TABLE "VisitMotive" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asksDetail" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitMotive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitMotive_name_key" ON "VisitMotive"("name");

CREATE TABLE "VisitRecipient" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitRecipient_siteId_kind_destination_key" ON "VisitRecipient"("siteId", "kind", "destination");
CREATE INDEX "VisitRecipient_siteId_active_idx" ON "VisitRecipient"("siteId", "active");

CREATE TABLE "VisitWarehouse" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitWarehouse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitWarehouse_siteId_name_key" ON "VisitWarehouse"("siteId", "name");

CREATE TABLE "VisitStatusEvent" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "byId" TEXT,
    "byName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitStatusEvent_visitId_createdAt_idx" ON "VisitStatusEvent"("visitId", "createdAt");

CREATE TABLE "VisitNotice" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitNotice_visitId_createdAt_idx" ON "VisitNotice"("visitId", "createdAt");

ALTER TABLE "GateVisit" ADD CONSTRAINT "GateVisit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "VisitSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitRecipient" ADD CONSTRAINT "VisitRecipient_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "VisitSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitWarehouse" ADD CONSTRAINT "VisitWarehouse_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "VisitSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitStatusEvent" ADD CONSTRAINT "VisitStatusEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "GateVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitNotice" ADD CONSTRAINT "VisitNotice_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "GateVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
