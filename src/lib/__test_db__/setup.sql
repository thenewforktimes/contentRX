-- Test-only DB bootstrap for vitest pglite harness.
--
-- Hand-written to mirror the relevant slice of `src/db/schema.ts`.
-- A drift-guard test (`__test_db__/setup.test.ts`) parses schema.ts and
-- this file together, asserting that every column listed in schema.ts
-- for a table that appears here is present in the corresponding CREATE
-- TABLE. The test suite covers a subset of tables (the ones tests touch);
-- new tables get added when a test needs them.
--
-- DO NOT ENABLE RLS — schema.ts calls .enableRLS() for prod defence, but
-- the test runner connects as the schema owner; RLS would require a
-- BYPASSRLS role we don't model in tests.

-- users -----------------------------------------------------------------
CREATE TABLE users (
  id text PRIMARY KEY,
  clerk_id text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  team_owner_user_id text,
  api_key_hash text UNIQUE,
  api_key_prefix text,
  api_key_created_at timestamptz,
  stripe_customer_id text UNIQUE,
  ditto_api_key_encrypted text,
  preference_opted_out_at timestamptz,
  pseudonymized_at timestamptz,
  daily_cost_threshold_usd numeric(10, 2) NOT NULL DEFAULT 50.00,
  monthly_cost_threshold_usd numeric(10, 2) NOT NULL DEFAULT 500.00,
  cost_pause_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- usage -----------------------------------------------------------------
CREATE TABLE usage (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL,
  count int NOT NULL DEFAULT 0,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cache_read_input_tokens int NOT NULL DEFAULT 0,
  cache_creation_input_tokens int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX usage_user_month_idx ON usage (user_id, month);

-- usage_events ----------------------------------------------------------
CREATE TABLE usage_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  segment_type text NOT NULL,
  units_consumed int NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cache_read_input_tokens int NOT NULL DEFAULT 0,
  cache_creation_input_tokens int NOT NULL DEFAULT 0,
  model_id text,
  estimated_cost_usd numeric(10, 6),
  team_id text REFERENCES users(id) ON DELETE SET NULL,
  source text,
  content_type text,
  moment text,
  verdict text,
  review_reason text,
  violation_count int NOT NULL DEFAULT 0,
  text_hash text,
  text_preview text
);

CREATE INDEX usage_events_user_created_idx
  ON usage_events (user_id, created_at);
CREATE INDEX usage_events_team_created_idx
  ON usage_events (team_id, created_at);

-- subscriptions ---------------------------------------------------------
CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_sub_id text NOT NULL UNIQUE,
  status text NOT NULL,
  plan text NOT NULL,
  seats int NOT NULL DEFAULT 1,
  current_period_end timestamptz,
  pricing_tier text NOT NULL DEFAULT 'free',
  soft_cap_usd int NOT NULL DEFAULT 50,
  domain_group_id text,
  cancelled_at timestamptz
);

CREATE UNIQUE INDEX subscriptions_user_active_idx
  ON subscriptions (user_id) WHERE status = 'active';
CREATE INDEX subscriptions_user_id_idx ON subscriptions (user_id);

-- violation_overrides ---------------------------------------------------
CREATE TABLE violation_overrides (
  id text PRIMARY KEY,
  team_id text REFERENCES users(id) ON DELETE SET NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  violation_id text,
  standard_id text NOT NULL,
  moment text,
  text_hash text NOT NULL,
  override_type text NOT NULL,
  override_reason text,
  source text NOT NULL,
  override_stance text,
  actor_role text,
  rationale_expanded boolean,
  time_to_action_ms int,
  suggested_text_hash text,
  applied_text_hash text,
  override_reason_code text,
  session_id text,
  override_status text NOT NULL DEFAULT 'open',
  override_status_updated_by text REFERENCES users(id) ON DELETE SET NULL,
  override_status_updated_at timestamptz,
  override_status_notes text,
  contribute_upstream boolean NOT NULL DEFAULT false,
  text text,
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX violation_overrides_team_std_idx
  ON violation_overrides (team_id, standard_id);
CREATE INDEX violation_overrides_user_created_idx
  ON violation_overrides (user_id, created_at);
CREATE INDEX violation_overrides_team_std_moment_idx
  ON violation_overrides (team_id, standard_id, moment);
CREATE INDEX violation_overrides_violation_idx
  ON violation_overrides (violation_id);
CREATE INDEX violation_overrides_session_std_idx
  ON violation_overrides (session_id, standard_id);
CREATE INDEX violation_overrides_open_created_idx
  ON violation_overrides (created_at)
  WHERE override_status = 'open';

-- violations ------------------------------------------------------------
CREATE TABLE violations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id text REFERENCES users(id) ON DELETE SET NULL,
  text_hash text NOT NULL,
  content_type text,
  moment text,
  audience text,
  standard_id text,
  rule_version text,
  severity text,
  source text NOT NULL,
  rule text,
  issue text,
  suggestion text,
  overall_verdict text,
  review_reason text,
  review_reason_subtype text,
  check_event_id text,
  file_path text,
  run_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
