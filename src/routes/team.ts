import express from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { z } from "zod";

const router = express.Router();
const prisma = new PrismaClient();

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  isPublic: z.boolean().default(true),
  maxMembers: z.number().min(2).max(50).default(10),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
  maxMembers: z.number().min(2).max(50).optional(),
});

// Create team (Premium feature)
router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionType: true }
    });

    if (user?.subscriptionType === "free") {
      return res.status(403).json({ error: "Premium subscription required to create teams" });
    }

    const validatedData = createTeamSchema.parse(req.body);
    
    const team = await prisma.team.create({
      data: {
        ...validatedData,
        ownerId: userId,
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
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

    // Add owner as admin member
    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: userId,
        role: "admin",
      }
    });

    res.status(201).json(team);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error creating team:", error);
    res.status(500).json({ error: "Could not create team" });
  }
});

// Get all public teams + user's teams
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  
  try {
    const teams = await prisma.team.findMany({
      where: {
        OR: [
          { isPublic: true },
          { members: { some: { userId } } }
        ]
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            members: true,
            expeditions: true,
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(teams);
  } catch (error) {
    console.error("Error fetching teams:", error);
    res.status(500).json({ error: "Could not fetch teams" });
  }
});

// Get team by ID
router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const teamId = parseInt(req.params.id);
  
  try {
    const team = await prisma.team.findFirst({
      where: {
        id: teamId,
        OR: [
          { isPublic: true },
          { members: { some: { userId } } }
        ]
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
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
        },
        expeditions: {
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                avatar: true,
              }
            },
            _count: {
              select: { members: true }
            }
          },
          orderBy: { startDate: "desc" }
        }
      }
    });

    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    res.json(team);
  } catch (error) {
    console.error("Error fetching team:", error);
    res.status(500).json({ error: "Could not fetch team" });
  }
});

// Update team (only owner/admin)
router.put("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const teamId = parseInt(req.params.id);
  
  try {
    const teamMember = await prisma.teamMember.findFirst({
      where: {
        teamId,
        userId,
        OR: [
          { role: "admin" },
          { team: { ownerId: userId } }
        ]
      }
    });

    if (!teamMember) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const validatedData = updateTeamSchema.parse(req.body);
    
    const team = await prisma.team.update({
      where: { id: teamId },
      data: validatedData,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            members: true,
            expeditions: true,
          }
        }
      }
    });

    res.json(team);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error updating team:", error);
    res.status(500).json({ error: "Could not update team" });
  }
});

// Join team
router.post("/:id/join", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const teamId = parseInt(req.params.id);
  
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionType: true },
    });

    if (user?.subscriptionType === "free") {
      return res
        .status(403)
        .json({ error: "Premium subscription required to join teams" });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        _count: {
          select: { members: true }
        }
      }
    });

    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    if (!team.isPublic) {
      return res.status(403).json({ error: "Team is private" });
    }

    if (team._count.members >= team.maxMembers) {
      return res.status(400).json({ error: "Team is full" });
    }

    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        }
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: "Already a member" });
    }

    const membership = await prisma.teamMember.create({
      data: {
        teamId,
        userId,
        role: "member",
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
    console.error("Error joining team:", error);
    res.status(500).json({ error: "Could not join team" });
  }
});

// Leave team
router.post("/:id/leave", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const teamId = parseInt(req.params.id);
  
  try {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { ownerId: true }
    });

    if (team?.ownerId === userId) {
      return res.status(400).json({ error: "Owner cannot leave team. Transfer ownership first." });
    }

    const deleted = await prisma.teamMember.delete({
      where: {
        teamId_userId: {
          teamId,
          userId,
        }
      }
    });

    res.json({ message: "Left team successfully" });
  } catch (error) {
    console.error("Error leaving team:", error);
    res.status(500).json({ error: "Could not leave team" });
  }
});

// Get team messages
router.get("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const teamId = parseInt(req.params.id);
  
  try {
    // Check if user is member
    const member = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        }
      }
    });

    if (!member) {
      return res.status(403).json({ error: "Not a team member" });
    }

    const messages = await prisma.message.findMany({
      where: { teamId },
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

// Send message to team
router.post("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const teamId = parseInt(req.params.id);
  const { content } = req.body;
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: "Message content required" });
  }
  
  try {
    // Check if user is member
    const member = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        }
      }
    });

    if (!member) {
      return res.status(403).json({ error: "Not a team member" });
    }

    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        authorId: userId,
        teamId,
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
