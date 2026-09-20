-- J4: una foto de referencia en el lote Odoo + origen de la casilla
ALTER TABLE "Container" ADD COLUMN "odooRefAttachmentId" INTEGER;
ALTER TABLE "Container" ADD COLUMN "odooRefSlot" INTEGER;
ALTER TABLE "Container" ADD COLUMN "odooRefPushedAt" TIMESTAMP(3);

ALTER TABLE "InspectionPhoto" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'zdry';
