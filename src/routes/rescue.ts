import express from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { EventEmitter } from "events";
import { z } from "zod";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import {
  ASSISTANCE_CHANNELS,
  ASSISTANCE_STATUSES,
  DRIVETRAIN_TYPES,
  PROBLEM_TYPES,
  TERRAIN_TYPES,
  VEHICLE_TYPES,
  buildRescueWhere,
  matchesStreamFilters,
  rescueQuerySchema,
  type RescueStreamRecord,
} from "../lib/rescueFilters";

const router = express.Router();
const prisma = new PrismaClient();
const rescueEvents = new EventEmitter();
rescueEvents.setMaxListeners(0);

type RescuePayload = {
  type: "create" | "update";
  rescue: RescueStreamRecord;
};

const emitRescueEvent = (payload: RescuePayload) => {
  rescueEvents.emit("rescue", payload);
};

const rescueCreateSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  message: z.string().max(500).optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  drivetrain: z.enum(DRIVETRAIN_TYPES).optional(),
  terrainType: z.enum(TERRAIN_TYPES).optional(),
  problemType: z.enum(PROBLEM_TYPES).optional(),
  assistanceStatus: z.enum(ASSISTANCE_STATUSES).optional(),
  assistanceChannel: z.enum(ASSISTANCE_CHANNELS).optional(),
  assistanceProvider: z.string().max(80).optional(),
});

const rescueUpdateSchema = z
  .object({
    status: z.enum(["pending", "accepted", "resolved"]).optional(),
    assistanceStatus: z.enum(ASSISTANCE_STATUSES).optional(),
    assistanceChannel: z.enum(ASSISTANCE_CHANNELS).optional(),
    assistanceProvider: z.string().max(80).optional(),
    problemType: z.enum(PROBLEM_TYPES).optional(),
  })
  .strict();


router.get("/meta", authMiddleware, (_req, res) => {
  res.json({
    vehicleTypes: VEHICLE_TYPES,
    drivetrainTypes: DRIVETRAIN_TYPES,
    terrainTypes: TERRAIN_TYPES,
    problemTypes: PROBLEM_TYPES,
    assistanceStatuses: ASSISTANCE_STATUSES,
    assistanceChannels: ASSISTANCE_CHANNELS,
  });
});

router.post("/request", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const parsed = rescueCreateSchema.safeParse(req.body);

  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  const {
    latitude,
    longitude,
    message,
    vehicleType,
    drivetrain,
    terrainType,
    problemType,
    assistanceStatus,
    assistanceChannel,
    assistanceProvider,
  } = parsed.data;

  try {
    const rescue = await prisma.rescue.create({
      data: {
        userId,
        latitude,
        longitude,
        message,
        status: "pending",
        vehicleType,
        drivetrain,
        terrainType,
        problemType,
        assistanceStatus,
        assistanceChannel,
        assistanceProvider,
      },
    });

    emitRescueEvent({ type: "create", rescue });
    res.status(201).json(rescue);
  } catch (err) {
    res.status(500).json({ error: "No se pudo registrar la solicitud" });
  }
});

router.patch("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const parsed = rescueUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "Sin campos para actualizar" });
  }

  try {
    const existing = await prisma.rescue.findUnique({
      where: { id: rescueId },
      select: { userId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Rescate no encontrado" });
    }

    if (existing.userId !== req.user?.id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const updated = await prisma.rescue.update({
      where: { id: rescueId },
      data: parsed.data,
    });

    emitRescueEvent({ type: "update", rescue: updated });
    res.json(updated);
  } catch (err) {
    console.error("❌ Error al actualizar rescate:", err);
    res.status(500).json({ error: "No se pudo actualizar el rescate" });
  }
});

router.get("/stream", authMiddleware, (req: AuthRequest, res) => {
  const parsed = rescueQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    buildRescueWhere(parsed.data);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.write("event: ready\n");
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

  const onRescue = (payload: RescuePayload) => {
    if (!matchesStreamFilters(payload.rescue, parsed.data)) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  rescueEvents.on("rescue", onRescue);

  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    rescueEvents.off("rescue", onRescue);
  });
});

router.get("/all", authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const parsed = rescueQuerySchema.safeParse(_req.query);
    if (!parsed.success) {
      return res.status(400).json(parsed.error);
    }

    let where: Prisma.RescueWhereInput;
    try {
      where = buildRescueWhere(parsed.data);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    const take = Math.min(Math.max(parsed.data.limit || 500, 1), 1000);

    const rescues = await prisma.rescue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        latitude: true,
        longitude: true,
        message: true,
        status: true,
        vehicleType: true,
        drivetrain: true,
        terrainType: true,
        problemType: true,
        assistanceStatus: true,
        assistanceChannel: true,
        assistanceProvider: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(rescues);
  } catch (err) {
    console.error("❌ Error al obtener todos los rescates:", err);
    res.status(500).json({ error: "No se pudieron obtener los rescates" });
  }
});

router.get("/my", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const rescues = await prisma.rescue.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        message: true,
        status: true,
        vehicleType: true,
        drivetrain: true,
        terrainType: true,
        problemType: true,
        assistanceStatus: true,
        assistanceChannel: true,
        assistanceProvider: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(rescues);
  } catch (err) {
    console.error("❌ Error al obtener rescates:", err);
    res.status(500).json({ error: "No se pudieron obtener los rescates" });
  }
});

export default router;
