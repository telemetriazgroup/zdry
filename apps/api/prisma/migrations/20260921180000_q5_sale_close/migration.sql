-- Q5: semáforo factura / picking Odoo en la Quote

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooInvoiceId" INTEGER;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooInvoiceName" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooPickingId" INTEGER;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooPickingName" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooPickingState" TEXT;
