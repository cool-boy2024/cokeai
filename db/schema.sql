CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  price_micros BIGINT NOT NULL CHECK (price_micros >= 0),
  credits_micros BIGINT NOT NULL CHECK (credits_micros >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  tier INTEGER NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  highlight BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_health_at TIMESTAMPTZ,
  last_health_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  upstream_id TEXT NOT NULL REFERENCES upstreams(id),
  upstream_model TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  input_price_usd_micros_per_mtok BIGINT NOT NULL CHECK (input_price_usd_micros_per_mtok >= 0),
  output_price_usd_micros_per_mtok BIGINT NOT NULL CHECK (output_price_usd_micros_per_mtok >= 0),
  markup_bps INTEGER NOT NULL DEFAULT 18000 CHECK (markup_bps >= 10000),
  min_plan_tier INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER NOT NULL DEFAULT 128000,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  balance_micros BIGINT NOT NULL DEFAULT 0 CHECK (balance_micros >= 0),
  plan_id TEXT REFERENCES plans(id),
  plan_expires_at TIMESTAMPTZ,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  amount_micros BIGINT NOT NULL CHECK (amount_micros >= 0),
  credits_micros BIGINT NOT NULL CHECK (credits_micros >= 0),
  duration_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  payment_provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT UNIQUE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  amount_micros BIGINT NOT NULL CHECK (amount_micros >= 0),
  rate_bps INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'paid', 'reversed')),
  available_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commissions_referrer_idx ON commissions(referrer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  upstream_cost_micros BIGINT NOT NULL DEFAULT 0,
  charged_micros BIGINT NOT NULL DEFAULT 0,
  reserved_micros BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  latency_ms INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS usage_user_idx ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_model_idx ON usage_events(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_status_idx ON usage_events(status, created_at);

CREATE TABLE IF NOT EXISTS balance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  admin_id UUID NOT NULL REFERENCES users(id),
  amount_micros BIGINT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS balance_adjustments_user_idx ON balance_adjustments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits(window_start);

INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT (version) DO NOTHING;
