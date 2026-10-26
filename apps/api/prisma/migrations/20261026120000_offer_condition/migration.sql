ALTER TABLE "Container" ADD COLUMN "catDocument" TEXT;
ALTER TABLE "Container" ADD COLUMN "catLocked" BOOLEAN NOT NULL DEFAULT false;
