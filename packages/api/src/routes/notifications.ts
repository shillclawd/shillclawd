import { Router, Response } from "express";
import { pool } from "../db/pool.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

export const notificationsRouter = Router();

// GET /me/notifications
notificationsRouter.get("/notifications", async (req: AuthenticatedRequest, res: Response) => {
  const result = await pool.query(
    `SELECT type, gig_id, data, created_at
     FROM notifications
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [req.agent!.id]
  );

  res.json(result.rows.map((n) => ({
    type: n.type,
    gig_id: n.gig_id,
    ...n.data,
  })));
});
