-- J2: inbox de eventos Odoo y conflictos localTouched
CREATE TABLE "OdooBridgeEvent" (
    "id" TEXT NOT NULL,
    "odooEventId" INTEGER,
    "model" TEXT NOT NULL DEFAULT '',
    "resId" INTEGER NOT NULL DEFAULT 0,
    "iso" TEXT,
    "event" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'odoo',
    "payload" JSONB,
    "sourceWriteDate" TIMESTAMP(3),
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OdooBridgeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OdooBridgeEvent_odooEventId_key" ON "OdooBridgeEvent"("odooEventId");
CREATE INDEX "OdooBridgeEvent_event_createdAt_idx" ON "OdooBridgeEvent"("event", "createdAt");
CREATE INDEX "OdooBridgeEvent_iso_idx" ON "OdooBridgeEvent"("iso");

CREATE TABLE "OdooFieldConflict" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "localValue" TEXT,
    "odooValue" TEXT,
    "odooEventId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OdooFieldConflict_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OdooFieldConflict_candidateId_status_idx" ON "OdooFieldConflict"("candidateId", "status");
CREATE INDEX "OdooFieldConflict_status_idx" ON "OdooFieldConflict"("status");

ALTER TABLE "OdooFieldConflict" ADD CONSTRAINT "OdooFieldConflict_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "OdooLotCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
