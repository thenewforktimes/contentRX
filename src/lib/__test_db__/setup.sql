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
  daily_cost_threshold_usd numeric(10, 2) NOT NULL DEFAULT 50.00,
  monthly_cost_threshold_usd numeric(10, 2) NOT NULL DEFAULT 500.00,
  cost_pause_active boolean NOT NULL DEFAULT false,
  overage_opt_in_active boolean NOT NULL DEFAULT false,
  overage_opted_in_at timestamptz,
  auto_renewal_consented_at timestamptz,
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
  text_preview text,
  text_full text,
  suggested_rewrite text,
  suggested_diagnostic text
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
  content_type text NOT NULL,
  moment text,
  audience text,
  standard_id text NOT NULL,
  rule_version text,
  severity text NOT NULL,
  source text NOT NULL,
  rule text,
  issue text,
  suggestion text,
  category text,
  overall_verdict text,
  review_reason text,
  review_reason_subtype text,
  check_event_id text,
  file_path text,
  run_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- customer_flagged_reviews ----------------------------------------------
CREATE TABLE customer_flagged_reviews (
  id text PRIMARY KEY,
  team_id text REFERENCES users(id) ON DELETE SET NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  violation_id text,
  text text NOT NULL,
  text_hash text NOT NULL,
  content_type text,
  moment text,
  verdict text,
  flag_reason text NOT NULL,
  customer_note text,
  source text NOT NULL,
  consent_recorded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  triaged_by text REFERENCES users(id) ON DELETE SET NULL,
  triaged_at timestamptz,
  triage_notes text,
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_flagged_reviews_open_created_idx
  ON customer_flagged_reviews (created_at)
  WHERE status = 'open';
CREATE INDEX customer_flagged_reviews_user_created_idx
  ON customer_flagged_reviews (user_id, created_at);
CREATE INDEX customer_flagged_reviews_text_hash_idx
  ON customer_flagged_reviews (text_hash);

-- overage_state ---------------------------------------------------------
-- Phase 4 of the post-Phase-1 build. Per-user, per-month overage tally.
-- claimQuotaSlots Branch C upserts here when an opted-in customer's
-- check pushes past the monthly cap. The end-of-month cron at
-- /api/cron/stripe-overage-meter reads from here and posts totals to
-- Stripe Metered Billing.
CREATE TABLE overage_state (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL,
  overage_checks integer NOT NULL DEFAULT 0,
  overage_usd_cents integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX overage_state_user_month_idx
  ON overage_state (user_id, month);

-- rationale_feedback ----------------------------------------------------
-- Pure user feedback loop (Session 21). The test harness models it so
-- pseudonymize_user's DELETE step doesn't fail on a missing table.
CREATE TABLE rationale_feedback (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  team_id text REFERENCES users(id) ON DELETE SET NULL,
  text_hash text NOT NULL,
  hop_step text NOT NULL,
  original_value text NOT NULL,
  corrected_value text,
  correction_type text NOT NULL,
  note text,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- suggestion_candidates -------------------------------------------------
-- Engine-output popularity signal (ADR 2026-04-29, narrowed by ADR
-- 2026-05-11). pseudonymize_user deletes rows scoped to the user.
CREATE TABLE suggestion_candidates (
  id text PRIMARY KEY,
  moment text,
  content_type text,
  standard_id text,
  source text NOT NULL,
  source_user_id text REFERENCES users(id) ON DELETE SET NULL,
  source_team_owner_user_id text REFERENCES users(id) ON DELETE SET NULL,
  input_hash text NOT NULL,
  candidate_text text,
  issue_context text,
  share_upstream boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- team_rules ------------------------------------------------------------
CREATE TABLE team_rules (
  id text PRIMARY KEY,
  team_owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  standard_id text NOT NULL,
  action text NOT NULL,
  rule_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- team_members ----------------------------------------------------------
CREATE TABLE team_members (
  id text PRIMARY KEY,
  team_owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

-- team_invitations ------------------------------------------------------
CREATE TABLE team_invitations (
  id text PRIMARY KEY,
  team_owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_member_user_id text REFERENCES users(id) ON DELETE SET NULL
);

-- agent_runs ------------------------------------------------------------
CREATE TABLE agent_runs (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL DEFAULT now(),
  window_days integer NOT NULL,
  total_flags integer NOT NULL,
  header_variant text NOT NULL,
  payload jsonb NOT NULL
);

-- agent_github_installations --------------------------------------------
CREATE TABLE agent_github_installations (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_installation_id integer NOT NULL,
  github_account_login text NOT NULL,
  github_account_type text NOT NULL,
  target_repo_owner text NOT NULL,
  target_repo_name text NOT NULL,
  target_branch text NOT NULL DEFAULT 'main',
  last_pr_number integer,
  last_pr_url text,
  last_pr_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- credit_packs ----------------------------------------------------------
CREATE TABLE credit_packs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_invoice_item_id text NOT NULL UNIQUE,
  credits_total integer NOT NULL,
  credits_used integer NOT NULL DEFAULT 0,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
