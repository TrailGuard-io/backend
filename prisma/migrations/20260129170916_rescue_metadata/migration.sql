-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('car', 'suv', 'utv', 'truck', 'bus', 'atv', 'motorcycle', 'van', 'other');

-- CreateEnum
CREATE TYPE "DrivetrainType" AS ENUM ('two_wd', 'four_wd', 'awd');

-- CreateEnum
CREATE TYPE "TerrainType" AS ENUM ('asphalt', 'sand', 'mud', 'rock', 'snow', 'water', 'gravel', 'other');

-- CreateEnum
CREATE TYPE "ProblemType" AS ENUM ('stuck', 'mechanical', 'flat_tire', 'battery', 'fuel', 'accident', 'other');

-- CreateEnum
CREATE TYPE "AssistanceStatus" AS ENUM ('none', 'en_route', 'on_site', 'needs_more_help', 'resolved');

-- CreateEnum
CREATE TYPE "AssistanceChannel" AS ENUM ('none', 'community', 'official', 'commercial', 'private');

-- AlterTable
ALTER TABLE "Rescue" ADD COLUMN     "assistanceChannel" "AssistanceChannel" NOT NULL DEFAULT 'none',
ADD COLUMN     "assistanceProvider" TEXT,
ADD COLUMN     "assistanceStatus" "AssistanceStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "drivetrain" "DrivetrainType",
ADD COLUMN     "problemType" "ProblemType",
ADD COLUMN     "terrainType" "TerrainType",
ADD COLUMN     "vehicleType" "VehicleType";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Rescue_createdAt_idx" ON "Rescue"("createdAt");

-- CreateIndex
CREATE INDEX "Rescue_status_idx" ON "Rescue"("status");

-- CreateIndex
CREATE INDEX "Rescue_vehicleType_idx" ON "Rescue"("vehicleType");

-- CreateIndex
CREATE INDEX "Rescue_terrainType_idx" ON "Rescue"("terrainType");

-- CreateIndex
CREATE INDEX "Rescue_assistanceStatus_idx" ON "Rescue"("assistanceStatus");
