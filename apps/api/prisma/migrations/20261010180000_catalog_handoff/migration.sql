CREATE TABLE "CatalogHandoff" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "iso" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "includePrice" BOOLEAN NOT NULL DEFAULT false,
    "vendorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogHandoff_token_key" ON "CatalogHandoff"("token");
CREATE INDEX "CatalogHandoff_iso_idx" ON "CatalogHandoff"("iso");
CREATE INDEX "CatalogHandoff_expiresAt_idx" ON "CatalogHandoff"("expiresAt");
