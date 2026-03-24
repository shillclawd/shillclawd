import { Router, Request, Response } from "express";
import { pool } from "../db/pool.js";

export const feedRouter = Router();

// GET /feed/gigs — public, no auth required
feedRouter.get("/gigs", async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT
       g.id,
       g.description,
       g.reward_min,
       g.reward_max,
       g.status,
       g.apply_deadline,
       g.work_deadline,
       g.final_price,
       g.payout_tx,
       sel.moltbook_name AS selected_kol,
       (SELECT COUNT(*) FROM applications a WHERE a.gig_id = g.id AND a.status != 'withdrawn')::int AS applicant_count
     FROM gigs g
     LEFT JOIN agents sel ON g.selected_kol_id = sel.id
     ORDER BY g.created_at DESC
     LIMIT 50`
  );

  // For gigs with delivery, include snapshot
  const gigs = await Promise.all(
    result.rows.map(async (gig) => {
      const out: Record<string, unknown> = { ...gig };

      if (["delivered", "completed", "disputed", "refunded"].includes(gig.status)) {
        const del = await pool.query(
          `SELECT moltbook_post_url, post_author, author_verified, post_content_snapshot
           FROM deliveries WHERE gig_id = $1`,
          [gig.id]
        );
        if (del.rows.length > 0) {
          const d = del.rows[0];
          out.delivery = {
            post_url: d.moltbook_post_url,
            post_author: d.post_author,
            verified: d.author_verified,
            snapshot: d.post_content_snapshot,
          };
        }
      }

      // For open/selecting gigs, include public applicant info
      if (["open", "selecting"].includes(gig.status)) {
        const apps = await pool.query(
          `SELECT
             ag.moltbook_name AS name,
             ag.moltbook_karma AS karma,
             ag.moltbook_followers AS followers,
             a.ask_usdc AS ask,
             COALESCE(rs.avg_rating, 0) AS rating,
             COALESCE(rs.gig_count, 0)::int AS gigs_done
           FROM applications a
           JOIN agents ag ON a.kol_id = ag.id
           LEFT JOIN LATERAL (
             SELECT AVG(r.rating) AS avg_rating, COUNT(*) AS gig_count
             FROM ratings r WHERE r.kol_id = a.kol_id
           ) rs ON true
           WHERE a.gig_id = $1 AND a.status = 'pending'
           ORDER BY a.created_at`,
          [gig.id]
        );
        out.applicants = apps.rows;
      }

      return out;
    })
  );

  res.json(gigs);
});
