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

-- subscriptions ---------------------------------------------------------
CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_sub_id text NOT NULL UNIQUE,
  status text NOT NULL,
  plan text NOT NULL,
  seats int NOT NULL DEFAULT 1,
  current_period_end timestamptz
);

CREATE UNIQUE INDEX subscriptions_user_active_idx
  ON subscriptions (user_id) WHERE status = 'active';
CREATE INDEX subscriptions_user_id_idx ON subscriptions (user_id);

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
  created_at timestamptz NOT NULL DEFAULT now()
);
