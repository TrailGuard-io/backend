import { Prisma } from "@prisma/client";
import { z } from "zod";

export const VEHICLE_TYPES = [
  "car",
  "suv",
  "utv",
  "truck",
  "bus",
  "atv",
  "motorcycle",
  "van",
  "other",
] as const;

export const DRIVETRAIN_TYPES = ["two_wd", "four_wd", "awd"] as const;

export const TERRAIN_TYPES = [
  "asphalt",
  "sand",
  "mud",
  "rock",
  "snow",
  "water",
  "gravel",
  "other",
] as const;

export const PROBLEM_TYPES = [
  "stuck",
  "mechanical",
  "flat_tire",
  "battery",
  "fuel",
  "accident",
  "other",
] as const;

export const ASSISTANCE_STATUSES = [
  "none",
  "en_route",
  "on_site",
  "needs_more_help",
  "resolved",
] as const;

export const ASSISTANCE_CHANNELS = [
  "none",
  "community",
  "official",
  "commercial",
  "private",
] as const;

export const rescueQuerySchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  drivetrain: z.enum(DRIVETRAIN_TYPES).optional(),
  terrainType: z.enum(TERRAIN_TYPES).optional(),
  problemType: z.enum(PROBLEM_TYPES).optional(),
  assistanceStatus: z.enum(ASSISTANCE_STATUSES).optional(),
  assistanceChannel: z.enum(ASSISTANCE_CHANNELS).optional(),
  status: z.enum(["pending", "accepted", "resolved"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  cursor: z.coerce.number().optional(),
});

export type RescueStreamRecord = {
  id: number;
  latitude: number;
  longitude: number;
  message: string | null;
  status: string;
  vehicleType: (typeof VEHICLE_TYPES)[number] | null;
  drivetrain: (typeof DRIVETRAIN_TYPES)[number] | null;
  terrainType: (typeof TERRAIN_TYPES)[number] | null;
  problemType: (typeof PROBLEM_TYPES)[number] | null;
  assistanceStatus: (typeof ASSISTANCE_STATUSES)[number] | null;
  assistanceChannel: (typeof ASSISTANCE_CHANNELS)[number] | null;
  assistanceProvider: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const buildRescueWhere = (
  filters: z.infer<typeof rescueQuerySchema>
) => {
  const where: Prisma.RescueWhereInput = {};

  if (filters.vehicleType) where.vehicleType = filters.vehicleType;
  if (filters.drivetrain) where.drivetrain = filters.drivetrain;
  if (filters.terrainType) where.terrainType = filters.terrainType;
  if (filters.problemType) where.problemType = filters.problemType;
  if (filters.assistanceStatus) where.assistanceStatus = filters.assistanceStatus;
  if (filters.assistanceChannel) where.assistanceChannel = filters.assistanceChannel;
  if (filters.status) where.status = filters.status;

  if (filters.from || filters.to) {
    const fromDate = filters.from ? new Date(filters.from) : undefined;
    const toDate = filters.to ? new Date(filters.to) : undefined;

    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw new Error("Fecha 'from' inválida");
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw new Error("Fecha 'to' inválida");
    }

    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  if (
    filters.minLat !== undefined &&
    filters.maxLat !== undefined &&
    filters.minLng !== undefined &&
    filters.maxLng !== undefined
  ) {
    const latMin = Math.min(filters.minLat, filters.maxLat);
    const latMax = Math.max(filters.minLat, filters.maxLat);
    const lngMin = Math.min(filters.minLng, filters.maxLng);
    const lngMax = Math.max(filters.minLng, filters.maxLng);

    where.latitude = { gte: latMin, lte: latMax };
    where.longitude = { gte: lngMin, lte: lngMax };
  }

  return where;
};

export const matchesStreamFilters = (
  rescue: RescueStreamRecord,
  filters: z.infer<typeof rescueQuerySchema>
) => {
  if (filters.vehicleType && rescue.vehicleType !== filters.vehicleType) return false;
  if (filters.drivetrain && rescue.drivetrain !== filters.drivetrain) return false;
  if (filters.terrainType && rescue.terrainType !== filters.terrainType) return false;
  if (filters.problemType && rescue.problemType !== filters.problemType) return false;
  if (filters.assistanceStatus && rescue.assistanceStatus !== filters.assistanceStatus) return false;
  if (filters.assistanceChannel && rescue.assistanceChannel !== filters.assistanceChannel) return false;
  if (filters.status && rescue.status !== filters.status) return false;

  if (filters.from) {
    const fromDate = new Date(filters.from);
    if (!Number.isNaN(fromDate.getTime()) && rescue.createdAt < fromDate) return false;
  }
  if (filters.to) {
    const toDate = new Date(filters.to);
    if (!Number.isNaN(toDate.getTime()) && rescue.createdAt > toDate) return false;
  }

  if (
    filters.minLat !== undefined &&
    filters.maxLat !== undefined &&
    filters.minLng !== undefined &&
    filters.maxLng !== undefined
  ) {
    const latMin = Math.min(filters.minLat, filters.maxLat);
    const latMax = Math.max(filters.minLat, filters.maxLat);
    const lngMin = Math.min(filters.minLng, filters.maxLng);
    const lngMax = Math.max(filters.minLng, filters.maxLng);

    if (
      rescue.latitude < latMin ||
      rescue.latitude > latMax ||
      rescue.longitude < lngMin ||
      rescue.longitude > lngMax
    ) {
      return false;
    }
  }

  return true;
};
