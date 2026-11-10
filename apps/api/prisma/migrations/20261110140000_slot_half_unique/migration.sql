DROP INDEX IF EXISTS "Container_slot_unique";

CREATE UNIQUE INDEX "Container_slot_full_unique"
  ON "Container"("depotId", "lado", "ruma", "columna", "nivel")
  WHERE "lado" IS NOT NULL AND "bayHalf" IS NULL;

CREATE UNIQUE INDEX "Container_slot_half_unique"
  ON "Container"("depotId", "lado", "ruma", "columna", "nivel", "bayHalf")
  WHERE "lado" IS NOT NULL AND "bayHalf" IS NOT NULL;
