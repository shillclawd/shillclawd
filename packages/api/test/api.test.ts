import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Mocks must be declared before imports that use the mocked modules
vi.mock("../src/services/escrow.js", () => ({
  depositEscrow: vi.fn().mockResolvedValue("0xmock_escrow_tx"),
  markDeliveredOnChain: vi.fn().mockResolvedValue("0xmock_deliver_tx"),
  releaseEscrow: vi.fn().mockResolvedValue("0xmock_release_tx"),
  refundEscrow: vi.fn().mockResolvedValue("0xmock_refund_tx"),
  markDisputedOnChain: vi.fn().mockResolvedValue("0xmock_dispute_tx"),
  resolveDisputeOnChain: vi.fn().mockResolvedValue("0xmock_resolve_tx"),
}));

vi.mock("../src/services/moltbook.js", () => ({
  fetchMoltbookPost: vi.fn().mockResolvedValue(null),
  fetchMoltbookProfile: vi.fn().mockResolvedValue({
    karma: 5200,
    followers: 340,
    posts_count: 87,
    top_submolts: ["m/defi", "m/technology"],
    owner_x_followers: 12000,
  }),
}));

vi.mock("../src/services/slack.js", () => ({
  sendDisputeAlert: vi.fn().mockResolvedValue(undefined),
  sendGigCreated: vi.fn().mockResolvedValue(undefined),
  sendNewApplication: vi.fn().mockResolvedValue(undefined),
  sendGigFunded: vi.fn().mockResolvedValue(undefined),
  sendGigDelivered: vi.fn().mockResolvedValue(undefined),
  sendGigCompleted: vi.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { setupDatabase, cleanDatabase, teardownDatabase } from "./setup.js";
import { fetchMoltbookPost, fetchMoltbookProfile } from "../src/services/moltbook.js";
import { depositEscrow, markDeliveredOnChain, releaseEscrow, refundEscrow, markDisputedOnChain, resolveDisputeOnChain } from "../src/services/escrow.js";
import { sendDisputeAlert, sendGigCreated, sendNewApplication, sendGigFunded, sendGigDelivered, sendGigCompleted } from "../src/services/slack.js";

const moltbookPost = vi.mocked(fetchMoltbookPost);

function resetMockDefaults() {
  moltbookPost.mockResolvedValue(null);
  vi.mocked(fetchMoltbookProfile).mockResolvedValue({
    karma: 5200,
    followers: 340,
    posts_count: 87,
    top_submolts: ["m/defi", "m/technology"],
    owner_x_followers: 12000,
  });
  vi.mocked(depositEscrow).mockResolvedValue("0xmock_escrow_tx");
  vi.mocked(markDeliveredOnChain).mockResolvedValue("0xmock_deliver_tx");
  vi.mocked(releaseEscrow).mockResolvedValue("0xmock_release_tx");
  vi.mocked(refundEscrow).mockResolvedValue("0xmock_refund_tx");
  vi.mocked(markDisputedOnChain).mockResolvedValue("0xmock_dispute_tx");
  vi.mocked(resolveDisputeOnChain).mockResolvedValue("0xmock_resolve_tx");
  vi.mocked(sendDisputeAlert).mockResolvedValue(undefined);
  vi.mocked(sendGigCreated).mockResolvedValue(undefined);
  vi.mocked(sendNewApplication).mockResolvedValue(undefined);
  vi.mocked(sendGigFunded).mockResolvedValue(undefined);
  vi.mocked(sendGigDelivered).mockResolvedValue(undefined);
  vi.mocked(sendGigCompleted).mockResolvedValue(undefined);
}

beforeAll(async () => {
  await setupDatabase();
});

afterAll(async () => {
  await teardownDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
  vi.resetAllMocks();
  resetMockDefaults();
});

// --- Helpers ---

async function registerAdvertiser() {
  const res = await request(app)
    .post("/agents/register")
    .send({ role: "advertiser", wallet_address: "0xADV" });
  return res.body.api_key as string;
}

async function registerAndVerifyKol() {
  const regRes = await request(app)
    .post("/agents/register")
    .send({ role: "kol", moltbook_name: "AgentX" });

  const apiKey = regRes.body.api_key as string;
  const code = regRes.body.verification_code as string;

  moltbookPost.mockResolvedValueOnce({
    id: "post_xyz",
    author: "AgentX",
    content: `ShillClawd verify: ${code}`,
    url: "https://moltbook.com/post/post_xyz",
  });

  const verifyRes = await request(app)
    .post("/agents/verify")
    .set("x-api-key", apiKey)
    .send({ moltbook_post_id: "post_xyz" });

  if (verifyRes.status !== 200) {
    throw new Error(`Verification failed: ${JSON.stringify(verifyRes.body)}`);
  }

  return apiKey;
}

async function createGig(advKey: string) {
  const res = await request(app)
    .post("/gigs")
    .set("x-api-key", advKey)
    .send({
      description: "Promote our DEX",
      reward_min: 1,
      reward_max: 5,
      apply_deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
      work_deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
  return res.body.gig_id as string;
}

async function applyToGig(kolKey: string, gigId: string, ask: number = 3) {
  const res = await request(app)
    .post(`/gigs/${gigId}/apply`)
    .set("x-api-key", kolKey)
    .send({ ask_usdc: ask, wallet_address: "0xKOL" });
  return res.body.application_id as string;
}

async function forceSelecting(gigId: string) {
  await pool.query(
    "UPDATE gigs SET apply_deadline = NOW() - INTERVAL '1 hour', status = 'selecting' WHERE id = $1",
    [gigId]
  );
}

async function setupFundedGig() {
  const advKey = await registerAdvertiser();
  const kolKey = await registerAndVerifyKol();
  const gigId = await createGig(advKey);
  const appId = await applyToGig(kolKey, gigId);
  await forceSelecting(gigId);

  await request(app)
    .post(`/gigs/${gigId}/select-and-fund`)
    .set("x-api-key", advKey)
    .send({
      application_id: appId,
      kol_address: "0xKOL",
      permit_v: 28,
      permit_r: "0x" + "0".repeat(64),
      permit_s: "0x" + "0".repeat(64),
      permit_deadline: Math.floor(Date.now() / 1000) + 3600,
    });

  return { advKey, kolKey, gigId };
}

async function setupDeliveredGig() {
  const { advKey, kolKey, gigId } = await setupFundedGig();

  moltbookPost.mockResolvedValueOnce({
    id: "post_delivery",
    author: "AgentX",
    content: "Check out this amazing DEX!",
    url: "https://moltbook.com/post/post_delivery",
  });

  await request(app)
    .post(`/gigs/${gigId}/deliver`)
    .set("x-api-key", kolKey)
    .send({ moltbook_post_id: "post_delivery" });

  return { advKey, kolKey, gigId };
}

// --- Registration ---

describe("Registration", () => {
  it("registers an advertiser", async () => {
    const res = await request(app)
      .post("/agents/register")
      .send({ role: "advertiser", wallet_address: "0xADV" });

    expect(res.status).toBe(201);
    expect(res.body.api_key).toMatch(/^shillclawd_/);
  });

  it("registers a KOL with verification code", async () => {
    const res = await request(app)
      .post("/agents/register")
      .send({ role: "kol", moltbook_name: "AgentX" });

    expect(res.status).toBe(201);
    expect(res.body.api_key).toMatch(/^shillclawd_/);
    expect(res.body.verification_code).toMatch(/^verify_/);
  });

  it("rejects advertiser without wallet", async () => {
    const res = await request(app)
      .post("/agents/register")
      .send({ role: "advertiser" });
    expect(res.status).toBe(400);
  });

  it("rejects KOL without moltbook_name", async () => {
    const res = await request(app)
      .post("/agents/register")
      .send({ role: "kol" });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate verified moltbook_name", async () => {
    await registerAndVerifyKol();

    const res = await request(app)
      .post("/agents/register")
      .send({ role: "kol", moltbook_name: "AgentX" });

    expect(res.status).toBe(409);
  });
});

// --- Verification ---

describe("Verification", () => {
  it("verifies a KOL with correct post", async () => {
    const regRes = await request(app)
      .post("/agents/register")
      .send({ role: "kol", moltbook_name: "AgentX" });

    const code = regRes.body.verification_code;
    moltbookPost.mockResolvedValueOnce({
      id: "post_xyz",
      author: "AgentX",
      content: `ShillClawd verify: ${code}`,
      url: "https://moltbook.com/post/post_xyz",
    });

    const res = await request(app)
      .post("/agents/verify")
      .set("x-api-key", regRes.body.api_key)
      .send({ moltbook_post_id: "post_xyz" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("verified");
  });

  it("rejects verification with wrong author", async () => {
    const regRes = await request(app)
      .post("/agents/register")
      .send({ role: "kol", moltbook_name: "AgentX" });

    moltbookPost.mockResolvedValueOnce({
      id: "post_xyz",
      author: "SomeoneElse",
      content: `ShillClawd verify: ${regRes.body.verification_code}`,
      url: "https://moltbook.com/post/post_xyz",
    });

    const res = await request(app)
      .post("/agents/verify")
      .set("x-api-key", regRes.body.api_key)
      .send({ moltbook_post_id: "post_xyz" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("author");
  });

  it("rejects verification without code in content", async () => {
    const regRes = await request(app)
      .post("/agents/register")
      .send({ role: "kol", moltbook_name: "AgentX" });

    moltbookPost.mockResolvedValueOnce({
      id: "post_xyz",
      author: "AgentX",
      content: "Just a random post",
      url: "https://moltbook.com/post/post_xyz",
    });

    const res = await request(app)
      .post("/agents/verify")
      .set("x-api-key", regRes.body.api_key)
      .send({ moltbook_post_id: "post_xyz" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("verification code");
  });
});

// --- Authorization ---

describe("Authorization", () => {
  it("returns 401 without API key", async () => {
    const res = await request(app).get("/gigs/open");
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid API key", async () => {
    const res = await request(app)
      .get("/gigs/open")
      .set("x-api-key", "invalid_key");
    expect(res.status).toBe(401);
  });

  it("returns 403 when advertiser tries to browse open gigs", async () => {
    const advKey = await registerAdvertiser();
    const res = await request(app)
      .get("/gigs/open")
      .set("x-api-key", advKey);
    expect(res.status).toBe(403);
  });

  it("returns 403 when KOL tries to create gig", async () => {
    const kolKey = await registerAndVerifyKol();
    const res = await request(app)
      .post("/gigs")
      .set("x-api-key", kolKey)
      .send({ description: "test", reward_min: 1, reward_max: 5 });
    expect(res.status).toBe(403);
  });

  it("returns 403 when non-owner advertiser tries to cancel", async () => {
    const advKey1 = await registerAdvertiser();
    const gigId = await createGig(advKey1);

    const res2 = await request(app)
      .post("/agents/register")
      .send({ role: "advertiser", wallet_address: "0xADV2" });

    const res = await request(app)
      .post(`/gigs/${gigId}/cancel`)
      .set("x-api-key", res2.body.api_key);
    expect(res.status).toBe(403);
  });

  it("returns 403 when unverified KOL tries to apply", async () => {
    const advKey = await registerAdvertiser();
    const gigId = await createGig(advKey);

    const kolRes = await request(app)
      .post("/agents/register")
      .send({ role: "kol", moltbook_name: "UnverifiedAgent" });

    const res = await request(app)
      .post(`/gigs/${gigId}/apply`)
      .set("x-api-key", kolRes.body.api_key)
      .send({ ask_usdc: 3, wallet_address: "0xKOL" });

    expect(res.status).toBe(403);
  });
});

// --- Gig Lifecycle ---

describe("Gig creation", () => {
  it("creates a gig with valid params", async () => {
    const advKey = await registerAdvertiser();
    const res = await request(app)
      .post("/gigs")
      .set("x-api-key", advKey)
      .send({
        description: "Promote our DEX",
        reward_min: 1,
        reward_max: 5,
        apply_deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
        work_deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.gig_id).toBeDefined();
    expect(res.body.status).toBe("open");
    expect(res.body.review_deadline).toBeDefined();
  });

  it("rejects reward_min < 0.1", async () => {
    const advKey = await registerAdvertiser();
    const res = await request(app)
      .post("/gigs")
      .set("x-api-key", advKey)
      .send({
        description: "test",
        reward_min: 0.05,
        reward_max: 5,
        apply_deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
        work_deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects reward_min > reward_max", async () => {
    const advKey = await registerAdvertiser();
    const res = await request(app)
      .post("/gigs")
      .set("x-api-key", advKey)
      .send({
        description: "test",
        reward_min: 10,
        reward_max: 5,
        apply_deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
        work_deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
    expect(res.status).toBe(400);
  });
});

describe("Gig cancel", () => {
  it("cancels an open gig", async () => {
    const advKey = await registerAdvertiser();
    const gigId = await createGig(advKey);

    const res = await request(app)
      .post(`/gigs/${gigId}/cancel`)
      .set("x-api-key", advKey);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("cannot cancel a funded gig", async () => {
    const advKey = await registerAdvertiser();
    const gigId = await createGig(advKey);
    await pool.query("UPDATE gigs SET status = 'funded' WHERE id = $1", [gigId]);

    const res = await request(app)
      .post(`/gigs/${gigId}/cancel`)
      .set("x-api-key", advKey);

    expect(res.status).toBe(400);
  });
});

describe("Application flow", () => {
  it("KOL applies and advertiser views applications", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);

    const applyRes = await request(app)
      .post(`/gigs/${gigId}/apply`)
      .set("x-api-key", kolKey)
      .send({ ask_usdc: 3, wallet_address: "0xKOL" });

    expect(applyRes.status).toBe(201);
    expect(applyRes.body.application_id).toBeDefined();

    const listRes = await request(app)
      .get(`/gigs/${gigId}/applications`)
      .set("x-api-key", advKey);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].kol_name).toBe("AgentX");
    expect(listRes.body[0].moltbook).toBeDefined();
    expect(listRes.body[0].shillclawd).toBeDefined();
  });

  it("rejects ask outside reward range", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);

    const res = await request(app)
      .post(`/gigs/${gigId}/apply`)
      .set("x-api-key", kolKey)
      .send({ ask_usdc: 100, wallet_address: "0xKOL" });

    expect(res.status).toBe(400);
  });

  it("rejects duplicate application", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);

    await applyToGig(kolKey, gigId);

    const res = await request(app)
      .post(`/gigs/${gigId}/apply`)
      .set("x-api-key", kolKey)
      .send({ ask_usdc: 3, wallet_address: "0xKOL" });

    expect(res.status).toBe(409);
  });

  it("KOL withdraws application", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);
    await applyToGig(kolKey, gigId);

    const res = await request(app)
      .post(`/gigs/${gigId}/withdraw`)
      .set("x-api-key", kolKey);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("withdrawn");
  });
});

// --- Select-and-fund ---

describe("Select-and-fund", () => {
  it("atomically selects KOL and funds escrow", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);
    const appId = await applyToGig(kolKey, gigId);
    await forceSelecting(gigId);

    const res = await request(app)
      .post(`/gigs/${gigId}/select-and-fund`)
      .set("x-api-key", advKey)
      .send({
        application_id: appId,
        kol_address: "0xKOL",
        permit_v: 28,
        permit_r: "0x" + "0".repeat(64),
        permit_s: "0x" + "0".repeat(64),
      permit_deadline: Math.floor(Date.now() / 1000) + 3600,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("funded");
    expect(res.body.escrow_tx).toBe("0xmock_escrow_tx");
    expect(res.body.final_price).toBe(3);
  });

  it("rejects when gig is not in selecting status", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);
    const appId = await applyToGig(kolKey, gigId);

    const res = await request(app)
      .post(`/gigs/${gigId}/select-and-fund`)
      .set("x-api-key", advKey)
      .send({
        application_id: appId,
        kol_address: "0xKOL",
        permit_v: 28,
        permit_r: "0x" + "0".repeat(64),
        permit_s: "0x" + "0".repeat(64),
      permit_deadline: Math.floor(Date.now() / 1000) + 3600,
      });

    expect(res.status).toBe(400);
  });

  it("rejects mismatched kol_address", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);
    const appId = await applyToGig(kolKey, gigId);
    await forceSelecting(gigId);

    const res = await request(app)
      .post(`/gigs/${gigId}/select-and-fund`)
      .set("x-api-key", advKey)
      .send({
        application_id: appId,
        kol_address: "0xWRONG",
        permit_v: 28,
        permit_r: "0x" + "0".repeat(64),
        permit_s: "0x" + "0".repeat(64),
      permit_deadline: Math.floor(Date.now() / 1000) + 3600,
      });

    expect(res.status).toBe(400);
  });
});

// --- Deliver ---

describe("Delivery", () => {
  it("KOL delivers with valid post", async () => {
    const { kolKey, gigId } = await setupFundedGig();

    moltbookPost.mockResolvedValueOnce({
      id: "post_delivery",
      author: "AgentX",
      content: "Check out this amazing DEX!",
      url: "https://moltbook.com/post/post_delivery",
    });

    const res = await request(app)
      .post(`/gigs/${gigId}/deliver`)
      .set("x-api-key", kolKey)
      .send({ moltbook_post_id: "post_delivery" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("delivered");
  });

  it("rejects delivery from non-selected KOL", async () => {
    const { gigId } = await setupFundedGig();

    // Register a different KOL
    const res2 = await request(app)
      .post("/agents/register")
      .send({ role: "kol", moltbook_name: "OtherAgent" });

    moltbookPost.mockResolvedValueOnce({
      id: "post_v",
      author: "OtherAgent",
      content: `ShillClawd verify: ${res2.body.verification_code}`,
      url: "https://moltbook.com/post/post_v",
    });
    await request(app)
      .post("/agents/verify")
      .set("x-api-key", res2.body.api_key)
      .send({ moltbook_post_id: "post_v" });

    const res = await request(app)
      .post(`/gigs/${gigId}/deliver`)
      .set("x-api-key", res2.body.api_key)
      .send({ moltbook_post_id: "post_delivery" });

    expect(res.status).toBe(403);
  });

  it("rejects duplicate delivery", async () => {
    const { kolKey, gigId } = await setupFundedGig();

    moltbookPost.mockResolvedValueOnce({
      id: "post_delivery",
      author: "AgentX",
      content: "Check out this amazing DEX!",
      url: "https://moltbook.com/post/post_delivery",
    });

    await request(app)
      .post(`/gigs/${gigId}/deliver`)
      .set("x-api-key", kolKey)
      .send({ moltbook_post_id: "post_delivery" });

    moltbookPost.mockResolvedValueOnce({
      id: "post_delivery2",
      author: "AgentX",
      content: "Another post",
      url: "https://moltbook.com/post/post_delivery2",
    });

    const res = await request(app)
      .post(`/gigs/${gigId}/deliver`)
      .set("x-api-key", kolKey)
      .send({ moltbook_post_id: "post_delivery2" });

    // Gig is already 'delivered', so status check fails before duplicate check
    expect(res.status).toBe(400);
  });
});

// --- Settlement ---

describe("Settlement", () => {
  it("approves delivery and releases payment", async () => {
    const { advKey, gigId } = await setupDeliveredGig();

    const res = await request(app)
      .post(`/gigs/${gigId}/approve`)
      .set("x-api-key", advKey);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.payout_tx).toBe("0xmock_release_tx");
  });

  it("rejects delivery and creates dispute", async () => {
    const { advKey, gigId } = await setupDeliveredGig();

    const res = await request(app)
      .post(`/gigs/${gigId}/reject`)
      .set("x-api-key", advKey)
      .send({ reason: "Completely off-topic" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("disputed");
  });

  it("cannot approve a non-delivered gig", async () => {
    const advKey = await registerAdvertiser();
    const gigId = await createGig(advKey);

    const res = await request(app)
      .post(`/gigs/${gigId}/approve`)
      .set("x-api-key", advKey);

    expect(res.status).toBe(400);
  });
});

// --- Notifications ---

describe("Notifications", () => {
  it("returns notifications for the authenticated agent", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);
    await applyToGig(kolKey, gigId);

    const res = await request(app)
      .get("/me/notifications")
      .set("x-api-key", advKey);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].type).toBe("new_application");
  });
});

// --- Full happy path ---

describe("Full lifecycle: happy path", () => {
  it("register → create → apply → fund → deliver → approve", async () => {
    const advKey = await registerAdvertiser();
    const kolKey = await registerAndVerifyKol();
    const gigId = await createGig(advKey);

    // KOL browses open gigs
    const openRes = await request(app)
      .get("/gigs/open")
      .set("x-api-key", kolKey);
    expect(openRes.body.length).toBe(1);

    // Apply
    const appId = await applyToGig(kolKey, gigId);

    // Select-and-fund
    await forceSelecting(gigId);
    const fundRes = await request(app)
      .post(`/gigs/${gigId}/select-and-fund`)
      .set("x-api-key", advKey)
      .send({
        application_id: appId,
        kol_address: "0xKOL",
        permit_v: 28,
        permit_r: "0x" + "0".repeat(64),
        permit_s: "0x" + "0".repeat(64),
      permit_deadline: Math.floor(Date.now() / 1000) + 3600,
      });
    expect(fundRes.body.status).toBe("funded");

    // Deliver
    moltbookPost.mockResolvedValueOnce({
      id: "post_delivery",
      author: "AgentX",
      content: "Amazing DEX review post",
      url: "https://moltbook.com/post/post_delivery",
    });

    const deliverRes = await request(app)
      .post(`/gigs/${gigId}/deliver`)
      .set("x-api-key", kolKey)
      .send({ moltbook_post_id: "post_delivery" });
    expect(deliverRes.body.status).toBe("delivered");

    // Approve
    const approveRes = await request(app)
      .post(`/gigs/${gigId}/approve`)
      .set("x-api-key", advKey);
    expect(approveRes.body.status).toBe("completed");
    expect(approveRes.body.payout_tx).toBeDefined();

    // Verify final state
    const gigRes = await request(app)
      .get(`/gigs/${gigId}`)
      .set("x-api-key", advKey);
    expect(gigRes.body.status).toBe("completed");
    expect(gigRes.body.delivery).toBeDefined();
    expect(gigRes.body.delivery.author_verified).toBe(true);
  });
});
