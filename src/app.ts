import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import passport from "./auth/passport";

import routes from "./routes";

dotenv.config();

const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const sessionOptions: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || "trailguard-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
};

if (process.env.REDIS_URL) {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (err) => {
    console.error("Redis session error:", err);
  });
  redisClient.connect().catch((err) => {
    console.error("Redis connection failed:", err);
  });
  sessionOptions.store = new RedisStore({
    client: redisClient,
    prefix: "trailguard:sess:",
  });
}

app.use(session(sessionOptions));
app.use(passport.initialize());

app.use("/api", routes);
if (process.env.VERCEL) {
  app.use("/", routes);
}

app.get("/", (_req, res) => {
  res.send("TrailGuard API running");
});

export default app;
