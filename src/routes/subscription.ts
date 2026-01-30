import express from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { z } from "zod";

const router = express.Router();
const prisma = new PrismaClient();

// Subscription plans
const PLANS = {
  premium: {
    name: "Premium",
    price: 9.99,
    duration: 30, // days
    features: [
      "Create and join teams",
      "Organize expeditions",
      "Group chat",
      "Activity history",
      "Advanced notifications"
    ]
  },
  pro: {
    name: "Pro",
    price: 19.99,
    duration: 30, // days
    features: [
      "All Premium features",
      "Commercial expedition organization",
      "Analytics and reports",
      "API access",
      "Priority support",
      "Team administration tools"
    ]
  }
};

const createSubscriptionSchema = z.object({
  type: z.enum(["premium", "pro"]),
  paymentId: z.string().min(1), // Payment processor transaction ID
});

// Get subscription plans
router.get("/plans", (req, res) => {
  res.json(PLANS);
});

// Get user's current subscription
router.get("/current", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionType: true,
        subscriptionEnds: true,
      }
    });

    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "active",
        endDate: {
          gte: new Date()
        }
      },
      orderBy: { endDate: "desc" }
    });

    res.json({
      currentPlan: user?.subscriptionType || "free",
      expiresAt: user?.subscriptionEnds,
      subscription: activeSubscription,
      features: user?.subscriptionType && user.subscriptionType !== "free" 
        ? PLANS[user.subscriptionType as keyof typeof PLANS]?.features || []
        : []
    });
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({ error: "Could not fetch subscription" });
  }
});

// Create/upgrade subscription
router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  
  try {
    const validatedData = createSubscriptionSchema.parse(req.body);
    const plan = PLANS[validatedData.type];
    
    if (!plan) {
      return res.status(400).json({ error: "Invalid subscription type" });
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + plan.duration);

    // Create subscription record
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        type: validatedData.type,
        status: "active",
        startDate,
        endDate,
        paymentId: validatedData.paymentId,
        amount: plan.price,
        currency: "USD",
      }
    });

    // Update user subscription
    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionType: validatedData.type,
        subscriptionEnds: endDate,
      }
    });

    res.status(201).json({
      subscription,
      message: `Successfully subscribed to ${plan.name} plan`
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error creating subscription:", error);
    res.status(500).json({ error: "Could not create subscription" });
  }
});

// Cancel subscription
router.post("/cancel", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  
  try {
    // Mark current active subscription as cancelled
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "active",
        endDate: {
          gte: new Date()
        }
      }
    });

    if (!activeSubscription) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    await prisma.subscription.update({
      where: { id: activeSubscription.id },
      data: { status: "cancelled" }
    });

    // Note: We don't immediately downgrade the user, they keep access until subscription ends
    
    res.json({ 
      message: "Subscription cancelled. Access will continue until expiration date.",
      expiresAt: activeSubscription.endDate
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ error: "Could not cancel subscription" });
  }
});

// Get subscription history
router.get("/history", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    res.json(subscriptions);
  } catch (error) {
    console.error("Error fetching subscription history:", error);
    res.status(500).json({ error: "Could not fetch subscription history" });
  }
});

// Check subscription status (middleware helper)
export const checkSubscription = (requiredType: "premium" | "pro") => {
  return async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "No autorizado" });
    }
    
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          subscriptionType: true,
          subscriptionEnds: true,
        }
      });

      const now = new Date();
      const hasValidSubscription = user?.subscriptionEnds && user.subscriptionEnds > now;
      
      // If subscription expired, downgrade user
      if (user?.subscriptionType !== "free" && !hasValidSubscription) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionType: "free",
            subscriptionEnds: null,
          }
        });
        
        return res.status(403).json({ 
          error: "Subscription expired. Please renew to access this feature." 
        });
      }

      // Check if user has required subscription level
      const subscriptionLevels = { free: 0, premium: 1, pro: 2 };
      const userLevel = subscriptionLevels[user?.subscriptionType as keyof typeof subscriptionLevels] || 0;
      const requiredLevel = subscriptionLevels[requiredType];

      if (userLevel < requiredLevel) {
        return res.status(403).json({ 
          error: `${requiredType} subscription required for this feature` 
        });
      }

      next();
    } catch (error) {
      console.error("Error checking subscription:", error);
      res.status(500).json({ error: "Could not verify subscription" });
    }
  };
};

export default router;
