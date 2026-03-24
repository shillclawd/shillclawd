export interface DisputeAlertParams {
  gigId: string;
  gigDescription: string;
  reason: string;
  postSnapshot: string | null;
}

export async function sendDisputeAlert(params: DisputeAlertParams): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL not set, skipping dispute alert");
    return;
  }

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `🚨 *Dispute Alert*\n*Gig:* ${params.gigId}\n*Description:* ${params.gigDescription}\n*Reason:* ${params.reason}\n*Post Snapshot:* ${params.postSnapshot || "N/A"}`,
    }),
  });
}
