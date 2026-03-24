import express from "express";
import rateLimit from "express-rate-limit";
import { agentsRouter } from "./routes/agents.js";
import { gigsRouter } from "./routes/gigs.js";
import { notificationsRouter } from "./routes/notifications.js";
import { ratingsRouter } from "./routes/ratings.js";
import { feedRouter } from "./routes/feed.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(rateLimit({
  windowMs: 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
}));

// Public routes
app.post("/agents/register", agentsRouter);
app.post("/agents/verify", agentsRouter);
app.use("/feed", feedRouter);

// Authenticated routes
app.use(authMiddleware);
app.use("/gigs", gigsRouter);
app.use("/me", notificationsRouter);
app.use(ratingsRouter);

export default app;
