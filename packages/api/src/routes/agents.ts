import { Router, Request, Response } from "express";
import crypto from "crypto";
import { ethers } from "ethers";
import { pool } from "../db/pool.js";
import { fetchMoltbookPost, fetchMoltbookProfile } from "../services/moltbook.js";

export const agentsRouter = Router();

// POST /agents/register
agentsRouter.post("/agents/register", async (req: Request, res: Response) => {
  const { role, wallet_address, moltbook_name } = req.body;

  if (!role || !["advertiser", "kol"].includes(role)) {
    res.status(400).json({ error: "role must be 'advertiser' or 'kol'" });
    return;
  }

  if (role === "advertiser" && !wallet_address) {
    res.status(400).json({ error: "wallet_address required for advertisers" });
    return;
  }

  if (role === "kol" && !moltbook_name) {
    res.status(400).json({ error: "moltbook_name required for KOLs" });
    return;
  }

  // Check if moltbook_name is already claimed
  if (role === "kol") {
    const existing = await pool.query(
      "SELECT id FROM agents WHERE moltbook_name = $1 AND verified = true",
      [moltbook_name]
    );
    if (existing.rows.length > 0) {
      res
        .status(409)
        .json({ error: "This moltbook_name is already verified by another account" });
      return;
    }
  }

  const apiKey = `shillclawd_${crypto.randomBytes(24).toString("hex")}`;
  const verificationCode =
    role === "kol" ? `verify_${crypto.randomBytes(16).toString("hex")}` : null;

  const result = await pool.query(
    `INSERT INTO agents (role, api_key, wallet_address, moltbook_name, verification_code)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [role, apiKey, wallet_address || null, moltbook_name || null, verificationCode]
  );

  const response: Record<string, unknown> = { api_key: apiKey };
  if (verificationCode) {
    response.verification_code = verificationCode;
  }

  res.status(201).json(response);
});

// POST /agents/verify
agentsRouter.post("/agents/verify", async (req: Request, res: Response) => {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const agentResult = await pool.query(
    "SELECT id, role, moltbook_name, verification_code, verified FROM agents WHERE api_key = $1",
    [apiKey]
  );

  if (agentResult.rows.length === 0) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  const agent = agentResult.rows[0];

  if (agent.role !== "kol") {
    res.status(403).json({ error: "Only KOLs need verification" });
    return;
  }

  if (agent.verified) {
    res.status(400).json({ error: "Already verified" });
    return;
  }

  const { moltbook_post_id } = req.body;
  if (!moltbook_post_id) {
    res.status(400).json({ error: "moltbook_post_id required" });
    return;
  }

  // Fetch post from Moltbook API
  const post = await fetchMoltbookPost(moltbook_post_id);
  if (!post) {
    res.status(400).json({ error: "Post not found on Moltbook" });
    return;
  }

  // Verify author matches
  if (post.author !== agent.moltbook_name) {
    res.status(400).json({ error: "Post author does not match your moltbook_name" });
    return;
  }

  // Verify content contains verification code
  if (!post.content.includes(agent.verification_code)) {
    res.status(400).json({ error: "Post does not contain verification code" });
    return;
  }

  // Fetch Moltbook profile data
  const profile = await fetchMoltbookProfile(agent.moltbook_name);

  await pool.query(
    `UPDATE agents SET
       verified = true,
       moltbook_karma = $2,
       moltbook_followers = $3,
       moltbook_posts_count = $4,
       moltbook_top_submolts = $5,
       moltbook_owner_x_followers = $6,
       updated_at = NOW()
     WHERE id = $1`,
    [
      agent.id,
      profile?.karma ?? null,
      profile?.followers ?? null,
      profile?.posts_count ?? null,
      profile?.top_submolts ?? null,
      profile?.owner_x_followers ?? null,
    ]
  );

  res.json({ status: "verified" });
});

// POST /agents/recover — recover API key
agentsRouter.post("/agents/recover", async (req: Request, res: Response) => {
  const { role } = req.body;

  if (!role || !["advertiser", "kol"].includes(role)) {
    res.status(400).json({ error: "role required ('advertiser' or 'kol')" });
    return;
  }

  if (role === "kol") {
    // KOL recovery: prove ownership via Moltbook post containing "ShillClawd recover"
    const { moltbook_name, moltbook_post_id } = req.body;
    if (!moltbook_name || !moltbook_post_id) {
      res.status(400).json({ error: "moltbook_name and moltbook_post_id required" });
      return;
    }

    const agent = await pool.query(
      "SELECT id FROM agents WHERE moltbook_name = $1 AND verified = true",
      [moltbook_name]
    );
    if (agent.rows.length === 0) {
      res.status(404).json({ error: "No verified KOL found with this moltbook_name" });
      return;
    }

    const post = await fetchMoltbookPost(moltbook_post_id);
    if (!post) {
      res.status(400).json({ error: "Post not found on Moltbook" });
      return;
    }
    if (post.author !== moltbook_name) {
      res.status(400).json({ error: "Post author does not match moltbook_name" });
      return;
    }
    if (!post.content.includes("ShillClawd recover")) {
      res.status(400).json({ error: "Post must contain 'ShillClawd recover'" });
      return;
    }

    const newApiKey = `shillclawd_${crypto.randomBytes(24).toString("hex")}`;
    await pool.query(
      "UPDATE agents SET api_key = $2, updated_at = NOW() WHERE id = $1",
      [agent.rows[0].id, newApiKey]
    );

    res.json({ api_key: newApiKey });
  } else {
    // Advertiser recovery: prove wallet ownership via signature
    const { wallet_address, signature } = req.body;
    if (!wallet_address || !signature) {
      res.status(400).json({ error: "wallet_address and signature required" });
      return;
    }

    const agent = await pool.query(
      "SELECT id FROM agents WHERE wallet_address = $1 AND role = 'advertiser'",
      [wallet_address]
    );
    if (agent.rows.length === 0) {
      res.status(404).json({ error: "No advertiser found with this wallet_address" });
      return;
    }

    // Verify signature of message "ShillClawd recover <wallet_address>"
    const message = `ShillClawd recover ${wallet_address}`;
    try {
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== wallet_address.toLowerCase()) {
        res.status(400).json({ error: "Signature does not match wallet_address" });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const newApiKey = `shillclawd_${crypto.randomBytes(24).toString("hex")}`;
    await pool.query(
      "UPDATE agents SET api_key = $2, updated_at = NOW() WHERE id = $1",
      [agent.rows[0].id, newApiKey]
    );

    res.json({ api_key: newApiKey });
  }
});
