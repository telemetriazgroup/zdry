-- Q4b: snapshot/diff de la SO (source=zdry ahora; Q7 añadirá source=odoo)

CREATE TABLE IF NOT EXISTS "QuoteOdooRevision" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT,
    "invoiceStatus" TEXT,
    "amountUntaxed" DECIMAL(16,2),
    "amountTax" DECIMAL(16,2),
    "amountTotal" DECIMAL(16,2),
    "linesJson" JSONB NOT NULL,
    "diffJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteOdooRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuoteOdooRevision_quoteId_createdAt_idx" ON "QuoteOdooRevision"("quoteId", "createdAt");

ALTER TABLE "QuoteOdooRevision" ADD CONSTRAINT "QuoteOdooRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
