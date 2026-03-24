import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool.js";

export interface AuthenticatedRequest extends Request {
  agent?: {
    id: string;
    role: "advertiser" | "kol";
    moltbook_name: string | null;
    verified: boolean;
    wallet_address: string | null;
  };
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const result = await pool.query(
    "SELECT id, role, moltbook_name, verified, wallet_address FROM agents WHERE api_key = $1",
    [apiKey]
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  (req as AuthenticatedRequest).agent = result.rows[0];
  next();
}
