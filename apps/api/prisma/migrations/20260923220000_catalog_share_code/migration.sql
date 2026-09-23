ALTER TABLE "CatalogShare" ADD COLUMN "accessCode" TEXT NOT NULL DEFAULT '';
UPDATE "CatalogShare"
SET "accessCode" = lpad((floor(random() * 1000000))::int::text, 6, '0')
WHERE "accessCode" = '';
