import express from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { z } from "zod";

const router = express.Router();
const prisma = new PrismaClient();

const createExpeditionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startDate: z.string().transform((str) => new Date(str)),
  endDate: z.string().transform((str) => new Date(str)).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).default("beginner"),
  maxParticipants: z.number().min(2).max(100).default(10),
  cost: z.number().min(0).optional(),
  isPremium: z.boolean().default(false),
  startLat: z.number().optional(),
  startLng: z.number().optional(),
  endLat: z.number().optional(),
  endLng: z.number().optional(),
  route: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    name: z.string().optional(),
  })).optional(),
  teamId: z.number().optional(),
});

const updateExpeditionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  startDate: z.string().transform((str) => new Date(str)).optional(),
  endDate: z.string().transform((str) => new Date(str)).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
  maxParticipants: z.number().min(2).max(100).optional(),
  cost: z.number().min(0).optional(),
  isPremium: z.boolean().optional(),
  startLat: z.number().optional(),
  startLng: z.number().optional(),
  endLat: z.number().optional(),
  endLng: z.number().optional(),
  route: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    name: z.string().optional(),
  })).optional(),
  status: z.enum(["planned", "active", "completed", "cancelled"]).optional(),
});

// Create expedition (Premium feature)
router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionType: true }
    });

    if (user?.subscriptionType === "free") {
      return res.status(403).json({ error: "Premium subscription required to create expeditions" });
    }

    const validatedData = createExpeditionSchema.parse(req.body);
    
    // If teamId provided, check if user is member
    if (validatedData.teamId) {
      const teamMember = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: validatedData.teamId,
            userId,
          }
        }
      });

      if (!teamMember) {
        return res.status(403).json({ error: "Not a member of this team" });
      }
    }

    const expedition = await prisma.expedition.create({
      data: {
        ...validatedData,
        creatorId: userId,
        route: validatedData.route || undefined,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            members: true,
          }
        }
      }
    });

    // Add creator as confirmed member
    await prisma.expeditionMember.create({
      data: {
        expeditionId: expedition.id,
        userId: userId,
        status: "confirmed",
      }
    });

    res.status(201).json(expedition);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error creating expedition:", error);
    res.status(500).json({ error: "Could not create expedition" });
  }
});

// Get all expeditions (public + user's expeditions)
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const { difficulty, status, teamId } = req.query;
  
  try {
    const where: any = {
      OR: [
        { isPremium: false },
        { members: { some: { userId } } },
        { creatorId: userId }
      ]
    };

    if (difficulty) {
      where.difficulty = difficulty;
    }

    if (status) {
      where.status = status;
    }

    if (teamId) {
      where.teamId = parseInt(teamId as string);
    }

    const expeditions = await prisma.expedition.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            avatar: true,
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            members: true,
          }
        }
      },
      orderBy: { startDate: "asc" }
    });

    res.json(expeditions);
  } catch (error) {
    console.error("Error fetching expeditions:", error);
    res.status(500).json({ error: "Could not fetch expeditions" });
  }
});

// Get expedition by ID
router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const expeditionId = parseInt(req.params.id);
  
  try {
    const expedition = await prisma.expedition.findFirst({
      where: {
        id: expeditionId,
        OR: [
          { isPremium: false },
          { members: { some: { userId } } },
          { creatorId: userId }
        ]
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            avatar: true,
          }
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              }
            }
          },
          orderBy: { joinedAt: "asc" }
        }
      }
    });

    if (!expedition) {
      return res.status(404).json({ error: "Expedition not found" });
    }

    res.json(expedition);
  } catch (error) {
    console.error("Error fetching expedition:", error);
    res.status(500).json({ error: "Could not fetch expedition" });
  }
});

// Update expedition (only creator)
router.put("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const expeditionId = parseInt(req.params.id);
  
  try {
    const expedition = await prisma.expedition.findFirst({
      where: {
        id: expeditionId,
        creatorId: userId,
      }
    });

    if (!expedition) {
      return res.status(404).json({ error: "Expedition not found or no permission" });
    }

    const validatedData = updateExpeditionSchema.parse(req.body);
    
    const updatedExpedition = await prisma.expedition.update({
      where: { id: expeditionId },
      data: {
        ...validatedData,
        route: validatedData.route || undefined,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        },
        team: {
          select: {
            id: true,
            name: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            members: true,
          }
        }
      }
    });

    res.json(updatedExpedition);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error updating expedition:", error);
    res.status(500).json({ error: "Could not update expedition" });
  }
});

// Join expedition
router.post("/:id/join", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const expeditionId = parseInt(req.params.id);
  
  try {
    const expedition = await prisma.expedition.findUnique({
      where: { id: expeditionId },
      include: {
        _count: {
          select: { members: true }
        }
      }
    });

    if (!expedition) {
      return res.status(404).json({ error: "Expedition not found" });
    }

    if (expedition.status !== "planned") {
      return res.status(400).json({ error: "Cannot join expedition that is not in planned status" });
    }

    if (expedition._count.members >= expedition.maxParticipants) {
      return res.status(400).json({ error: "Expedition is full" });
    }

    const existingMember = await prisma.expeditionMember.findUnique({
      where: {
        expeditionId_userId: {
          expeditionId,
          userId,
        }
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: "Already a member" });
    }

    const membership = await prisma.expeditionMember.create({
      data: {
        expeditionId,
        userId,
        status: "pending",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        }
      }
    });

    res.status(201).json(membership);
  } catch (error) {
    console.error("Error joining expedition:", error);
    res.status(500).json({ error: "Could not join expedition" });
  }
});

// Leave expedition
router.post("/:id/leave", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const expeditionId = parseInt(req.params.id);
  
  try {
    const expedition = await prisma.expedition.findUnique({
      where: { id: expeditionId },
      select: { creatorId: true }
    });

    if (expedition?.creatorId === userId) {
      return res.status(400).json({ error: "Creator cannot leave expedition. Cancel expedition instead." });
    }

    await prisma.expeditionMember.delete({
      where: {
        expeditionId_userId: {
          expeditionId,
          userId,
        }
      }
    });

    res.json({ message: "Left expedition successfully" });
  } catch (error) {
    console.error("Error leaving expedition:", error);
    res.status(500).json({ error: "Could not leave expedition" });
  }
});

// Confirm/reject expedition member (creator only)
router.post("/:id/members/:memberId/status", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const expeditionId = parseInt(req.params.id);
  const memberId = parseInt(req.params.memberId);
  const { status } = req.body;
  
  if (!["confirmed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  
  try {
    const expedition = await prisma.expedition.findFirst({
      where: {
        id: expeditionId,
        creatorId: userId,
      }
    });

    if (!expedition) {
      return res.status(404).json({ error: "Expedition not found or no permission" });
    }

    const updatedMember = await prisma.expeditionMember.update({
      where: {
        expeditionId_userId: {
          expeditionId,
          userId: memberId,
        }
      },
      data: { status },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        }
      }
    });

    res.json(updatedMember);
  } catch (error) {
    console.error("Error updating member status:", error);
    res.status(500).json({ error: "Could not update member status" });
  }
});

// Get expedition messages
router.get("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const expeditionId = parseInt(req.params.id);
  
  try {
    // Check if user is member
    const member = await prisma.expeditionMember.findUnique({
      where: {
        expeditionId_userId: {
          expeditionId,
          userId,
        }
      }
    });

    if (!member) {
      return res.status(403).json({ error: "Not an expedition member" });
    }

    const messages = await prisma.message.findMany({
      where: { expeditionId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: 100
    });

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Could not fetch messages" });
  }
});

// Send message to expedition
router.post("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const expeditionId = parseInt(req.params.id);
  const { content } = req.body;
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: "Message content required" });
  }
  
  try {
    // Check if user is member
    const member = await prisma.expeditionMember.findUnique({
      where: {
        expeditionId_userId: {
          expeditionId,
          userId,
        }
      }
    });

    if (!member) {
      return res.status(403).json({ error: "Not an expedition member" });
    }

    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        authorId: userId,
        expeditionId,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          }
        }
      }
    });

    res.status(201).json(message);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Could not send message" });
  }
});

export default router;