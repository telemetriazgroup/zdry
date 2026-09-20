-- Diario de asimilación Odoo: cada serie / paso / error con detalle
CREATE TABLE "OdooAssimilateRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startedBy" TEXT,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "skipCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OdooAssimilateRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OdooAssimilateRun_startedAt_idx" ON "OdooAssimilateRun"("startedAt");
CREATE INDEX "OdooAssimilateRun_status_startedAt_idx" ON "OdooAssimilateRun"("status", "startedAt");

CREATE TABLE "OdooAssimilateLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "iso" TEXT NOT NULL DEFAULT '',
    "serialRaw" TEXT NOT NULL DEFAULT '',
    "odooLotId" INTEGER,
    "product" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OdooAssimilateLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OdooAssimilateLog_runId_createdAt_idx" ON "OdooAssimilateLog"("runId", "createdAt");
CREATE INDEX "OdooAssimilateLog_runId_level_idx" ON "OdooAssimilateLog"("runId", "level");
CREATE INDEX "OdooAssimilateLog_iso_idx" ON "OdooAssimilateLog"("iso");

ALTER TABLE "OdooAssimilateLog" ADD CONSTRAINT "OdooAssimilateLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OdooAssimilateRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
