import express from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

router.post("/request", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { latitude, longitude, message } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: "Coordenadas requeridas" });
  }

  try {
    const rescue = await prisma.rescue.create({
      data: {
        userId,
        latitude,
        longitude,
        message,
        status: "pending",
      },
    });

    res.status(201).json(rescue);
  } catch (err) {
    res.status(500).json({ error: "No se pudo registrar la solicitud" });
  }
});

router.get("/my", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;

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
        createdAt: true,
      },
    });

    res.json(rescues);
  } catch (err) {
    console.error("❌ Error al obtener rescates:", err);
    res.status(500).json({ error: "No se pudieron obtener los rescates" });
  }
});

export default router;
