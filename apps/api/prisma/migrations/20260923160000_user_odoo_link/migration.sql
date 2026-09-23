CREATE TABLE "UserOdooLink" (
    "userId" TEXT NOT NULL,
    "odooLogin" TEXT NOT NULL DEFAULT '',
    "odooUid" INTEGER,
    "odooName" TEXT NOT NULL DEFAULT '',
    "companyId" INTEGER,
    "companyName" TEXT NOT NULL DEFAULT '',
    "apiKeyEnc" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'none',
    "testedAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "bypass" BOOLEAN NOT NULL DEFAULT false,
    "bypassById" TEXT,
    "bypassByName" TEXT NOT NULL DEFAULT '',
    "bypassAt" TIMESTAMP(3),
    "targetUrl" TEXT NOT NULL DEFAULT '',
    "targetDb" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOdooLink_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserOdooLink" ADD CONSTRAINT "UserOdooLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
