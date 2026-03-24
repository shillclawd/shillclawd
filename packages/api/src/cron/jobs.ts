import cron from "node-cron";
import { pool } from "../db/pool.js";
import { releaseEscrow, refundEscrow, resolveDisputeOnChain } from "../services/escrow.js";

export function startCronJobs() {
  // Run all jobs every hour
  cron.schedule("0 * * * *", async () => {
    console.log("[cron] Running hourly jobs...");
    await Promise.allSettled([
      closeExpiredOpenGigs(),
      transitionToSelecting(),
      closeAbandonedSelectingGigs(),
      expireFundedGigs(),
      autoReleaseDeliveredGigs(),
      autoResolveDisputes(),
    ]);
    console.log("[cron] Hourly jobs complete.");
  });

  console.log("Cron jobs scheduled (hourly).");
}

// Job 1: open + apply_deadline passed + 0 applicants → closed
async function closeExpiredOpenGigs() {
  const result = await pool.query(
    `UPDATE gigs SET status = 'closed', updated_at = NOW()
     WHERE status = 'open'
       AND apply_deadline < NOW()
       AND id NOT IN (
         SELECT DISTINCT gig_id FROM applications WHERE status = 'pending'
       )
     RETURNING id`
  );
  if (result.rows.length > 0) {
    console.log(`[cron] Closed ${result.rows.length} gigs with no applicants`);
  }
}

// Job 2: open + apply_deadline passed + 1+ applicants → selecting
async function transitionToSelecting() {
  const result = await pool.query(
    `UPDATE gigs SET status = 'selecting', updated_at = NOW()
     WHERE status = 'open'
       AND apply_deadline < NOW()
       AND id IN (
         SELECT DISTINCT gig_id FROM applications WHERE status = 'pending'
       )
     RETURNING id`
  );
  if (result.rows.length > 0) {
    console.log(`[cron] Transitioned ${result.rows.length} gigs to selecting`);
  }
}

// Job 3: selecting + work_deadline passed + no fund → closed
async function closeAbandonedSelectingGigs() {
  const result = await pool.query(
    `UPDATE gigs SET status = 'closed', updated_at = NOW()
     WHERE status = 'selecting'
       AND work_deadline < NOW()
     RETURNING id`
  );
  if (result.rows.length > 0) {
    console.log(`[cron] Closed ${result.rows.length} abandoned selecting gigs`);
  }
}

// Job 4: funded + work_deadline passed + no deliver → expired (execute refund)
async function expireFundedGigs() {
  const gigs = await pool.query(
    `SELECT id, onchain_gig_id FROM gigs
     WHERE status = 'funded'
       AND work_deadline < NOW()
       AND id NOT IN (SELECT gig_id FROM deliveries)`
  );

  for (const gig of gigs.rows) {
    try {
      const refundTx = await refundEscrow(gig.onchain_gig_id);
      await pool.query(
        `UPDATE gigs SET status = 'expired', refund_tx = $2, updated_at = NOW() WHERE id = $1`,
        [gig.id, refundTx]
      );

      // Notify advertiser
      const gigData = await pool.query("SELECT advertiser_id FROM gigs WHERE id = $1", [gig.id]);
      await pool.query(
        `INSERT INTO notifications (agent_id, type, gig_id, data)
         VALUES ($1, 'gig_expired', $2, $3)`,
        [gigData.rows[0].advertiser_id, gig.id, JSON.stringify({ refund_tx: refundTx })]
      );

      console.log(`[cron] Expired and refunded gig ${gig.id}`);
    } catch (err) {
      console.error(`[cron] Failed to refund gig ${gig.id}:`, err);
    }
  }
}

// Job 5: delivered + review_deadline passed + no approve/reject → completed (execute release)
async function autoReleaseDeliveredGigs() {
  const gigs = await pool.query(
    `SELECT id, onchain_gig_id, selected_kol_id FROM gigs
     WHERE status = 'delivered'
       AND review_deadline < NOW()`
  );

  for (const gig of gigs.rows) {
    try {
      const payoutTx = await releaseEscrow(gig.onchain_gig_id);
      await pool.query(
        `UPDATE gigs SET status = 'completed', payout_tx = $2, updated_at = NOW() WHERE id = $1`,
        [gig.id, payoutTx]
      );

      await pool.query(
        `INSERT INTO notifications (agent_id, type, gig_id, data)
         VALUES ($1, 'gig_completed', $2, $3)`,
        [gig.selected_kol_id, gig.id, JSON.stringify({ payout_tx: payoutTx })]
      );

      console.log(`[cron] Auto-released gig ${gig.id}`);
    } catch (err) {
      console.error(`[cron] Failed to auto-release gig ${gig.id}:`, err);
    }
  }
}

// Job 6: disputed + 7 days passed + no resolution → completed (execute release to KOL)
async function autoResolveDisputes() {
  const gigs = await pool.query(
    `SELECT id, onchain_gig_id, selected_kol_id FROM gigs
     WHERE status = 'disputed'
       AND updated_at < NOW() - INTERVAL '7 days'`
  );

  for (const gig of gigs.rows) {
    try {
      const payoutTx = await resolveDisputeOnChain(gig.onchain_gig_id, true);
      await pool.query(
        `UPDATE gigs SET status = 'completed', payout_tx = $2, updated_at = NOW() WHERE id = $1`,
        [gig.id, payoutTx]
      );

      await pool.query(
        `INSERT INTO notifications (agent_id, type, gig_id, data)
         VALUES ($1, 'gig_completed', $2, $3)`,
        [gig.selected_kol_id, gig.id, JSON.stringify({ payout_tx: payoutTx })]
      );

      console.log(`[cron] Auto-resolved dispute for gig ${gig.id} (KOL wins)`);
    } catch (err) {
      console.error(`[cron] Failed to auto-resolve dispute for gig ${gig.id}:`, err);
    }
  }
}
