import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import routes from "./routes";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const apiBase = process.env.VERCEL ? "/" : "/api";
app.use(apiBase, routes);

app.get("/", (_req, res) => {
  res.send("TrailGuard API running");
});

export default app;
