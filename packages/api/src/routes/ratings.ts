import { Router, Response } from "express";
import { pool } from "../db/pool.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

export const ratingsRouter = Router();

// POST /gigs/:id/rate - Rate a completed gig (advertiser only, after review_deadline)
ratingsRouter.post("/gigs/:id/rate", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can rate" });
    return;
  }

  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be between 1 and 5" });
    return;
  }

  const gigResult = await pool.query(
    "SELECT * FROM gigs WHERE id = $1",
    [req.params.id]
  );

  if (gigResult.rows.length === 0) {
    res.status(404).json({ error: "Gig not found" });
    return;
  }

  const gig = gigResult.rows[0];

  if (gig.advertiser_id !== req.agent!.id) {
    res.status(403).json({ error: "Not your gig" });
    return;
  }

  if (new Date() < new Date(gig.review_deadline)) {
    res.status(400).json({ error: "Rating available after review_deadline" });
    return;
  }

  if (!gig.selected_kol_id) {
    res.status(400).json({ error: "No KOL was selected for this gig" });
    return;
  }

  // Check for existing rating
  const existing = await pool.query(
    "SELECT id FROM ratings WHERE gig_id = $1",
    [req.params.id]
  );

  if (existing.rows.length > 0) {
    res.status(409).json({ error: "Rating already exists. Use PUT to update." });
    return;
  }

  await pool.query(
    `INSERT INTO ratings (gig_id, advertiser_id, kol_id, rating, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, req.agent!.id, gig.selected_kol_id, rating, comment || null]
  );

  res.status(201).json({ status: "rated" });
});

// PUT /gigs/:id/rate - Update rating (editable forever)
ratingsRouter.put("/gigs/:id/rate", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can rate" });
    return;
  }

  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be between 1 and 5" });
    return;
  }

  const gigResult = await pool.query(
    "SELECT advertiser_id FROM gigs WHERE id = $1",
    [req.params.id]
  );

  if (gigResult.rows.length === 0) {
    res.status(404).json({ error: "Gig not found" });
    return;
  }

  if (gigResult.rows[0].advertiser_id !== req.agent!.id) {
    res.status(403).json({ error: "Not your gig" });
    return;
  }

  const result = await pool.query(
    `UPDATE ratings SET rating = $2, comment = $3, updated_at = NOW()
     WHERE gig_id = $1
     RETURNING id`,
    [req.params.id, rating, comment || null]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: "No existing rating to update" });
    return;
  }

  res.json({ status: "updated" });
});
