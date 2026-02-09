import express from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { notificationEvents, type NotificationPayload } from "../lib/notifications";
import { z } from "zod";

const router = express.Router();
const prisma = new PrismaClient();

const listSchema = z.object({
  limit: z.coerce.number().optional(),
  unreadOnly: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  const limit = Math.min(Math.max(parsed.data.limit || 30, 1), 100);

  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        ...(parsed.data.unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "No se pudieron obtener las notificaciones" });
  }
});

router.post("/:id/read", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const notificationId = Number(req.params.id);
  if (Number.isNaN(notificationId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const updated = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
    res.json({ updated: updated.count });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ error: "No se pudo actualizar la notificación" });
  }
});

router.post("/read-all", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const updated = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    res.json({ updated: updated.count });
  } catch (error) {
    console.error("Error marking notifications as read:", error);
    res.status(500).json({ error: "No se pudieron actualizar las notificaciones" });
  }
});

router.get("/stream", authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.write("event: ready\n");
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

  const onNotification = (payload: NotificationPayload) => {
    if (payload.userId !== userId) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  notificationEvents.on("notification", onNotification);

  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    notificationEvents.off("notification", onNotification);
  });
});

export default router;
