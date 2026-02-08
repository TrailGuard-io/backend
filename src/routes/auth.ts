import express from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import passport from "passport";

const router = express.Router();
const prisma = new PrismaClient();
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const auth = passport.authenticate.bind(passport) as unknown as (
  strategy: string,
  options?: any,
  callback?: any
) => any;

const redirectWithError = (res: express.Response, message: string) => {
  const url = new URL(`${frontendUrl}/auth/callback`);
  url.searchParams.set("error", message);
  res.redirect(url.toString());
};

const redirectWithToken = (res: express.Response, token: string) => {
  const url = new URL(`${frontendUrl}/auth/callback`);
  url.searchParams.set("token", token);
  res.redirect(url.toString());
};

const ensureProviderEnabled = (provider: "google" | "facebook" | "apple") => {
  const enabled =
    (provider === "google" &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET) ||
    (provider === "facebook" &&
      process.env.FACEBOOK_CLIENT_ID &&
      process.env.FACEBOOK_CLIENT_SECRET) ||
    (provider === "apple" &&
      process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY);

  return (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!enabled) {
      return redirectWithError(res, `${provider}_not_configured`);
    }
    next();
  };
};

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2).max(80).optional(),
  acceptTerms: z.boolean().optional(),
  acceptPrivacy: z.boolean().optional(),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const { email, password, name } = parsed.data;
  const hashed = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { email, password: hashed, name },
    });
    res.status(201).json({ id: user.id, email: user.email });
  } catch (e) {
    res.status(500).json({ error: "Email ya registrado o error interno." });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Usuario no encontrado" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Contraseña incorrecta" });

  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

router.get(
  "/google",
  ensureProviderEnabled("google"),
  auth("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/google/callback",
  ensureProviderEnabled("google"),
  (req, res, next) => {
    auth("google", { session: false }, (err: any, user: any) => {
      if (err || !user) {
        return redirectWithError(res, err?.message || "google_login_failed");
      }
      const token = jwt.sign(
        { id: (user as any).id, email: (user as any).email },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );
      return redirectWithToken(res, token);
    })(req, res, next);
  }
);

router.get(
  "/facebook",
  ensureProviderEnabled("facebook"),
  auth("facebook", { scope: ["email"], session: false })
);

router.get(
  "/facebook/callback",
  ensureProviderEnabled("facebook"),
  (req, res, next) => {
    auth("facebook", { session: false }, (err: any, user: any) => {
      if (err || !user) {
        return redirectWithError(res, err?.message || "facebook_login_failed");
      }
      const token = jwt.sign(
        { id: (user as any).id, email: (user as any).email },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );
      return redirectWithToken(res, token);
    })(req, res, next);
  }
);

router.get(
  "/apple",
  ensureProviderEnabled("apple"),
  auth("apple", { session: false })
);

router.post(
  "/apple/callback",
  ensureProviderEnabled("apple"),
  (req, res) => {
    const url = new URL(`${process.env.BACKEND_URL || "http://localhost:3001"}/api/auth/apple/callback`);
    const { code, state, id_token, user } = req.body || {};
    if (code) url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    if (id_token) url.searchParams.set("id_token", id_token);
    if (user) url.searchParams.set("user", user);
    res.redirect(url.toString());
  }
);

router.get(
  "/apple/callback",
  ensureProviderEnabled("apple"),
  (req, res, next) => {
    auth("apple", { session: false }, (err: any, user: any) => {
      if (err || !user) {
        return redirectWithError(res, err?.message || "apple_login_failed");
      }
      const token = jwt.sign(
        { id: (user as any).id, email: (user as any).email },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );
      return redirectWithToken(res, token);
    })(req, res, next);
  }
);

router.post("/logout", (req, res) => {
  const finish = () => {
    res.clearCookie("connect.sid");
    res.json({ message: "logout_success" });
  };

  const destroySession = () => {
    const session = (req as any).session;
    if (session?.destroy) {
      session.destroy((err: any) => {
        if (err) {
          return res.status(500).json({ error: "logout_failed" });
        }
        finish();
      });
      return;
    }
    finish();
  };

  const logout = (req as any).logout;
  if (typeof logout === "function") {
    logout.call(req, (err: any) => {
      if (err) {
        return res.status(500).json({ error: "logout_failed" });
      }
      destroySession();
    });
  } else {
    destroySession();
  }
});

export default router;
