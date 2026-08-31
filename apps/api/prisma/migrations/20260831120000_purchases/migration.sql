-- Sprint 2: contenedores, facturas de compra, extras pendientes, historial

CREATE TABLE "Container" (
    "iso" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pendiente de ingreso',
    "year" INTEGER,
    "manufacturer" TEXT NOT NULL DEFAULT '—',
    "depotId" TEXT NOT NULL,
    "intakeType" TEXT NOT NULL DEFAULT 'compra',
    "invoicePending" BOOLEAN NOT NULL DEFAULT false,
    "physicallyReceived" BOOLEAN NOT NULL DEFAULT false,
    "isoException" BOOLEAN NOT NULL DEFAULT false,
    "isoExceptionReason" TEXT,
    "fobCif" DECIMAL(12,2) NOT NULL,
    "priceList" DECIMAL(12,2),
    "priceMin" DECIMAL(12,2),
    "bl" TEXT NOT NULL DEFAULT '',
    "manifest" TEXT NOT NULL DEFAULT '',
    "damNumber" TEXT,
    "nationalizedAt" TIMESTAMP(3),
    "purchaseInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Container_pkey" PRIMARY KEY ("iso")
);

CREATE INDEX "Container_depotId_idx" ON "Container"("depotId");
CREATE INDEX "Container_status_idx" ON "Container"("status");
CREATE INDEX "Container_damNumber_idx" ON "Container"("damNumber");

CREATE TABLE "ContainerHistory" (
    "id" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContainerHistory_iso_createdAt_idx" ON "ContainerHistory"("iso", "createdAt");

CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "incoterm" TEXT NOT NULL,
    "logistics" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "extras" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseInvoice_number_idx" ON "PurchaseInvoice"("number");

CREATE TABLE "PurchaseInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "year" INTEGER,
    "manufacturer" TEXT NOT NULL DEFAULT '—',
    "price" DECIMAL(12,2) NOT NULL,
    "bl" TEXT NOT NULL DEFAULT '',
    "manifest" TEXT NOT NULL DEFAULT '',
    "isoException" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PurchaseInvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PendingExtraCost" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "serviceLabel" TEXT NOT NULL,
    "suggestedProvider" TEXT NOT NULL DEFAULT '',
    "isos" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingExtraCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingExtraCost_status_idx" ON "PendingExtraCost"("status");

ALTER TABLE "Container" ADD CONSTRAINT "Container_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Container" ADD CONSTRAINT "Container_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContainerHistory" ADD CONSTRAINT "ContainerHistory_iso_fkey" FOREIGN KEY ("iso") REFERENCES "Container"("iso") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingExtraCost" ADD CONSTRAINT "PendingExtraCost_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
