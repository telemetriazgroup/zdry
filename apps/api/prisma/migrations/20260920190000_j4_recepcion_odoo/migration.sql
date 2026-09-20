-- Descripción del lote Odoo + write-back desde Recepción
ALTER TABLE "Container" ADD COLUMN "odooDescription" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OdooLotCandidate" ADD COLUMN "odooDescription" TEXT NOT NULL DEFAULT '';
