-- Sprint 3: recepción física, coordenadas de patio, fotos, reglas persistidas

ALTER TABLE "Container" ADD COLUMN "lado" TEXT;
ALTER TABLE "Container" ADD COLUMN "ruma" INTEGER;
ALTER TABLE "Container" ADD COLUMN "columna" INTEGER;
ALTER TABLE "Container" ADD COLUMN "nivel" INTEGER;
ALTER TABLE "Container" ADD COLUMN "tareKg" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Container" ADD COLUMN "mgwKg" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Container" ADD COLUMN "payloadKg" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Container" ADD COLUMN "color" TEXT NOT NULL DEFAULT '—';
ALTER TABLE "Container" ADD COLUMN "inspectionNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Container" ADD COLUMN "cbm" DECIMAL(8,2);
ALTER TABLE "Container" ADD COLUMN "gateIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Container" ADD COLUMN "gateOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Container" ADD COLUMN "video360Key" TEXT;
ALTER TABLE "Container" ADD COLUMN "video360Mime" TEXT;
ALTER TABLE "Container" ADD COLUMN "ownerCustomerId" TEXT;
ALTER TABLE "Container" ADD COLUMN "storageDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

CREATE INDEX "Container_depotId_lado_idx" ON "Container"("depotId", "lado");

-- C-17: el slot es único dentro de cada depósito; unidades sin posición (lado NULL) pueden repetirse.
CREATE UNIQUE INDEX "Container_slot_unique" ON "Container"("depotId", "lado", "ruma", "columna", "nivel") WHERE "lado" IS NOT NULL;

ALTER TABLE "Container" ADD CONSTRAINT "Container_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InspectionPhoto" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InspectionPhoto_iso_slot_key" ON "InspectionPhoto"("iso", "slot");

ALTER TABLE "InspectionPhoto" ADD CONSTRAINT "InspectionPhoto_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContainerPosition" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "lado" TEXT NOT NULL,
    "ruma" INTEGER NOT NULL,
    "columna" INTEGER NOT NULL,
    "nivel" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ContainerPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContainerPosition_iso_createdAt_idx" ON "ContainerPosition"("iso", "createdAt");

ALTER TABLE "ContainerPosition" ADD CONSTRAINT "ContainerPosition_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
