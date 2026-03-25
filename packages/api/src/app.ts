import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import rateLimit from "express-rate-limit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { agentsRouter } from "./routes/agents.js";
import { gigsRouter } from "./routes/gigs.js";
import { notificationsRouter } from "./routes/notifications.js";
import { ratingsRouter } from "./routes/ratings.js";
import { feedRouter } from "./routes/feed.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});
app.use(express.json());
if (process.env.NODE_ENV !== "test") {
  app.use(rateLimit({
    windowMs: 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  }));
}

// Static files
app.get("/skill.md", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../../../skill.md"));
});
app.get("/skill.json", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../../../skill.json"));
});

// Public routes
app.post("/agents/register", agentsRouter);
app.post("/agents/verify", agentsRouter);
app.post("/agents/recover", agentsRouter);
app.use("/feed", feedRouter);

// Authenticated routes
app.use(authMiddleware);
app.use("/gigs", gigsRouter);
app.use("/me", notificationsRouter);
app.use(ratingsRouter);

export default app;
