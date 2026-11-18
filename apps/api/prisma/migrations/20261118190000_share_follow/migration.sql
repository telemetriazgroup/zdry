ALTER TABLE "CatalogShare" ADD COLUMN "quoteId" TEXT NOT NULL DEFAULT '';

CREATE TABLE "ShareFollow" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL DEFAULT '',
    "authorName" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "iso" TEXT NOT NULL DEFAULT '',
    "priceNet" DECIMAL(12,2),
    "priceList" DECIMAL(12,2),
    "quoteId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareFollow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShareFollow_shareId_createdAt_idx" ON "ShareFollow"("shareId", "createdAt");
ALTER TABLE "ShareFollow" ADD CONSTRAINT "ShareFollow_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "CatalogShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ShareFollowFile" (
    "id" TEXT NOT NULL,
    "followId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    CONSTRAINT "ShareFollowFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShareFollowFile_followId_idx" ON "ShareFollowFile"("followId");
ALTER TABLE "ShareFollowFile" ADD CONSTRAINT "ShareFollowFile_followId_fkey" FOREIGN KEY ("followId") REFERENCES "ShareFollow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
