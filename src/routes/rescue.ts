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
import {
  createNotification,
  createNotifications,
} from "../lib/notifications";

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

const rescueCandidateSchema = z
  .object({
    teamId: z.coerce.number().optional(),
  })
  .strict();

const rescueAssignSchema = z
  .object({
    candidateId: z.coerce.number(),
  })
  .strict();

const rescueLocationSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  })
  .strict();

const rescueMessageSchema = z
  .object({
    content: z.string().min(1).max(1000),
  })
  .strict();

const isTeamMember = async (teamId: number, userId: number) => {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, ownerId: true },
  });
  if (!team) return { exists: false, isMember: false };
  if (team.ownerId === userId) return { exists: true, isMember: true };
  const member = await prisma.teamMember.findFirst({
    where: { teamId, userId },
    select: { id: true },
  });
  return { exists: true, isMember: Boolean(member) };
};

const canChatOrShare = async (rescueId: number, userId: number) => {
  const rescue = await prisma.rescue.findUnique({
    where: { id: rescueId },
    select: {
      id: true,
      userId: true,
      assignedRescuerId: true,
      assignedTeamId: true,
    },
  });
  if (!rescue) return { ok: false };
  if (rescue.userId === userId) return { ok: true, rescue };
  if (rescue.assignedRescuerId === userId) return { ok: true, rescue };
  if (rescue.assignedTeamId) {
    const membership = await isTeamMember(rescue.assignedTeamId, userId);
    if (membership.exists && membership.isMember) return { ok: true, rescue };
  }
  return { ok: false, rescue };
};

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
      select: {
        userId: true,
        status: true,
        assignedRescuerId: true,
        assignedTeamId: true,
      },
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

    if (parsed.data.status === "resolved" && existing.status !== "resolved") {
      const recipients = new Set<number>();
      if (existing.assignedRescuerId) recipients.add(existing.assignedRescuerId);
      if (existing.assignedTeamId) {
        const teamMembers = await prisma.teamMember.findMany({
          where: { teamId: existing.assignedTeamId },
          select: { userId: true },
        });
        teamMembers.forEach((member) => recipients.add(member.userId));
        const teamOwner = await prisma.team.findUnique({
          where: { id: existing.assignedTeamId },
          select: { ownerId: true },
        });
        if (teamOwner?.ownerId) recipients.add(teamOwner.ownerId);
      }

      if (recipients.size > 0) {
        await createNotifications(
          prisma,
          Array.from(recipients).map((recipientId) => ({
            user: { connect: { id: recipientId } },
            type: "rescue_resolved",
            title: "Rescate resuelto",
            message: `El rescate #${rescueId} fue resuelto`,
            data: { rescueId },
          }))
        );
      }
    }
    res.json(updated);
  } catch (err) {
    console.error("❌ Error al actualizar rescate:", err);
    res.status(500).json({ error: "No se pudo actualizar el rescate" });
  }
});

router.post("/:id/candidates", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const parsed = rescueCandidateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    const rescue = await prisma.rescue.findUnique({
      where: { id: rescueId },
      select: {
        id: true,
        userId: true,
        status: true,
        assignedRescuerId: true,
        assignedTeamId: true,
      },
    });

    if (!rescue) {
      return res.status(404).json({ error: "Rescate no encontrado" });
    }

    if (rescue.status === "resolved" || rescue.assignedRescuerId || rescue.assignedTeamId) {
      return res.status(400).json({ error: "Rescate no disponible" });
    }

    const teamId = parsed.data.teamId;
    if (teamId) {
      const membership = await isTeamMember(teamId, userId);
      if (!membership.exists) {
        return res.status(404).json({ error: "Equipo no encontrado" });
      }
      if (!membership.isMember) {
        return res.status(403).json({ error: "No autorizado" });
      }
    }

    const existing = await prisma.rescueCandidate.findFirst({
      where: teamId
        ? { rescueId, teamId }
        : { rescueId, userId },
    });

    if (existing) {
      return res.status(200).json(existing);
    }

    const candidate = await prisma.rescueCandidate.create({
      data: {
        rescueId,
        userId: teamId ? undefined : userId,
        teamId: teamId || undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        team: { select: { id: true, name: true, avatar: true } },
      },
    });

    await createNotification(prisma, {
      user: { connect: { id: rescue.userId } },
      type: "rescue_candidate",
      title: "Nuevo candidato",
      message: `Nuevo candidato para rescate #${rescueId}`,
      data: {
        rescueId,
        candidateId: candidate.id,
        candidateUserId: candidate.userId ?? null,
        candidateTeamId: candidate.teamId ?? null,
      },
    });

    res.status(201).json(candidate);
  } catch (err) {
    console.error("❌ Error al postular rescate:", err);
    res.status(500).json({ error: "No se pudo postular" });
  }
});

router.get("/:id/candidates", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const rescue = await prisma.rescue.findUnique({
      where: { id: rescueId },
      select: {
        id: true,
        userId: true,
        assignedRescuerId: true,
        assignedTeamId: true,
      },
    });

    if (!rescue) {
      return res.status(404).json({ error: "Rescate no encontrado" });
    }

    let canView = rescue.userId === userId || rescue.assignedRescuerId === userId;
    if (!canView && rescue.assignedTeamId) {
      const membership = await isTeamMember(rescue.assignedTeamId, userId);
      canView = membership.exists && membership.isMember;
    }

    if (!canView) {
      const candidate = await prisma.rescueCandidate.findFirst({
        where: { rescueId, userId },
        select: { id: true },
      });
      if (!candidate) {
        return res.status(403).json({ error: "No autorizado" });
      }
    }

    const candidates = await prisma.rescueCandidate.findMany({
      where: { rescueId },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        team: { select: { id: true, name: true, avatar: true } },
      },
    });

    res.json(candidates);
  } catch (err) {
    console.error("❌ Error al obtener candidatos:", err);
    res.status(500).json({ error: "No se pudieron obtener candidatos" });
  }
});

router.post("/:id/assign", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const parsed = rescueAssignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    const rescue = await prisma.rescue.findUnique({
      where: { id: rescueId },
      select: { id: true, userId: true, status: true },
    });

    if (!rescue) {
      return res.status(404).json({ error: "Rescate no encontrado" });
    }

    if (rescue.userId !== userId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    if (rescue.status === "resolved") {
      return res.status(400).json({ error: "Rescate ya resuelto" });
    }

    const candidate = await prisma.rescueCandidate.findUnique({
      where: { id: parsed.data.candidateId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        team: { select: { id: true, name: true, avatar: true } },
      },
    });

    if (!candidate || candidate.rescueId !== rescueId) {
      return res.status(404).json({ error: "Candidato no encontrado" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.rescueCandidate.update({
        where: { id: candidate.id },
        data: { status: "accepted" },
      });

      await tx.rescueCandidate.updateMany({
        where: { rescueId, id: { not: candidate.id } },
        data: { status: "rejected" },
      });

      return tx.rescue.update({
        where: { id: rescueId },
        data: {
          status: "accepted",
          assignedRescuerId: candidate.userId ?? null,
          assignedTeamId: candidate.teamId ?? null,
        },
      });
    });

    emitRescueEvent({ type: "update", rescue: updated });

    if (candidate.userId) {
      await createNotification(prisma, {
        user: { connect: { id: candidate.userId } },
        type: "rescue_assigned",
        title: "Rescate asignado",
        message: `Te asignaron el rescate #${rescueId}`,
        data: { rescueId },
      });
    } else if (candidate.teamId) {
      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId: candidate.teamId },
        select: { userId: true },
      });
      const team = await prisma.team.findUnique({
        where: { id: candidate.teamId },
        select: { ownerId: true },
      });
      const recipients = new Set<number>();
      teamMembers.forEach((member) => recipients.add(member.userId));
      if (team?.ownerId) recipients.add(team.ownerId);

      await createNotifications(
        prisma,
        Array.from(recipients).map((recipientId) => ({
          user: { connect: { id: recipientId } },
          type: "rescue_assigned",
          title: "Rescate asignado",
          message: `Tu equipo fue asignado al rescate #${rescueId}`,
          data: { rescueId, teamId: candidate.teamId },
        }))
      );
    }

    res.json({ rescue: updated, candidate });
  } catch (err) {
    console.error("❌ Error al asignar rescate:", err);
    res.status(500).json({ error: "No se pudo asignar el rescate" });
  }
});

router.post(
  "/:id/candidates/:candidateId/reject",
  authMiddleware,
  async (req: AuthRequest, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const rescueId = Number(req.params.id);
    const candidateId = Number(req.params.candidateId);
    if (Number.isNaN(rescueId) || Number.isNaN(candidateId)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    try {
      const rescue = await prisma.rescue.findUnique({
        where: { id: rescueId },
        select: { id: true, userId: true, status: true },
      });

      if (!rescue) {
        return res.status(404).json({ error: "Rescate no encontrado" });
      }

      if (rescue.userId !== userId) {
        return res.status(403).json({ error: "No autorizado" });
      }

      const candidate = await prisma.rescueCandidate.findUnique({
        where: { id: candidateId },
        include: {
          user: { select: { id: true, name: true, email: true, avatar: true } },
          team: { select: { id: true, name: true, avatar: true } },
        },
      });

      if (!candidate || candidate.rescueId !== rescueId) {
        return res.status(404).json({ error: "Candidato no encontrado" });
      }

      if (candidate.status !== "pending") {
        return res.status(400).json({ error: "Candidato ya evaluado" });
      }

      const updated = await prisma.rescueCandidate.update({
        where: { id: candidateId },
        data: { status: "rejected" },
      });

      if (candidate.userId) {
        await createNotification(prisma, {
          user: { connect: { id: candidate.userId } },
          type: "rescue_candidate_rejected",
          title: "Postulación rechazada",
          message: `La postulación al rescate #${rescueId} fue rechazada`,
          data: { rescueId },
        });
      } else if (candidate.teamId) {
        const teamMembers = await prisma.teamMember.findMany({
          where: { teamId: candidate.teamId },
          select: { userId: true },
        });
        const team = await prisma.team.findUnique({
          where: { id: candidate.teamId },
          select: { ownerId: true },
        });
        const recipients = new Set<number>();
        teamMembers.forEach((member) => recipients.add(member.userId));
        if (team?.ownerId) recipients.add(team.ownerId);

        await createNotifications(
          prisma,
          Array.from(recipients).map((recipientId) => ({
            user: { connect: { id: recipientId } },
            type: "rescue_candidate_rejected",
            title: "Postulación rechazada",
            message: `La postulación del equipo al rescate #${rescueId} fue rechazada`,
            data: { rescueId, teamId: candidate.teamId },
          }))
        );
      }

      res.json(updated);
    } catch (err) {
      console.error("❌ Error al rechazar candidato:", err);
      res.status(500).json({ error: "No se pudo rechazar el candidato" });
    }
  }
);

router.post("/:id/location", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const parsed = rescueLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    const access = await canChatOrShare(rescueId, userId);
    if (!access.ok || !access.rescue) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const updated = await prisma.rescue.update({
      where: { id: rescueId },
      data: {
        rescuerLatitude: parsed.data.latitude,
        rescuerLongitude: parsed.data.longitude,
        rescuerUpdatedAt: new Date(),
      },
    });

    emitRescueEvent({ type: "update", rescue: updated });
    res.json(updated);
  } catch (err) {
    console.error("❌ Error al actualizar ubicación:", err);
    res.status(500).json({ error: "No se pudo actualizar la ubicación" });
  }
});

router.get("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const access = await canChatOrShare(rescueId, userId);
    if (!access.ok) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const messages = await prisma.message.findMany({
      where: { rescueId },
      orderBy: { createdAt: "asc" },
      include: {
        author: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });

    res.json(messages);
  } catch (err) {
    console.error("❌ Error al obtener mensajes:", err);
    res.status(500).json({ error: "No se pudieron obtener mensajes" });
  }
});

router.post("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const parsed = rescueMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    const access = await canChatOrShare(rescueId, userId);
    if (!access.ok) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const message = await prisma.message.create({
      data: {
        content: parsed.data.content,
        authorId: userId,
        rescueId,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });

    const recipients = new Set<number>();
    if (access.rescue?.userId) recipients.add(access.rescue.userId);
    if (access.rescue?.assignedRescuerId) recipients.add(access.rescue.assignedRescuerId);
    if (access.rescue?.assignedTeamId) {
      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId: access.rescue.assignedTeamId },
        select: { userId: true },
      });
      teamMembers.forEach((member) => recipients.add(member.userId));
      const team = await prisma.team.findUnique({
        where: { id: access.rescue.assignedTeamId },
        select: { ownerId: true },
      });
      if (team?.ownerId) recipients.add(team.ownerId);
    }
    recipients.delete(userId);

    if (recipients.size > 0) {
      await createNotifications(
        prisma,
        Array.from(recipients).map((recipientId) => ({
          user: { connect: { id: recipientId } },
          type: "rescue_message",
          title: "Nuevo mensaje",
          message: `Nuevo mensaje en rescate #${rescueId}`,
          data: { rescueId },
        }))
      );
    }

    res.status(201).json(message);
  } catch (err) {
    console.error("❌ Error al enviar mensaje:", err);
    res.status(500).json({ error: "No se pudo enviar el mensaje" });
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
        userId: true,
        assignedRescuerId: true,
        assignedTeamId: true,
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
        rescuerLatitude: true,
        rescuerLongitude: true,
        rescuerUpdatedAt: true,
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
        userId: true,
        assignedRescuerId: true,
        assignedTeamId: true,
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
        rescuerLatitude: true,
        rescuerLongitude: true,
        rescuerUpdatedAt: true,
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

router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const rescueId = Number(req.params.id);
  if (Number.isNaN(rescueId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const rescue = await prisma.rescue.findUnique({
      where: { id: rescueId },
      select: {
        id: true,
        userId: true,
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
        assignedRescuerId: true,
        assignedTeamId: true,
        rescuerLatitude: true,
        rescuerLongitude: true,
        rescuerUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        assignedRescuer: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        assignedTeam: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    if (!rescue) {
      return res.status(404).json({ error: "Rescate no encontrado" });
    }

    res.json(rescue);
  } catch (err) {
    console.error("❌ Error al obtener rescate:", err);
    res.status(500).json({ error: "No se pudo obtener el rescate" });
  }
});

export default router;
