import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: Express.User;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token faltante o mal formado" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: number | string;
      email: string;
      role?: string;
    };

    const id =
      typeof decoded.id === "string" ? Number(decoded.id) : decoded.id;

    if (!id || Number.isNaN(id)) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }

    req.user = {
      id,
      email: decoded.email,
      role: decoded.role ?? "user",
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}
