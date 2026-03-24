/**
 * Disaster recovery: rebuild gig mappings from on-chain events.
 *
 * If the database is lost, this script reads GigFunded/GigReleased/GigRefunded
 * events from the escrow contract and reconstructs the gig ↔ onchain_gig_id
 * mapping + status.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx src/scripts/recover-from-chain.ts
 *
 * ⚠️ This is a recovery tool. Do NOT run in normal operation.
 * ⚠️ Agents must re-register and recover API keys via /agents/recover.
 */

import "dotenv/config";
import { ethers } from "ethers";
import { pool } from "../db/pool.js";

const ESCROW_ABI = [
  "event GigFunded(uint256 indexed gigId, address indexed advertiser, address indexed kol, uint256 amount)",
  "event GigReleased(uint256 indexed gigId, address indexed kol, uint256 kolAmount, uint256 feeAmount)",
  "event GigRefunded(uint256 indexed gigId, address indexed advertiser, uint256 amount)",
  "event GigDelivered(uint256 indexed gigId)",
  "event GigDisputed(uint256 indexed gigId)",
  "event DisputeResolved(uint256 indexed gigId, bool kolWins)",
];

async function recover() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const escrow = new ethers.Contract(
    process.env.ESCROW_CONTRACT_ADDRESS!,
    ESCROW_ABI,
    provider
  );

  console.log("Fetching all events from escrow contract...");
  console.log("Contract:", process.env.ESCROW_CONTRACT_ADDRESS);

  // Fetch all GigFunded events (these are the source of truth)
  const fundedFilter = escrow.filters.GigFunded();
  const fundedEvents = await escrow.queryFilter(fundedFilter, 0, "latest");
  console.log(`Found ${fundedEvents.length} GigFunded events`);

  for (const event of fundedEvents) {
    const log = event as ethers.EventLog;
    const [onchainGigId, advertiser, kol, amount] = log.args;

    console.log(`\nGig #${onchainGigId}:`);
    console.log(`  Advertiser: ${advertiser}`);
    console.log(`  KOL: ${kol}`);
    console.log(`  Amount: ${ethers.formatUnits(amount, 6)} USDC`);
    console.log(`  Tx: ${log.transactionHash}`);
    console.log(`  Block: ${log.blockNumber}`);
  }

  // Check which gigs were released (completed)
  const releasedFilter = escrow.filters.GigReleased();
  const releasedEvents = await escrow.queryFilter(releasedFilter, 0, "latest");
  const releasedGigIds = new Set(
    releasedEvents.map((e) => (e as ethers.EventLog).args[0].toString())
  );
  console.log(`\nReleased gigs: ${[...releasedGigIds].join(", ") || "none"}`);

  // Check which gigs were refunded (expired)
  const refundedFilter = escrow.filters.GigRefunded();
  const refundedEvents = await escrow.queryFilter(refundedFilter, 0, "latest");
  const refundedGigIds = new Set(
    refundedEvents.map((e) => (e as ethers.EventLog).args[0].toString())
  );
  console.log(`Refunded gigs: ${[...refundedGigIds].join(", ") || "none"}`);

  // Check disputed
  const disputedFilter = escrow.filters.GigDisputed();
  const disputedEvents = await escrow.queryFilter(disputedFilter, 0, "latest");
  const disputedGigIds = new Set(
    disputedEvents.map((e) => (e as ethers.EventLog).args[0].toString())
  );
  console.log(`Disputed gigs: ${[...disputedGigIds].join(", ") || "none"}`);

  // Summary
  console.log("\n--- Recovery Summary ---");
  for (const event of fundedEvents) {
    const log = event as ethers.EventLog;
    const gigId = log.args[0].toString();
    let status = "funded";
    if (releasedGigIds.has(gigId)) status = "completed";
    else if (refundedGigIds.has(gigId)) status = "expired";
    else if (disputedGigIds.has(gigId)) status = "disputed";

    console.log(
      `Gig #${gigId}: ${status} | Advertiser: ${log.args[1]} | KOL: ${log.args[2]} | ${ethers.formatUnits(log.args[3], 6)} USDC`
    );
  }

  console.log("\n⚠️ To actually rebuild the database, extend this script to INSERT into gigs table.");
  console.log("⚠️ Agents must re-register and use /agents/recover to get new API keys.");

  await pool.end();
}

recover().catch((err) => {
  console.error("Recovery failed:", err);
  process.exit(1);
});
