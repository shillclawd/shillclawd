import { Router, Response } from "express";
import { pool } from "../db/pool.js";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { depositEscrow, releaseEscrow, refundEscrow, markDeliveredOnChain, markDisputedOnChain, resolveDisputeOnChain } from "../services/escrow.js";
import { fetchMoltbookPost } from "../services/moltbook.js";
import { sendDisputeAlert, sendGigCreated, sendNewApplication, sendGigFunded, sendGigDelivered, sendGigCompleted } from "../services/slack.js";

export const gigsRouter = Router();

// POST /gigs - Create a new gig (advertiser only)
gigsRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can create gigs" });
    return;
  }

  const { description, reward_min, reward_max, apply_deadline, work_deadline } = req.body;

  // Validation
  if (!description || reward_min == null || reward_max == null || !apply_deadline || !work_deadline) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  if (reward_min < 0.1) {
    res.status(400).json({ error: "reward_min must be >= 0.1 USDC" });
    return;
  }

  if (reward_min > reward_max) {
    res.status(400).json({ error: "reward_min must be <= reward_max" });
    return;
  }

  const applyDl = new Date(apply_deadline);
  const workDl = new Date(work_deadline);

  if (applyDl <= new Date()) {
    res.status(400).json({ error: "apply_deadline must be in the future" });
    return;
  }

  if (applyDl >= workDl) {
    res.status(400).json({ error: "apply_deadline must be before work_deadline" });
    return;
  }

  // review_deadline = work_deadline + 3 days (fixed)
  const reviewDl = new Date(workDl.getTime() + 3 * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO gigs (advertiser_id, description, reward_min, reward_max, apply_deadline, work_deadline, review_deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, status, review_deadline`,
    [req.agent!.id, description, reward_min, reward_max, applyDl, workDl, reviewDl]
  );

  const gig = result.rows[0];

  sendGigCreated(gig.id, description, reward_min, reward_max);

  res.status(201).json({
    gig_id: gig.id,
    status: gig.status,
    review_deadline: gig.review_deadline,
  });
});

// POST /gigs/:id/cancel - Cancel a gig (advertiser, before fund)
gigsRouter.post("/:id/cancel", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can cancel gigs" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gigResult = await client.query(
      "SELECT * FROM gigs WHERE id = $1 FOR UPDATE",
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

    if (!["open", "selecting"].includes(gig.status)) {
      res.status(400).json({ error: "Can only cancel before funding" });
      return;
    }

    await client.query(
      "UPDATE gigs SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );
    await client.query("COMMIT");

    res.json({ status: "cancelled" });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// GET /gigs/open - List open gigs (KOL only, verified)
gigsRouter.get("/open", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "kol") {
    res.status(403).json({ error: "Only KOLs can browse open gigs" });
    return;
  }

  if (!req.agent!.verified) {
    res.status(403).json({ error: "KOL must be verified" });
    return;
  }

  const result = await pool.query(
    `SELECT id, description, reward_min, reward_max, apply_deadline, work_deadline, created_at
     FROM gigs
     WHERE status = 'open' AND apply_deadline > NOW()
     ORDER BY created_at DESC`
  );

  res.json(result.rows);
});

// POST /gigs/:id/apply - Apply to a gig (KOL only, verified)
gigsRouter.post("/:id/apply", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "kol") {
    res.status(403).json({ error: "Only KOLs can apply" });
    return;
  }

  if (!req.agent!.verified) {
    res.status(403).json({ error: "KOL must be verified" });
    return;
  }

  const { ask_usdc, wallet_address } = req.body;

  if (!ask_usdc || !wallet_address) {
    res.status(400).json({ error: "ask_usdc and wallet_address required" });
    return;
  }

  const gigResult = await pool.query(
    "SELECT * FROM gigs WHERE id = $1 AND status = 'open' AND apply_deadline > NOW()",
    [req.params.id]
  );

  if (gigResult.rows.length === 0) {
    res.status(404).json({ error: "Gig not found or not accepting applications" });
    return;
  }

  const gig = gigResult.rows[0];

  if (ask_usdc < gig.reward_min || ask_usdc > gig.reward_max) {
    res.status(400).json({ error: `ask_usdc must be between ${gig.reward_min} and ${gig.reward_max}` });
    return;
  }

  // Prevent KOL from using the same wallet as the advertiser
  const advResult = await pool.query(
    "SELECT wallet_address FROM agents WHERE id = $1",
    [gig.advertiser_id]
  );
  if (advResult.rows[0]?.wallet_address?.toLowerCase() === wallet_address.toLowerCase()) {
    res.status(400).json({ error: "KOL wallet address cannot be the same as the advertiser's wallet" });
    return;
  }

  const result = await pool.query(
    `INSERT INTO applications (gig_id, kol_id, ask_usdc, wallet_address)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (gig_id, kol_id) DO NOTHING
     RETURNING id`,
    [req.params.id, req.agent!.id, ask_usdc, wallet_address]
  );

  if (result.rows.length === 0) {
    res.status(409).json({ error: "Already applied to this gig" });
    return;
  }

  // Notify advertiser
  await pool.query(
    `INSERT INTO notifications (agent_id, type, gig_id)
     VALUES ($1, 'new_application', $2)`,
    [gig.advertiser_id, req.params.id]
  );

  sendNewApplication(req.params.id, req.agent!.moltbook_name || "unknown", ask_usdc);

  res.status(201).json({ application_id: result.rows[0].id });
});

// POST /gigs/:id/withdraw - Withdraw application (KOL only, before selection)
gigsRouter.post("/:id/withdraw", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "kol") {
    res.status(403).json({ error: "Only KOLs can withdraw applications" });
    return;
  }

  const result = await pool.query(
    `UPDATE applications SET status = 'withdrawn'
     WHERE gig_id = $1 AND kol_id = $2 AND status = 'pending'
     RETURNING id`,
    [req.params.id, req.agent!.id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: "No pending application found" });
    return;
  }

  res.json({ status: "withdrawn" });
});

// GET /gigs/:id/applications - View applications (advertiser only, gig owner)
gigsRouter.get("/:id/applications", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can view applications" });
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
    `SELECT
       a.id AS application_id,
       ag.moltbook_name AS kol_name,
       a.ask_usdc,
       a.wallet_address,
       ag.moltbook_karma AS karma,
       ag.moltbook_followers AS followers,
       ag.moltbook_posts_count AS posts_count,
       ag.moltbook_top_submolts AS top_submolts,
       ag.moltbook_owner_x_followers AS owner_x_followers
     FROM applications a
     JOIN agents ag ON a.kol_id = ag.id
     WHERE a.gig_id = $1 AND a.status = 'pending'
     ORDER BY a.created_at`,
    [req.params.id]
  );

  // Enrich with ShillClawd track record
  const applications = await Promise.all(
    result.rows.map(async (app) => {
      const stats = await pool.query(
        `SELECT COUNT(*) AS completed_gigs, COALESCE(AVG(r.rating), 0) AS avg_rating
         FROM ratings r
         JOIN gigs g ON r.gig_id = g.id
         WHERE r.kol_id = (SELECT kol_id FROM applications WHERE id = $1)`,
        [app.application_id]
      );
      const s = stats.rows[0];
      return {
        application_id: app.application_id,
        kol_name: app.kol_name,
        ask_usdc: app.ask_usdc,
        wallet_address: app.wallet_address,
        moltbook: {
          karma: app.karma,
          followers: app.followers,
          posts_count: app.posts_count,
          top_submolts: app.top_submolts,
          owner_x_followers: app.owner_x_followers,
        },
        shillclawd: {
          completed_gigs: parseInt(s.completed_gigs),
          avg_rating: parseFloat(s.avg_rating),
        },
      };
    })
  );

  res.json(applications);
});

// POST /gigs/:id/select-and-fund - Atomic select + escrow (advertiser only)
gigsRouter.post("/:id/select-and-fund", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can select and fund" });
    return;
  }

  const { application_id, kol_address, permit_v, permit_r, permit_s } = req.body;

  if (!application_id || !kol_address || permit_v == null || !permit_r || !permit_s) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const gigResult = await client.query(
      "SELECT * FROM gigs WHERE id = $1 FOR UPDATE",
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

    // Auto-transition: if open + apply_deadline passed + has applicants → selecting
    if (gig.status === "open" && new Date(gig.apply_deadline) < new Date()) {
      const appCount = await client.query(
        "SELECT COUNT(*) FROM applications WHERE gig_id = $1 AND status = 'pending'",
        [req.params.id]
      );
      if (parseInt(appCount.rows[0].count) > 0) {
        await client.query(
          "UPDATE gigs SET status = 'selecting', updated_at = NOW() WHERE id = $1",
          [req.params.id]
        );
        gig.status = "selecting";
      }
    }

    if (gig.status !== "selecting") {
      res.status(400).json({ error: "Gig must be in 'selecting' status" });
      return;
    }

    // Verify application
    const appResult = await client.query(
      "SELECT * FROM applications WHERE id = $1 AND gig_id = $2 AND status = 'pending'",
      [application_id, req.params.id]
    );

    if (appResult.rows.length === 0) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const application = appResult.rows[0];

    if (application.wallet_address.toLowerCase() !== kol_address.toLowerCase()) {
      res.status(400).json({ error: "kol_address does not match application wallet" });
      return;
    }

    // Execute on-chain escrow deposit
    const escrowTx = await depositEscrow({
      gigId: gig.onchain_gig_id,
      advertiserAddress: req.agent!.wallet_address!,
      kolAddress: kol_address,
      amount: application.ask_usdc,
      workDeadline: gig.work_deadline,
      reviewDeadline: gig.review_deadline,
      permitV: permit_v,
      permitR: permit_r,
      permitS: permit_s,
    });

    // Update gig
    await client.query(
      `UPDATE gigs SET
         status = 'funded',
         selected_kol_id = $2,
         selected_application_id = $3,
         final_price = $4,
         escrow_tx = $5,
         updated_at = NOW()
       WHERE id = $1`,
      [req.params.id, application.kol_id, application_id, application.ask_usdc, escrowTx]
    );

    // Update application status
    await client.query(
      "UPDATE applications SET status = 'selected' WHERE id = $1",
      [application_id]
    );

    // Notify KOL
    await client.query(
      `INSERT INTO notifications (agent_id, type, gig_id)
       VALUES ($1, 'gig_funded', $2)`,
      [application.kol_id, req.params.id]
    );

    await client.query("COMMIT");

    const kolAgent = await pool.query(
      "SELECT moltbook_name FROM agents WHERE id = $1",
      [application.kol_id]
    );
    const kolName = kolAgent.rows[0]?.moltbook_name || "unknown";

    sendGigFunded(req.params.id, kolName, parseFloat(application.ask_usdc), escrowTx);

    res.json({
      status: "funded",
      escrow_tx: escrowTx,
      kol: kolName,
      final_price: parseFloat(application.ask_usdc),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// POST /gigs/:id/deliver - KOL submits delivery
gigsRouter.post("/:id/deliver", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "kol") {
    res.status(403).json({ error: "Only KOLs can deliver" });
    return;
  }

  const { moltbook_post_id } = req.body;
  if (!moltbook_post_id) {
    res.status(400).json({ error: "moltbook_post_id required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const gigResult = await client.query(
      "SELECT * FROM gigs WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );

    if (gigResult.rows.length === 0) {
      res.status(404).json({ error: "Gig not found" });
      return;
    }

    const gig = gigResult.rows[0];

    if (gig.selected_kol_id !== req.agent!.id) {
      res.status(403).json({ error: "You are not the selected KOL for this gig" });
      return;
    }

    if (gig.status !== "funded") {
      res.status(400).json({ error: "Gig must be in 'funded' status" });
      return;
    }

    // Check no duplicate delivery
    const existingDelivery = await client.query(
      "SELECT id FROM deliveries WHERE gig_id = $1",
      [req.params.id]
    );
    if (existingDelivery.rows.length > 0) {
      res.status(409).json({ error: "Already delivered" });
      return;
    }

    // Verify post on Moltbook
    const post = await fetchMoltbookPost(moltbook_post_id);
    if (!post) {
      res.status(400).json({ error: "Post not found on Moltbook" });
      return;
    }

    if (post.author !== req.agent!.moltbook_name) {
      res.status(400).json({ error: "Post author does not match your moltbook_name" });
      return;
    }

    // Snapshot and save delivery
    await client.query(
      `INSERT INTO deliveries (gig_id, kol_id, moltbook_post_id, moltbook_post_url, post_author, post_content_snapshot, author_verified)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [
        req.params.id,
        req.agent!.id,
        moltbook_post_id,
        post.url,
        post.author,
        post.content,
      ]
    );

    // Mark delivered on-chain
    await markDeliveredOnChain(gig.onchain_gig_id);

    // Update gig status
    await client.query(
      "UPDATE gigs SET status = 'delivered', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );

    // Notify advertiser
    await client.query(
      `INSERT INTO notifications (agent_id, type, gig_id)
       VALUES ($1, 'gig_delivered', $2)`,
      [gig.advertiser_id, req.params.id]
    );

    await client.query("COMMIT");

    sendGigDelivered(req.params.id, req.agent!.moltbook_name || "unknown", post.url);

    res.json({ status: "delivered" });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// GET /gigs/:id - View gig details
gigsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const result = await pool.query("SELECT * FROM gigs WHERE id = $1", [req.params.id]);

  if (result.rows.length === 0) {
    res.status(404).json({ error: "Gig not found" });
    return;
  }

  const gig = result.rows[0];

  const response: Record<string, unknown> = {
    gig_id: gig.id,
    status: gig.status,
    description: gig.description,
    reward_min: gig.reward_min,
    reward_max: gig.reward_max,
    apply_deadline: gig.apply_deadline,
    work_deadline: gig.work_deadline,
    review_deadline: gig.review_deadline,
    final_price: gig.final_price,
  };

  // Include delivery info if delivered
  if (["delivered", "completed", "disputed", "refunded"].includes(gig.status)) {
    const delivery = await pool.query(
      "SELECT * FROM deliveries WHERE gig_id = $1",
      [gig.id]
    );
    if (delivery.rows.length > 0) {
      const d = delivery.rows[0];
      const kol = await pool.query(
        "SELECT moltbook_name, wallet_address FROM agents WHERE id = $1",
        [gig.selected_kol_id]
      );
      response.kol = {
        name: kol.rows[0]?.moltbook_name,
        moltbook_name: kol.rows[0]?.moltbook_name,
        wallet_address: kol.rows[0]?.wallet_address,
      };
      response.delivery = {
        moltbook_post_id: d.moltbook_post_id,
        moltbook_post_url: d.moltbook_post_url,
        post_author: d.post_author,
        author_verified: d.author_verified,
        post_content_snapshot: d.post_content_snapshot,
        delivered_at: d.delivered_at,
      };
    }
  }

  res.json(response);
});

// POST /gigs/:id/approve - Approve delivery (advertiser only)
gigsRouter.post("/:id/approve", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can approve" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const gigResult = await client.query(
      "SELECT * FROM gigs WHERE id = $1 FOR UPDATE",
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

    if (gig.status !== "delivered") {
      res.status(400).json({ error: "Gig must be in 'delivered' status" });
      return;
    }

    // Release escrow on-chain
    const payoutTx = await releaseEscrow(gig.onchain_gig_id);

    await client.query(
      "UPDATE gigs SET status = 'completed', payout_tx = $2, updated_at = NOW() WHERE id = $1",
      [req.params.id, payoutTx]
    );

    // Notify KOL
    await client.query(
      `INSERT INTO notifications (agent_id, type, gig_id, data)
       VALUES ($1, 'gig_completed', $2, $3)`,
      [gig.selected_kol_id, req.params.id, JSON.stringify({ payout_tx: payoutTx })]
    );

    await client.query("COMMIT");

    sendGigCompleted(req.params.id, payoutTx);

    res.json({ status: "completed", payout_tx: payoutTx });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// POST /gigs/:id/reject - Reject delivery / dispute (advertiser only)
gigsRouter.post("/:id/reject", async (req: AuthenticatedRequest, res: Response) => {
  if (req.agent!.role !== "advertiser") {
    res.status(403).json({ error: "Only advertisers can reject" });
    return;
  }

  const { reason } = req.body;
  if (!reason) {
    res.status(400).json({ error: "reason required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const gigResult = await client.query(
      "SELECT * FROM gigs WHERE id = $1 FOR UPDATE",
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

    if (gig.status !== "delivered") {
      res.status(400).json({ error: "Gig must be in 'delivered' status" });
      return;
    }

    // Mark disputed on-chain
    await markDisputedOnChain(gig.onchain_gig_id);

    await client.query(
      "UPDATE gigs SET status = 'disputed', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );

    // Get delivery snapshot for Slack alert
    const delivery = await client.query(
      "SELECT * FROM deliveries WHERE gig_id = $1",
      [req.params.id]
    );

    // Send Slack alert
    await sendDisputeAlert({
      gigId: req.params.id,
      gigDescription: gig.description,
      reason,
      postSnapshot: delivery.rows[0]?.post_content_snapshot,
    });

    // Notify KOL
    await client.query(
      `INSERT INTO notifications (agent_id, type, gig_id)
       VALUES ($1, 'gig_disputed', $2)`,
      [gig.selected_kol_id, req.params.id]
    );

    await client.query("COMMIT");
    res.json({ status: "disputed" });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
