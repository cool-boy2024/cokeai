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

-- A plan is either a balance top-up ("topup") or a paid membership
-- ("membership"). Membership plans carry the shop discount the member gets
-- while the membership is active; their credits_micros value stays 0.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'topup';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS shop_discount_bps INTEGER NOT NULL DEFAULT 0;

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
  markup_bps INTEGER NOT NULL DEFAULT 12000 CHECK (markup_bps >= 10000),
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

-- Device/IP tracking for the admin session list (kick + concurrency cap).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;

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
-- 关联到网关请求 ID，便于把一笔用量和一次 /v1 调用对上（响应头 X-Request-Id）。
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS request_id UUID;
-- 缓存命中 token 单独记账：prompt_tokens_details.cached_tokens（OpenAI 兼容）
-- 与 cache_read_input_tokens / cache_creation_input_tokens（Anthropic 风格）都会解析进来。
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS cache_write_tokens BIGINT NOT NULL DEFAULT 0;
-- 内部任务（小店 AI 上架 Agent 等）不向客户收费，但成本照记，指标页单独一节展示。
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS internal BOOLEAN NOT NULL DEFAULT false;
-- 指标页按时间窗扫描，需要一个纯时间索引。
CREATE INDEX IF NOT EXISTS usage_created_idx ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS usage_internal_idx ON usage_events(internal) WHERE internal;

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

-- ============================================================================
-- 002_sub2api_cutover
-- Gateway identity / key sync / funding outbox / live pricing / payments
-- ============================================================================

CREATE TABLE IF NOT EXISTS gateway_identities (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sub2api_user_id BIGINT,
  sub2api_email TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'active', 'failed')),
  last_error TEXT,
  provisioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_identities_sub2api_user_idx
  ON gateway_identities(sub2api_user_id)
  WHERE sub2api_user_id IS NOT NULL;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS sub2api_key_id BIGINT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS sync_state TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS gateway_group_id BIGINT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_sync_state_check'
  ) THEN
    ALTER TABLE api_keys
      ADD CONSTRAINT api_keys_sync_state_check
      CHECK (sync_state IN ('legacy', 'pending', 'active', 'revoke_pending', 'revoked'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_sub2api_key_idx
  ON api_keys(sub2api_key_id)
  WHERE sub2api_key_id IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS gateway_balance_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS gateway_balance_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'topup'
    CHECK (kind IN ('topup', 'adjustment', 'refund')),
  amount_cny_micros BIGINT NOT NULL CHECK (amount_cny_micros <> 0),
  amount_credit NUMERIC(20,8) NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applying', 'applied', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sub2api_user_id BIGINT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gateway_balance_ops_status_idx
  ON gateway_balance_ops(status, created_at);
CREATE INDEX IF NOT EXISTS gateway_balance_ops_user_idx
  ON gateway_balance_ops(user_id, created_at DESC);

-- Live pricing: manual cost book (account-level overrides included)
CREATE TABLE IF NOT EXISTS pricing_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  account_id BIGINT,
  source_name TEXT NOT NULL DEFAULT '',
  input_usd_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  output_usd_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  cache_read_usd_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  cache_write_usd_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  per_request_usd NUMERIC(20,8) NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_costs_model_idx
  ON pricing_costs(model_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS pricing_costs_account_idx
  ON pricing_costs(account_id) WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS model_prices_current (
  model_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT '',
  input_cny_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  output_cny_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  cache_read_cny_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  cache_write_cny_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  per_request_cny NUMERIC(20,8) NOT NULL DEFAULT 0,
  cost_usd_per_mtok NUMERIC(20,8) NOT NULL DEFAULT 0,
  margin_bps INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paused'
    CHECK (status IN ('active', 'paused')),
  pause_reason TEXT,
  fx_rate NUMERIC(20,8) NOT NULL DEFAULT 0,
  cost_source TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_prices_status_idx
  ON model_prices_current(status);

CREATE TABLE IF NOT EXISTS pricing_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'partial')),
  fx_rate NUMERIC(20,8),
  models_total INTEGER NOT NULL DEFAULT 0,
  models_updated INTEGER NOT NULL DEFAULT 0,
  models_paused INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public_price_cache (
  id INTEGER PRIMARY KEY DEFAULT 1,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  CHECK (id = 1)
);

-- Payments: EasyPay (Alipay) and USDT TRC20
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_amount NUMERIC(20,8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_currency TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_txid TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_quoted_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS derivation_index INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS orders_pay_txid_idx
  ON orders(pay_txid) WHERE pay_txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_idx
  ON payment_events(provider, event_id);

CREATE SEQUENCE IF NOT EXISTS usdt_derivation_seq START 1;

CREATE TABLE IF NOT EXISTS usdt_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  network TEXT NOT NULL DEFAULT 'trc20' CHECK (network = 'trc20'),
  address TEXT NOT NULL,
  derivation_index INTEGER NOT NULL,
  expected_usdt NUMERIC(20,6) NOT NULL,
  received_usdt NUMERIC(20,6) NOT NULL DEFAULT 0,
  txid TEXT,
  block_number BIGINT,
  confirmations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'partial', 'confirming', 'confirmed', 'overpaid', 'expired', 'manual')),
  expires_at TIMESTAMPTZ NOT NULL,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usdt_deposits_status_idx
  ON usdt_deposits(status, expires_at);

-- 007_usdt_networks: TRC20, BSC (BEP20) and Polygon. Existing rows are TRC20.
ALTER TABLE usdt_deposits DROP CONSTRAINT IF EXISTS usdt_deposits_network_check;
ALTER TABLE usdt_deposits ADD CONSTRAINT usdt_deposits_network_check
  CHECK (network IN ('trc20', 'bsc', 'polygon'));
-- First block to scan for EVM deposits; avoids unbounded eth_getLogs ranges.
ALTER TABLE usdt_deposits ADD COLUMN IF NOT EXISTS scan_from_block BIGINT;
DROP INDEX IF EXISTS usdt_deposits_txid_idx;
CREATE UNIQUE INDEX IF NOT EXISTS usdt_deposits_network_txid_idx
  ON usdt_deposits(network, txid) WHERE txid IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT (version) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('002_sub2api_cutover') ON CONFLICT (version) DO NOTHING;

-- 003_personal_payments: merchant settings and independently verified receipts.
CREATE TABLE IF NOT EXISTS payment_settings (
  channel TEXT PRIMARY KEY CHECK (channel IN ('alipay_manual', 'usdt_trc20', 'usdt_bsc', 'usdt_polygon')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payload_encrypted TEXT NOT NULL,
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  admin_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS manual_alipay_payments (
  -- Polymorphic order reference, checked under the parent order row lock.
  order_id UUID PRIMARY KEY,
  order_kind TEXT NOT NULL DEFAULT 'credits' CHECK (order_kind IN ('credits','shop')),
  qr_data_url TEXT NOT NULL,
  payee TEXT NOT NULL,
  reported_reference TEXT,
  payer_note TEXT,
  reported_at TIMESTAMPTZ
);
-- The operator looks a shop order up by the Alipay transaction number the buyer
-- reported, so that column gets its own index.
CREATE INDEX IF NOT EXISTS manual_alipay_reported_ref_idx
  ON manual_alipay_payments(reported_reference)
  WHERE reported_reference IS NOT NULL;
CREATE TABLE IF NOT EXISTS payment_receipts (
  order_id UUID PRIMARY KEY,
  order_kind TEXT NOT NULL DEFAULT 'credits' CHECK (order_kind IN ('credits','shop')),
  provider TEXT NOT NULL,
  receipt_ref TEXT NOT NULL,
  amount_micros BIGINT NOT NULL CHECK (amount_micros > 0),
  reviewed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, receipt_ref)
);
INSERT INTO schema_migrations (version) VALUES ('003_personal_payments') ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- 003_shop: digital-goods storefront (independent from credit orders)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shop_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'aibijia' CHECK (kind IN ('aibijia', 'manual')),
  feed_url TEXT,
  meta_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES shop_suppliers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  products_seen INTEGER NOT NULL DEFAULT 0,
  offers_seen INTEGER NOT NULL DEFAULT 0,
  mapped_offers INTEGER NOT NULL DEFAULT 0,
  price_changes INTEGER NOT NULL DEFAULT 0,
  stock_changes INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS shop_sync_runs_supplier_idx
  ON shop_sync_runs(supplier_id, started_at DESC);

CREATE TABLE IF NOT EXISTS shop_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES shop_suppliers(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL,
  supplier_product_slug TEXT NOT NULL DEFAULT '',
  source_store TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL,
  price_micros BIGINT NOT NULL DEFAULT 0 CHECK (price_micros >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  availability TEXT NOT NULL DEFAULT 'out_of_stock'
    CHECK (availability IN ('in_stock', 'low_stock', 'out_of_stock', 'missing')),
  url TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, external_key)
);
CREATE INDEX IF NOT EXISTS shop_offers_supplier_availability_idx
  ON shop_offers(supplier_id, availability);
CREATE INDEX IF NOT EXISTS shop_offers_slug_idx
  ON shop_offers(supplier_product_slug);

CREATE TABLE IF NOT EXISTS shop_offer_price_history (
  id BIGSERIAL PRIMARY KEY,
  offer_id UUID NOT NULL REFERENCES shop_offers(id) ON DELETE CASCADE,
  price_micros BIGINT NOT NULL,
  availability TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_offer_price_history_offer_idx
  ON shop_offer_price_history(offer_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL DEFAULT 'other'
    CHECK (brand IN ('chatgpt', 'claude', 'gemini', 'grok', 'muse', 'other')),
  category TEXT NOT NULL DEFAULT 'subscription'
    CHECK (category IN ('subscription', 'account', 'topup', 'giftcard', 'other')),
  product_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (product_type IN ('subscription', 'account', 'topup', 'giftcard')),
  name TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_variant TEXT NOT NULL DEFAULT 'neutral',
  price_micros BIGINT NOT NULL DEFAULT 0 CHECK (price_micros >= 0),
  delivery_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (delivery_method IN ('manual', 'auto')),
  eta_min_minutes INTEGER NOT NULL DEFAULT 10 CHECK (eta_min_minutes >= 0),
  eta_max_minutes INTEGER NOT NULL DEFAULT 30 CHECK (eta_max_minutes >= 0),
  warranty_type TEXT NOT NULL DEFAULT 'first_login'
    CHECK (warranty_type IN ('first_login', 'days', 'none')),
  warranty_days INTEGER NOT NULL DEFAULT 0 CHECK (warranty_days >= 0),
  warranty_note TEXT NOT NULL DEFAULT '',
  includes JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_notice TEXT NOT NULL DEFAULT '',
  refund_policy TEXT NOT NULL DEFAULT '',
  input_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  availability TEXT NOT NULL DEFAULT 'out_of_stock'
    CHECK (availability IN ('in_stock', 'low_stock', 'out_of_stock', 'paused')),
  availability_reason TEXT,
  pricing_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  copy_ready BOOLEAN NOT NULL DEFAULT FALSE,
  compliance_ack_at TIMESTAMPTZ,
  compliance_ack_by UUID REFERENCES users(id) ON DELETE SET NULL,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_products_public_idx
  ON shop_products(status, availability, sort_order);
CREATE INDEX IF NOT EXISTS shop_products_brand_idx
  ON shop_products(brand, status);

-- 2026-10-29: 增加 Muse 品牌与按货源原文显示的质保口径。
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS warranty_note TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_products DROP CONSTRAINT IF EXISTS shop_products_brand_check;
ALTER TABLE shop_products ADD CONSTRAINT shop_products_brand_check
  CHECK (brand IN ('chatgpt', 'claude', 'gemini', 'grok', 'muse', 'other'));

CREATE TABLE IF NOT EXISTS shop_product_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES shop_offers(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'backup')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  supplier_cost_micros BIGINT NOT NULL DEFAULT 0,
  supplier_availability TEXT NOT NULL DEFAULT 'out_of_stock',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, offer_id)
);
CREATE INDEX IF NOT EXISTS shop_product_sources_offer_idx
  ON shop_product_sources(offer_id);

-- 2026-10-30: 货源 AI 上架任务。一条货源一次任务，生成的商品始终是 draft，
-- 需要运营在后台审核并确认合规后再手动发布。
CREATE TABLE IF NOT EXISTS shop_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES shop_offers(id) ON DELETE CASCADE,
  product_id UUID REFERENCES shop_products(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'draft_ready', 'failed', 'skipped')),
  engine TEXT NOT NULL DEFAULT 'heuristic'
    CHECK (engine IN ('heuristic', 'ai', 'n8n')),
  error TEXT,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_import_jobs_status_idx
  ON shop_import_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS shop_import_jobs_offer_idx
  ON shop_import_jobs(offer_id, created_at DESC);
-- 同一条货源同时只允许一个排队中/生成中的任务。
CREATE UNIQUE INDEX IF NOT EXISTS shop_import_jobs_active_offer_idx
  ON shop_import_jobs(offer_id) WHERE status IN ('queued', 'running');
-- 受控 Agent 轨迹与用量：engine 增加 'agent'；steps 只存摘要（KB 级），
-- token/calls 用来对比单轮方案的成本（评测与 /admin/metrics 内部任务一节）。
ALTER TABLE shop_import_jobs DROP CONSTRAINT IF EXISTS shop_import_jobs_engine_check;
ALTER TABLE shop_import_jobs ADD CONSTRAINT shop_import_jobs_engine_check
  CHECK (engine IN ('heuristic', 'ai', 'agent', 'n8n'));
ALTER TABLE shop_import_jobs ADD COLUMN IF NOT EXISTS steps JSONB;
ALTER TABLE shop_import_jobs ADD COLUMN IF NOT EXISTS agent_input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE shop_import_jobs ADD COLUMN IF NOT EXISTS agent_output_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE shop_import_jobs ADD COLUMN IF NOT EXISTS agent_calls INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS shop_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN (
      'pending_payment', 'paid', 'procuring', 'delivered',
      'cancelled', 'expired', 'refund_pending', 'refunded'
    )),
  subtotal_micros BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_micros >= 0),
  amount_micros BIGINT NOT NULL DEFAULT 0 CHECK (amount_micros >= 0),
  payment_provider TEXT NOT NULL DEFAULT 'manual'
    CHECK (payment_provider IN ('alipay_easypay', 'alipay_manual', 'usdt_trc20', 'manual', 'balance')),
  provider_ref TEXT UNIQUE,
  pay_amount NUMERIC(20,8),
  pay_currency TEXT,
  pay_address TEXT,
  pay_txid TEXT,
  pay_quoted_at TIMESTAMPTZ,
  pay_expires_at TIMESTAMPTZ,
  derivation_index INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  customer_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Operator clicked “去采购”; the Chrome helper may post the supplier CDK
-- until this timestamp. NULL means the helper should not bind this order.
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS capture_pending_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS shop_orders_user_idx
  ON shop_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_status_idx
  ON shop_orders(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_pay_txid_idx
  ON shop_orders(pay_txid) WHERE pay_txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS shop_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES shop_products(id) ON DELETE SET NULL,
  product_slug TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'other',
  unit_price_micros BIGINT NOT NULL CHECK (unit_price_micros >= 0),
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  supplier_offer_id UUID REFERENCES shop_offers(id) ON DELETE SET NULL,
  supplier_title_snapshot TEXT NOT NULL DEFAULT '',
  supplier_cost_micros BIGINT NOT NULL DEFAULT 0,
  procurement_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (procurement_status IN (
      'pending', 'to_buy', 'bought', 'delivered', 'out_of_stock', 'refunded'
    )),
  supplier_order_ref TEXT,
  delivery_kind TEXT CHECK (delivery_kind IN ('account', 'code', 'manual_note')),
  delivery_payload_encrypted TEXT,
  delivery_note TEXT NOT NULL DEFAULT '',
  customer_input_encrypted TEXT,
  customer_input_purged_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  revealed_at TIMESTAMPTZ,
  reveal_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_order_items_order_idx
  ON shop_order_items(order_id);
CREATE INDEX IF NOT EXISTS shop_order_items_procurement_idx
  ON shop_order_items(procurement_status);

CREATE TABLE IF NOT EXISTS shop_order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_id UUID,
  event TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_order_events_order_idx
  ON shop_order_events(order_id, created_at);

-- Short-lived tokens for the procurement Chrome helper. The helper cannot
-- send the admin session cookie from chrome-extension://, so the admin
-- console mints a hashed bearer token. Raw tokens never stay in the table.
CREATE TABLE IF NOT EXISTS shop_capture_tokens (
  token_hash TEXT PRIMARY KEY,
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_capture_tokens_expiry_idx
  ON shop_capture_tokens(expires_at);
CREATE INDEX IF NOT EXISTS shop_capture_tokens_admin_idx
  ON shop_capture_tokens(admin_id);
INSERT INTO schema_migrations (version) VALUES ('010_shop_capture') ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS shop_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  order_id UUID REFERENCES shop_orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS shop_usdt_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES shop_orders(id) ON DELETE CASCADE,
  network TEXT NOT NULL DEFAULT 'trc20' CHECK (network = 'trc20'),
  address TEXT NOT NULL,
  derivation_index INTEGER NOT NULL,
  expected_usdt NUMERIC(20,6) NOT NULL,
  received_usdt NUMERIC(20,6) NOT NULL DEFAULT 0,
  txid TEXT,
  block_number BIGINT,
  confirmations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'partial', 'confirming', 'confirmed', 'overpaid', 'expired', 'manual')),
  expires_at TIMESTAMPTZ NOT NULL,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_usdt_deposits_status_idx
  ON shop_usdt_deposits(status, expires_at);
ALTER TABLE shop_usdt_deposits DROP CONSTRAINT IF EXISTS shop_usdt_deposits_network_check;
ALTER TABLE shop_usdt_deposits ADD CONSTRAINT shop_usdt_deposits_network_check
  CHECK (network IN ('trc20', 'bsc', 'polygon'));
ALTER TABLE shop_usdt_deposits ADD COLUMN IF NOT EXISTS scan_from_block BIGINT;
DROP INDEX IF EXISTS shop_usdt_deposits_txid_idx;
CREATE UNIQUE INDEX IF NOT EXISTS shop_usdt_deposits_network_txid_idx
  ON shop_usdt_deposits(network, txid) WHERE txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS shop_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  amount_micros BIGINT NOT NULL CHECK (amount_micros >= 0),
  reason TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shop_refunds_order_idx
  ON shop_refunds(order_id, created_at DESC);

INSERT INTO shop_suppliers (name, kind, feed_url, meta_url)
SELECT 'Aibijia', 'aibijia',
       'https://aibijia.org/live-data/products.json',
       'https://aibijia.org/live-data/meta.json'
WHERE NOT EXISTS (SELECT 1 FROM shop_suppliers WHERE kind = 'aibijia');

-- Conditional-GET / last-success bookkeeping for shop feeds
ALTER TABLE shop_suppliers ADD COLUMN IF NOT EXISTS feed_etag TEXT;
ALTER TABLE shop_suppliers ADD COLUMN IF NOT EXISTS meta_etag TEXT;
ALTER TABLE shop_suppliers ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE shop_suppliers ADD COLUMN IF NOT EXISTS last_feed_hash TEXT;

-- 2026-11-13: zyanai.cc mirror (manual procurement, public list + item pages).
-- 2026-11-16: ai-buy.vip runs the same storefront software.
ALTER TABLE shop_suppliers DROP CONSTRAINT IF EXISTS shop_suppliers_kind_check;
ALTER TABLE shop_suppliers ADD CONSTRAINT shop_suppliers_kind_check
  CHECK (kind IN ('aibijia', 'manual', 'zyanai', 'aibuy'));

INSERT INTO schema_migrations (version) VALUES ('003_shop') ON CONFLICT (version) DO NOTHING;


-- Extend existing installations created before personal Alipay support.
ALTER TABLE shop_orders DROP CONSTRAINT IF EXISTS shop_orders_payment_provider_check;
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_payment_provider_check
  CHECK (payment_provider IN ('alipay_easypay','alipay_manual','usdt_trc20','usdt_bsc','usdt_polygon','manual','balance'));

-- Widens the payment settings channel list on installations created before
-- BSC/Polygon support. The inline CHECK gets a generated name; drop both
-- possible names, then recreate it.
ALTER TABLE payment_settings DROP CONSTRAINT IF EXISTS payment_settings_channel_check;
ALTER TABLE payment_settings ADD CONSTRAINT payment_settings_channel_check
  CHECK (channel IN ('alipay_manual','usdt_trc20','usdt_bsc','usdt_polygon'));

-- Customer announcements. An announcement is visible while active and inside
-- its optional start/end window. The public bar shows the newest pinned item;
-- /announcements lists everything currently visible.
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('info', 'success', 'warning')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_public_idx
  ON announcements(active, pinned DESC, starts_at DESC, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('004_announcements')
ON CONFLICT (version) DO NOTHING;

-- Generic admin-managed integration settings. Values are encrypted with
-- APP_ENCRYPTION_KEY (same scheme as payment_settings).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('005_app_settings')
ON CONFLICT (version) DO NOTHING;

-- Public help center, mirrored from the supplier's public help pages by
-- /api/internal/help/sync (n8n every six hours) and by /admin/help.
-- body_html is stored already sanitised and with links made absolute.
CREATE TABLE IF NOT EXISTS help_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS help_articles_public_idx
  ON help_articles(visible, sort_order, published_at DESC);

INSERT INTO schema_migrations (version) VALUES ('006_help_articles')
ON CONFLICT (version) DO NOTHING;

-- Mirrored shop images. Supplier images are copied into Postgres (content
-- addressed by sha256) and served from our own domain, so a product page never
-- hotlinks a supplier. A stored image is immutable: the hash changes when the
-- bytes do, which lets /api/shop/images cache forever. All DDL below must stay
-- idempotent because schema.sql runs in full on every start.
CREATE TABLE IF NOT EXISTS shop_images (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_product_images (
  product_id UUID NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cover', 'description')),
  position INTEGER NOT NULL DEFAULT 0,
  image_hash TEXT NOT NULL REFERENCES shop_images(hash) ON DELETE CASCADE,
  alt TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, kind, position)
);
CREATE INDEX IF NOT EXISTS shop_product_images_product_idx
  ON shop_product_images(product_id, kind, position);

-- Help articles shown alongside a mirrored product.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS help_article_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Public category rail. Mirrors the supplier's category taxonomy with our own
-- neutral labels; empty falls back to the brand at read time.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS display_category TEXT NOT NULL DEFAULT '';

-- Supplier article markup, scrubbed and with images mirrored to our domain.
-- The plain-text description stays as the fallback for older rows.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS description_html TEXT NOT NULL DEFAULT '';

-- Embedded media for mirrored help articles (tutorial videos and screenshots).
-- Kept separate from shop_images so product cards never scan video rows; the
-- public URL is /api/shop/media/<hash>.<ext> and the route supports Range.
CREATE TABLE IF NOT EXISTS shop_media (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Source URL -> stored media. Lets the hourly help sync reuse a 10 MB clip
-- instead of downloading it again on every run.
CREATE TABLE IF NOT EXISTS shop_media_sources (
  source_url TEXT PRIMARY KEY,
  media_hash TEXT NOT NULL REFERENCES shop_media(hash) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A price the operator edited by hand. Scheduled supply syncs refresh copy and
-- supplier cost, but must not undo a deliberate retail price. Saving a changed
-- price in the admin form sets this flag; "恢复自动定价" clears it.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS price_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS price_locked_at TIMESTAMPTZ;

-- Operator-forced preorder (预定单). Some listings are sourced on demand even
-- while the supplier shows stock. Kept in its own column so scheduled syncs can
-- refresh availability and the supplier marker without clearing this switch.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS preorder_manual BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- Support tickets: customer-submitted issues with an operator reply thread.
-- ============================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES shop_orders(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  customer_read_at TIMESTAMPTZ,
  admin_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx
  ON support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON support_tickets(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('customer', 'admin')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
  ON support_ticket_messages(ticket_id, created_at ASC);

-- ============================================================================
-- 工单图片：客户需要发收款码、报错截图给运营，纯文字说不清。
--
-- 图片存独立表（不进 shop_images，那是商品图，生命周期和访问控制都不一样）。
-- 只允许图片 MIME、限制大小，字节存 BYTEA；按 sha256 去重，同一张图多次上传
-- 只存一份。读取走带鉴权的路由，不做公开静态资源。
-- 纯加法迁移：新表，不改既有表。
-- ============================================================================
CREATE TABLE IF NOT EXISTS support_images (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 消息与图片是多对多：一条消息可以带多张图，同一张图也可以出现在多条消息里。
CREATE TABLE IF NOT EXISTS support_message_images (
  message_id UUID NOT NULL REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
  image_hash TEXT NOT NULL REFERENCES support_images(hash) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, image_hash)
);
CREATE INDEX IF NOT EXISTS support_message_images_hash_idx
  ON support_message_images(image_hash);

-- 客户付款凭证截图（支付宝付款成功页 / 账单详情）。图片本身仍然存在
-- support_images 里，按内容寻址去重；这里只记录它挂在哪张订单上。
--
-- 截图是「人证」：上面通常有付款时间、金额，以及客户填的订单号备注。
-- 运营拿它和支付宝账单（官方数据）交叉核对，两边对上才确认到账。
CREATE TABLE IF NOT EXISTS manual_payment_images (
  order_id UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  image_hash TEXT NOT NULL REFERENCES support_images(hash) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, image_hash)
);
CREATE INDEX IF NOT EXISTS manual_payment_images_hash_idx
  ON manual_payment_images(image_hash);

-- 支付宝账单（CSV / 交易流水证明）导入后的每一笔收支。
--
-- 个人支付宝没有能给第三方读账单的接口，只能运营手动导出再传进来。导入后
-- 按「备注里的订单号」→「金额唯一匹配」的顺序自动归属，剩下的留给人工。
-- trade_no 唯一，同一份账单重复导入不会产生重复流水。
CREATE TABLE IF NOT EXISTS alipay_statement_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_no TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  amount_micros BIGINT NOT NULL CHECK (amount_micros > 0),
  direction TEXT NOT NULL DEFAULT 'income' CHECK (direction IN ('income', 'expense', 'other')),
  trade_status TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  counterparty_account TEXT NOT NULL DEFAULT '',
  product_desc TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  order_id UUID REFERENCES shop_orders(id) ON DELETE SET NULL,
  order_no TEXT,
  match_kind TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_kind IN ('order_no', 'amount_unique', 'amount_multi', 'unmatched', 'manual')),
  settled_at TIMESTAMPTZ,
  imported_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alipay_statement_rows_pending_idx
  ON alipay_statement_rows(settled_at, occurred_at DESC);
CREATE INDEX IF NOT EXISTS alipay_statement_rows_order_idx
  ON alipay_statement_rows(order_id);

-- Per-side read timestamps: unread messages are derived by counting the other
-- party's messages newer than this timestamp.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS customer_read_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_read_at TIMESTAMPTZ;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS unread_by_customer;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS unread_by_admin;

-- ============================================================================
-- 商品规格（宝贝类型）：同一个商品页可选多个档位，各档有自己的售价、质保、
-- 可售状态和货源；订单项保存档位快照，历史订单不受后续改档影响。
-- 纯加法迁移：新表 + 可空列，旧商品（无档位）行为不变。
-- ============================================================================
CREATE TABLE IF NOT EXISTS shop_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  variant_key TEXT NOT NULL,
  label TEXT NOT NULL,
  badge TEXT NOT NULL DEFAULT '',
  price_micros BIGINT NOT NULL DEFAULT 0 CHECK (price_micros >= 0),
  warranty_type TEXT NOT NULL DEFAULT 'first_login'
    CHECK (warranty_type IN ('first_login', 'days', 'none')),
  warranty_days INTEGER NOT NULL DEFAULT 0 CHECK (warranty_days >= 0),
  warranty_note TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (availability IN ('in_stock', 'low_stock', 'out_of_stock', 'paused')),
  preorder_manual BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, variant_key)
);
CREATE INDEX IF NOT EXISTS shop_product_variants_product_idx
  ON shop_product_variants(product_id, active, sort_order);

ALTER TABLE shop_product_sources
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES shop_product_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS shop_product_sources_variant_idx
  ON shop_product_sources(variant_id);

ALTER TABLE shop_order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES shop_product_variants(id) ON DELETE SET NULL;
ALTER TABLE shop_order_items
  ADD COLUMN IF NOT EXISTS variant_label TEXT NOT NULL DEFAULT '';

-- 2026-11-15: public product slugs must not carry supplier identity. Older
-- rows used `zy-<id>` (supplier prefix) and the AI importer wrote
-- `auto-<supplier>-...`. The app now generates neutral slugs and 301s the old
-- URLs. Guarded updates keep a pre-existing target slug from aborting startup.
UPDATE shop_products AS p
   SET slug = 'p-' || substr(p.slug, 4)
 WHERE p.slug LIKE 'zy-%'
   AND NOT EXISTS (
     SELECT 1 FROM shop_products AS q WHERE q.slug = 'p-' || substr(p.slug, 4)
   );
UPDATE shop_products AS p
   SET slug = regexp_replace(
         p.slug,
         '^auto-(zyanai|aibijia|aibuji|wzyp|lovecodex|ldxp|kapay|beibei|aisou|talkai|gshh)-',
         'auto-'
       )
 WHERE p.slug ~ '^auto-(zyanai|aibijia|aibuji|wzyp|lovecodex|ldxp|kapay|beibei|aisou|talkai|gshh)-'
   AND NOT EXISTS (
     SELECT 1 FROM shop_products AS q
      WHERE q.slug = regexp_replace(
              p.slug,
              '^auto-(zyanai|aibijia|aibuji|wzyp|lovecodex|ldxp|kapay|beibei|aisou|talkai|gshh)-',
              'auto-'
            )
   );

-- ============================================================================
-- 007_site_visits：访客首次到访记录（仅运营后台可见）
--
-- 只记录匿名访客的第一次到访：访客 ID 由浏览器生成并存 30 天 cookie，
-- 注册/登录时用该 ID 回填 user_id，把访客与账号关联。IP 完整入库，界面
-- 一律脱敏展示；30 天前的记录由打点接口和后台页自动清理。
-- 纯加法迁移：新表，不改动既有表。
-- ============================================================================
CREATE TABLE IF NOT EXISTS site_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  landing_path TEXT NOT NULL DEFAULT '',
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_visits_visitor_idx
  ON site_visits(visitor_id);
CREATE INDEX IF NOT EXISTS site_visits_created_idx
  ON site_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS site_visits_user_idx
  ON site_visits(user_id)
  WHERE user_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('007_site_visits') ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- 008_shop_display_sales：商品页展示货源的真实库存与已售
--
-- 两个数字全部来自上游公开数据，不做任何人工编造：
--   supplier_sold   上游累计已售（含我们自己的采购，不会重复计数）
--   supplier_stock  上游当前库存；-1 表示"充足/无限"，不代表具体件数
--   supplier_synced_at 最近一次从货源刷新这两个数的时间
--
-- 页面显示「已售 N · 库存还剩 M」。库存以货源为准：上游没货我们就卖不了，
-- 所以 stock 归零时商品页转缺货、下单被拒。每次货源同步刷新这两个数。
-- 纯加法迁移：只加列，不改既有数据。
-- ============================================================================
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS supplier_sold INTEGER NOT NULL DEFAULT 0
  CHECK (supplier_sold >= 0);
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS supplier_stock INTEGER NOT NULL DEFAULT -1;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS supplier_synced_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES ('008_shop_display_sales') ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- 009_ai_eval_runs：AI 商品上架的三方案对照评测（heuristic / 单轮 / 受控 Agent）
--
-- 每次评测运行有一个 batch_id，每条样本 × 每个方案写一行。metrics 是自动
-- 指标（结构合规、泄露、价格外露、字段完整性），human_score 是人工一次性
-- 1–5 可用性打分。样本正文不进库（只存 fixture_id），避免把货源内容再复制
-- 一份到数据库里。
-- 纯加法迁移。
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  fixture_id TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('heuristic', 'single_shot', 'agent')),
  model_id TEXT,
  draft JSONB,
  metrics JSONB NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  model_calls INTEGER NOT NULL DEFAULT 0 CHECK (model_calls >= 0),
  tool_calls INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls >= 0),
  error TEXT,
  human_score SMALLINT CHECK (human_score BETWEEN 1 AND 5),
  human_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_eval_runs_batch_idx ON ai_eval_runs(batch_id, variant);
CREATE INDEX IF NOT EXISTS ai_eval_runs_created_idx ON ai_eval_runs(created_at DESC);
-- 同一批次里同一样本同一方案只允许一条，防止重复跑覆盖成脏数据。
CREATE UNIQUE INDEX IF NOT EXISTS ai_eval_runs_unique_idx
  ON ai_eval_runs(batch_id, fixture_id, variant);

INSERT INTO schema_migrations (version) VALUES ('009_ai_eval_runs') ON CONFLICT (version) DO NOTHING;
