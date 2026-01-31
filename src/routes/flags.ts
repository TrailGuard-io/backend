import express from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionType: true },
    });

    const plan = user?.subscriptionType || "free";
    const isPremium = plan === "premium" || plan === "pro";
    const isPro = plan === "pro";

    res.json({
      plan,
      flags: {
        teams: isPremium,
        expeditions: isPremium,
        groupChat: isPremium,
        activityHistory: isPremium,
        advancedNotifications: isPremium,
        analytics: isPro,
        apiAccess: isPro,
        prioritySupport: isPro,
        adminTools: isPro,
      },
    });
  } catch (error) {
    console.error("Error fetching flags:", error);
    res.status(500).json({ error: "Could not fetch flags" });
  }
});

export default router;
