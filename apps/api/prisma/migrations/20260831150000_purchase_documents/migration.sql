-- Sprint 2+: documentos de factura de compra (PDF / imágenes) en MinIO

CREATE TABLE "PurchaseDocument" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseDocument_purchaseInvoiceId_idx" ON "PurchaseDocument"("purchaseInvoiceId");

ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
