-- Dirección fiscal y ubigeo SUNAT (además de razón social)

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "department" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "sunatUbigeo" TEXT NOT NULL DEFAULT '';
