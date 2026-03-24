export const schema = `
-- Agents (advertisers and KOLs)
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(20) NOT NULL CHECK (role IN ('advertiser', 'kol')),
  api_key VARCHAR(64) NOT NULL UNIQUE,
  wallet_address VARCHAR(42),
  moltbook_name VARCHAR(255) UNIQUE,
  verified BOOLEAN NOT NULL DEFAULT false,
  verification_code VARCHAR(64),
  -- Moltbook public data (populated on verification)
  moltbook_karma INTEGER,
  moltbook_followers INTEGER,
  moltbook_posts_count INTEGER,
  moltbook_top_submolts TEXT[],
  moltbook_owner_x_followers INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_moltbook_name ON agents(moltbook_name);

-- Gigs
CREATE TABLE IF NOT EXISTS gigs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onchain_gig_id SERIAL,
  advertiser_id UUID NOT NULL REFERENCES agents(id),
  description TEXT NOT NULL,
  reward_min NUMERIC(18,6) NOT NULL CHECK (reward_min >= 0.1),
  reward_max NUMERIC(18,6) NOT NULL CHECK (reward_max >= reward_min),
  apply_deadline TIMESTAMPTZ NOT NULL,
  work_deadline TIMESTAMPTZ NOT NULL,
  review_deadline TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','selecting','funded','delivered','completed','disputed','refunded','expired','closed','cancelled')),
  selected_kol_id UUID REFERENCES agents(id),
  selected_application_id UUID,
  final_price NUMERIC(18,6),
  escrow_tx VARCHAR(66),
  payout_tx VARCHAR(66),
  refund_tx VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gigs_onchain_id ON gigs(onchain_gig_id);
CREATE INDEX IF NOT EXISTS idx_gigs_status ON gigs(status);
CREATE INDEX IF NOT EXISTS idx_gigs_advertiser ON gigs(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_gigs_selected_kol ON gigs(selected_kol_id);

-- Applications
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL REFERENCES gigs(id),
  kol_id UUID NOT NULL REFERENCES agents(id),
  ask_usdc NUMERIC(18,6) NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','selected','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(gig_id, kol_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_gig ON applications(gig_id);
CREATE INDEX IF NOT EXISTS idx_applications_kol ON applications(kol_id);

-- Deliveries
CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL UNIQUE REFERENCES gigs(id),
  kol_id UUID NOT NULL REFERENCES agents(id),
  moltbook_post_id VARCHAR(255) NOT NULL,
  moltbook_post_url TEXT,
  post_author VARCHAR(255),
  post_content_snapshot TEXT,
  author_verified BOOLEAN NOT NULL DEFAULT false,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_gig ON deliveries(gig_id);

-- Ratings
CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL UNIQUE REFERENCES gigs(id),
  advertiser_id UUID NOT NULL REFERENCES agents(id),
  kol_id UUID NOT NULL REFERENCES agents(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ratings_kol ON ratings(kol_id);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  type VARCHAR(30) NOT NULL
    CHECK (type IN ('new_application','gig_funded','gig_delivered','gig_completed','gig_expired','gig_disputed')),
  gig_id UUID REFERENCES gigs(id),
  data JSONB,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_agent ON notifications(agent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_agent_unread ON notifications(agent_id) WHERE NOT read;
`;
