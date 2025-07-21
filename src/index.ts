import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth"; // si tenés rutas
import userRoutes from "./routes/user"; // si tenés rutas
import rescueRoutes from "./routes/rescue";

dotenv.config();

const app = express(); // 👈 ESTA línea debe estar antes de usar app

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes); // rutas si tenés
app.use("/user", userRoutes); // rutas si tenés
app.use("/rescue", rescueRoutes); // rutas si tenés

app.get("/", (_req, res) => {
  res.send("TrailGuard API running");
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
