-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'coordinador';

-- AlterTable Container
ALTER TABLE "Container" ADD COLUMN "campoEnabledAt" TIMESTAMP(3);
ALTER TABLE "Container" ADD COLUMN "campoEnabledByName" TEXT;
ALTER TABLE "Container" ADD COLUMN "material" TEXT;
ALTER TABLE "Container" ADD COLUMN "conditionWalls" TEXT;
ALTER TABLE "Container" ADD COLUMN "roofHole" BOOLEAN;

CREATE INDEX "Container_campoEnabledAt_idx" ON "Container"("campoEnabledAt");

-- CreateTable
CREATE TABLE "FieldCapture" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "assignedSlot" INTEGER,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FieldCapture_iso_createdAt_idx" ON "FieldCapture"("iso", "createdAt");

ALTER TABLE "FieldCapture" ADD CONSTRAINT "FieldCapture_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "DepotCostConcept" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepotCostConcept_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepotCostConcept_key_key" ON "DepotCostConcept"("key");

-- CreateTable
CREATE TABLE "DepotCostEntry" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "conceptLabel" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepotCostEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DepotCostEntry_iso_createdAt_idx" ON "DepotCostEntry"("iso", "createdAt");
CREATE INDEX "DepotCostEntry_iso_conceptKey_idx" ON "DepotCostEntry"("iso", "conceptKey");

ALTER TABLE "DepotCostEntry" ADD CONSTRAINT "DepotCostEntry_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepotCostEntry" ADD CONSTRAINT "DepotCostEntry_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "DepotCostConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ContainerDocument" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContainerDocument_iso_createdAt_idx" ON "ContainerDocument"("iso", "createdAt");

ALTER TABLE "ContainerDocument" ADD CONSTRAINT "ContainerDocument_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "GateVisit" (
    "id" TEXT NOT NULL,
    "tractorPlate" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "ruc" TEXT NOT NULL DEFAULT '',
    "driverName" TEXT NOT NULL DEFAULT '',
    "visitAt" TIMESTAMP(3),
    "license" TEXT NOT NULL DEFAULT '',
    "motive" TEXT NOT NULL DEFAULT 'descargar',
    "trailerPlate" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "equipmentCode" TEXT,
    "containerIso" TEXT,
    "linkedAt" TIMESTAMP(3),
    "linkedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GateVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GateVisit_tractorPlate_idx" ON "GateVisit"("tractorPlate");
CREATE INDEX "GateVisit_containerIso_idx" ON "GateVisit"("containerIso");
CREATE INDEX "GateVisit_linkedAt_idx" ON "GateVisit"("linkedAt");

ALTER TABLE "GateVisit" ADD CONSTRAINT "GateVisit_containerIso_fkey" FOREIGN KEY ("containerIso") REFERENCES "Container"("iso") ON DELETE SET NULL ON UPDATE CASCADE;
