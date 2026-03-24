import express from "express";
import { agentsRouter } from "./routes/agents.js";
import { gigsRouter } from "./routes/gigs.js";
import { notificationsRouter } from "./routes/notifications.js";
import { ratingsRouter } from "./routes/ratings.js";
import { feedRouter } from "./routes/feed.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();
app.use(express.json());

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
