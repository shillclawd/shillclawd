import "dotenv/config";
import express from "express";
import { agentsRouter } from "./routes/agents.js";
import { gigsRouter } from "./routes/gigs.js";
import { notificationsRouter } from "./routes/notifications.js";
import { ratingsRouter } from "./routes/ratings.js";
import { authMiddleware } from "./middleware/auth.js";
import { startCronJobs } from "./cron/jobs.js";

const app = express();
app.use(express.json());

// Public routes
app.post("/agents/register", agentsRouter);
app.post("/agents/verify", agentsRouter);

// Authenticated routes
app.use(authMiddleware);
app.use("/gigs", gigsRouter);
app.use("/me", notificationsRouter);
app.use(ratingsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ShillClawd API running on port ${PORT}`);
  startCronJobs();
});

export default app;
