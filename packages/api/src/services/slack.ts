const webhookUrl = () => process.env.SLACK_WEBHOOK_URL;

async function sendSlack(text: string): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch((err) => console.error("[slack]", err));
}

// --- Alerts ---

export async function sendGigCreated(gigId: string, description: string, rewardMin: number, rewardMax: number): Promise<void> {
  await sendSlack(
    `📢 *New Gig*\n*ID:* ${gigId}\n*Reward:* ${rewardMin}–${rewardMax} USDC\n*Description:* ${description}`
  );
}

export async function sendNewApplication(gigId: string, kolName: string, askUsdc: number): Promise<void> {
  await sendSlack(
    `🤖 *New Application*\n*Gig:* ${gigId}\n*KOL:* ${kolName}\n*Ask:* ${askUsdc} USDC`
  );
}

export async function sendGigFunded(gigId: string, kolName: string, price: number, escrowTx: string): Promise<void> {
  await sendSlack(
    `💰 *Gig Funded*\n*Gig:* ${gigId}\n*KOL:* ${kolName}\n*Price:* ${price} USDC\n*Tx:* ${escrowTx}`
  );
}

export async function sendGigDelivered(gigId: string, kolName: string, postUrl: string): Promise<void> {
  await sendSlack(
    `📝 *Gig Delivered*\n*Gig:* ${gigId}\n*KOL:* ${kolName}\n*Post:* ${postUrl}`
  );
}

export async function sendGigCompleted(gigId: string, payoutTx: string): Promise<void> {
  await sendSlack(
    `✅ *Gig Completed*\n*Gig:* ${gigId}\n*Payout Tx:* ${payoutTx}`
  );
}

export interface DisputeAlertParams {
  gigId: string;
  gigDescription: string;
  reason: string;
  postSnapshot: string | null;
}

export async function sendDisputeAlert(params: DisputeAlertParams): Promise<void> {
  await sendSlack(
    `🚨 *Dispute Alert*\n*Gig:* ${params.gigId}\n*Description:* ${params.gigDescription}\n*Reason:* ${params.reason}\n*Post Snapshot:* ${params.postSnapshot || "N/A"}`
  );
}
