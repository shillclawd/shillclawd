/**
 * Disaster recovery: rebuild gig mappings from on-chain events.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx src/scripts/recover-from-chain.ts
 *
 * ⚠️ This is a recovery tool. Do NOT run in normal operation.
 */

import "dotenv/config";
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import { base } from "viem/chains";
import { pool } from "../db/pool.js";

async function recover() {
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

  const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS! as `0x${string}`;
  console.log("Fetching all events from escrow contract...");
  console.log("Contract:", escrowAddress);

  const fundedLogs = await client.getLogs({
    address: escrowAddress,
    event: parseAbiItem("event GigFunded(uint256 indexed gigId, address indexed advertiser, address indexed kol, uint256 amount)"),
    fromBlock: 0n,
    toBlock: "latest",
  });
  console.log(`Found ${fundedLogs.length} GigFunded events`);

  for (const log of fundedLogs) {
    console.log(`\nGig #${log.args.gigId}:`);
    console.log(`  Advertiser: ${log.args.advertiser}`);
    console.log(`  KOL: ${log.args.kol}`);
    console.log(`  Amount: ${formatUnits(log.args.amount!, 6)} USDC`);
    console.log(`  Tx: ${log.transactionHash}`);
    console.log(`  Block: ${log.blockNumber}`);
  }

  const releasedLogs = await client.getLogs({
    address: escrowAddress,
    event: parseAbiItem("event GigReleased(uint256 indexed gigId, address indexed kol, uint256 kolAmount, uint256 feeAmount)"),
    fromBlock: 0n,
    toBlock: "latest",
  });
  const releasedIds = new Set(releasedLogs.map((l) => l.args.gigId!.toString()));
  console.log(`\nReleased gigs: ${[...releasedIds].join(", ") || "none"}`);

  const refundedLogs = await client.getLogs({
    address: escrowAddress,
    event: parseAbiItem("event GigRefunded(uint256 indexed gigId, address indexed advertiser, uint256 amount)"),
    fromBlock: 0n,
    toBlock: "latest",
  });
  const refundedIds = new Set(refundedLogs.map((l) => l.args.gigId!.toString()));
  console.log(`Refunded gigs: ${[...refundedIds].join(", ") || "none"}`);

  const disputedLogs = await client.getLogs({
    address: escrowAddress,
    event: parseAbiItem("event GigDisputed(uint256 indexed gigId)"),
    fromBlock: 0n,
    toBlock: "latest",
  });
  const disputedIds = new Set(disputedLogs.map((l) => l.args.gigId!.toString()));
  console.log(`Disputed gigs: ${[...disputedIds].join(", ") || "none"}`);

  console.log("\n--- Recovery Summary ---");
  for (const log of fundedLogs) {
    const gigId = log.args.gigId!.toString();
    let status = "funded";
    if (releasedIds.has(gigId)) status = "completed";
    else if (refundedIds.has(gigId)) status = "expired";
    else if (disputedIds.has(gigId)) status = "disputed";

    console.log(
      `Gig #${gigId}: ${status} | Advertiser: ${log.args.advertiser} | KOL: ${log.args.kol} | ${formatUnits(log.args.amount!, 6)} USDC`
    );
  }

  console.log("\n⚠️ To rebuild DB, extend this script to INSERT into gigs table.");
  console.log("⚠️ Agents must re-register via /agents/recover.");

  await pool.end();
}

recover().catch((err) => {
  console.error("Recovery failed:", err);
  process.exit(1);
});
