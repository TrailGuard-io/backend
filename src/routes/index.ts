import express from "express";
import authRoutes from "./auth";
import userRoutes from "./user";
import rescueRoutes from "./rescue";
import teamRoutes from "./team";
import expeditionRoutes from "./expedition";
import subscriptionRoutes from "./subscription";
import flagRoutes from "./flags";
import notificationRoutes from "./notifications";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/rescue", rescueRoutes);
router.use("/teams", teamRoutes);
router.use("/expeditions", expeditionRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/flags", flagRoutes);
router.use("/notifications", notificationRoutes);

export default router;
