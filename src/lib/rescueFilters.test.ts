import { describe, expect, it } from "vitest";
import {
  buildRescueWhere,
  matchesStreamFilters,
  rescueQuerySchema,
  type RescueStreamRecord,
} from "./rescueFilters";

describe("rescueFilters", () => {
  it("buildRescueWhere normalizes bbox bounds", () => {
    const filters = rescueQuerySchema.parse({
      minLat: 10,
      maxLat: 5,
      minLng: -55,
      maxLng: -60,
    });

    const where = buildRescueWhere(filters);
    expect(where.latitude).toEqual({ gte: 5, lte: 10 });
    expect(where.longitude).toEqual({ gte: -60, lte: -55 });
  });

  it("buildRescueWhere throws on invalid dates", () => {
    const filters = rescueQuerySchema.parse({ from: "invalid-date" });
    expect(() => buildRescueWhere(filters)).toThrow("Fecha 'from' inválida");
  });

  it("matchesStreamFilters respects type and bbox", () => {
    const rescue: RescueStreamRecord = {
      id: 1,
      userId: 10,
      assignedRescuerId: null,
      assignedTeamId: null,
      latitude: -38.0,
      longitude: -57.5,
      message: null,
      status: "pending",
      vehicleType: "suv",
      drivetrain: "four_wd",
      terrainType: "sand",
      problemType: "stuck",
      assistanceStatus: "none",
      assistanceChannel: "community",
      assistanceProvider: null,
      rescuerLatitude: null,
      rescuerLongitude: null,
      rescuerUpdatedAt: null,
      createdAt: new Date("2025-01-01T10:00:00Z"),
      updatedAt: new Date("2025-01-01T10:00:00Z"),
    };

    const filters = rescueQuerySchema.parse({
      vehicleType: "suv",
      minLat: -39,
      maxLat: -37,
      minLng: -58,
      maxLng: -57,
    });

    expect(matchesStreamFilters(rescue, filters)).toBe(true);
  });

  it("buildRescueWhere sets status and assistance filters", () => {
    const filters = rescueQuerySchema.parse({
      status: "pending",
      assistanceStatus: "en_route",
      assistanceChannel: "community",
    });

    const where = buildRescueWhere(filters);
    expect(where.status).toBe("pending");
    expect(where.assistanceStatus).toBe("en_route");
    expect(where.assistanceChannel).toBe("community");
  });

  it("matchesStreamFilters rejects outside bbox", () => {
    const rescue: RescueStreamRecord = {
      id: 2,
      userId: 11,
      assignedRescuerId: null,
      assignedTeamId: null,
      latitude: -35.0,
      longitude: -57.5,
      message: null,
      status: "pending",
      vehicleType: "car",
      drivetrain: "two_wd",
      terrainType: "asphalt",
      problemType: "mechanical",
      assistanceStatus: "none",
      assistanceChannel: "none",
      assistanceProvider: null,
      rescuerLatitude: null,
      rescuerLongitude: null,
      rescuerUpdatedAt: null,
      createdAt: new Date("2025-01-01T10:00:00Z"),
      updatedAt: new Date("2025-01-01T10:00:00Z"),
    };

    const filters = rescueQuerySchema.parse({
      minLat: -39,
      maxLat: -37,
      minLng: -58,
      maxLng: -57,
    });

    expect(matchesStreamFilters(rescue, filters)).toBe(false);
  });
});
