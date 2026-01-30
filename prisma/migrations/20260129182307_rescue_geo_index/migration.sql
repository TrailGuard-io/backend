-- AlterTable
ALTER TABLE "Rescue"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Rescue"
SET "updatedAt" = COALESCE("updatedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Rescue_latitude_longitude_idx" ON "Rescue"("latitude", "longitude");
