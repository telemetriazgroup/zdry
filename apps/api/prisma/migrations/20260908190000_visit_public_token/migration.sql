ALTER TABLE "GateVisit" ADD COLUMN "publicToken" TEXT;
UPDATE "GateVisit" SET "publicToken" = gen_random_uuid()::text WHERE "publicToken" IS NULL;
ALTER TABLE "GateVisit" ALTER COLUMN "publicToken" SET NOT NULL;
CREATE UNIQUE INDEX "GateVisit_publicToken_key" ON "GateVisit"("publicToken");
