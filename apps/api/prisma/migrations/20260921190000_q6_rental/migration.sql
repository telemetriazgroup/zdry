-- Q6: alquiler — cuota, suscripción, cronograma, IN, cuotas

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooPickingInId" INTEGER;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooPickingInName" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooPickingInState" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "rentPriceNet" DECIMAL(12,2);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "rentMonths" INTEGER;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "rentStart" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "rentEnd" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooPlanId" INTEGER;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "odooSubscriptionId" INTEGER;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "cronogramaStorageKey" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "cronogramaRenderedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "QuoteInstallment" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "odooMoveId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "amountTotal" DECIMAL(16,2) NOT NULL,
    "paymentState" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteInstallment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteInstallment_odooMoveId_key" ON "QuoteInstallment"("odooMoveId");
CREATE INDEX IF NOT EXISTS "QuoteInstallment_quoteId_createdAt_idx" ON "QuoteInstallment"("quoteId", "createdAt");

ALTER TABLE "QuoteInstallment" DROP CONSTRAINT IF EXISTS "QuoteInstallment_quoteId_fkey";
ALTER TABLE "QuoteInstallment" ADD CONSTRAINT "QuoteInstallment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
