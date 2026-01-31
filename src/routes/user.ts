import express from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

router.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  res.json(user);
});

router.delete("/me", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { authorId: userId } });
      await tx.expeditionMember.deleteMany({ where: { userId } });
      await tx.teamMember.deleteMany({ where: { userId } });
      await tx.rescue.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });

      const expeditions = await tx.expedition.findMany({
        where: { creatorId: userId },
        select: { id: true },
      });
      if (expeditions.length) {
        await tx.expedition.deleteMany({
          where: { id: { in: expeditions.map((e) => e.id) } },
        });
      }

      const teams = await tx.team.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      if (teams.length) {
        const teamIds = teams.map((team) => team.id);
        await tx.expedition.updateMany({
          where: { teamId: { in: teamIds } },
          data: { teamId: null },
        });
        await tx.team.deleteMany({ where: { id: { in: teamIds } } });
      }

      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ message: "Cuenta eliminada" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "No se pudo eliminar la cuenta" });
  }
});

export default router;
