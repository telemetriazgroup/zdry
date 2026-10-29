ALTER TABLE "CatalogShare" ADD COLUMN "docKind" TEXT NOT NULL DEFAULT 'ruc';
ALTER TABLE "CatalogShare" ADD COLUMN "dni" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogShare" ADD COLUMN "rucPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogShare" ADD COLUMN "odooPartnerId" INTEGER;
ALTER TABLE "CatalogShare" ADD COLUMN "odooContactId" INTEGER;

CREATE INDEX "CatalogShare_dni_suspendedAt_idx" ON "CatalogShare"("dni", "suspendedAt");
