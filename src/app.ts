import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import routes from "./routes";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", routes);
if (process.env.VERCEL) {
  app.use("/", routes);
}

app.get("/", (_req, res) => {
  res.send("TrailGuard API running");
});

export default app;
