-- J2.1 expediente por serial (timeline, documentos versionados, notas)
CREATE TABLE "UnitTimeline" (
    "id" TEXT NOT NULL,
    "isoNormalized" TEXT NOT NULL,
    "candidateId" TEXT,
    "containerIso" TEXT,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "source" TEXT NOT NULL,
    "event" TEXT,
    "odooEventId" INTEGER,
    "applied" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UnitTimeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UnitTimeline_isoNormalized_createdAt_idx" ON "UnitTimeline"("isoNormalized", "createdAt");
CREATE INDEX "UnitTimeline_candidateId_idx" ON "UnitTimeline"("candidateId");

CREATE TABLE "OdooDocSnapshot" (
    "id" TEXT NOT NULL,
    "isoNormalized" TEXT NOT NULL,
    "candidateId" TEXT,
    "containerIso" TEXT,
    "kind" TEXT NOT NULL,
    "odooModel" TEXT NOT NULL,
    "odooId" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "sourceWriteDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OdooDocSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OdooDocSnapshot_isoNormalized_kind_odooId_version_key" ON "OdooDocSnapshot"("isoNormalized", "kind", "odooId", "version");
CREATE INDEX "OdooDocSnapshot_isoNormalized_kind_idx" ON "OdooDocSnapshot"("isoNormalized", "kind");

CREATE TABLE "UnitNote" (
    "id" TEXT NOT NULL,
    "isoNormalized" TEXT NOT NULL,
    "candidateId" TEXT,
    "containerIso" TEXT,
    "source" TEXT NOT NULL,
    "odooMessageId" INTEGER,
    "author" TEXT,
    "body" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UnitNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UnitNote_isoNormalized_createdAt_idx" ON "UnitNote"("isoNormalized", "createdAt");
CREATE UNIQUE INDEX "UnitNote_isoNormalized_odooMessageId_key" ON "UnitNote"("isoNormalized", "odooMessageId");
