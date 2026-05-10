import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { SURFACE_SOURCES } from "@/lib/surfaces";

const cuid = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

// RLS is enabled on every table as defense-in-depth. ContentRX accesses
// the DB only via the server-side `postgres` role (Supabase pooler),
// which has BYPASSRLS — queries continue to work. Enabling RLS with no
// policies locks the tables down for any other role (e.g. PostgREST's
// anon/authenticated if that surface is ever enabled). Never rely on
// RLS as the primary auth boundary — API routes still do that.
export const users = pgTable("users", {
  id: cuid(),
  clerkId: text("clerk_id").notNull().unique(),
  // Unique to keep one users row per email. Closes audit H-07
  // (Known Limitation #5). Clerk itself doesn't allow two accounts
  // with the same primary email, so the only realistic source of a
  // duplicate would be a Clerk-side delete + re-signup with the same
  // address (which would otherwise create a second users row). With
  // unique enforced, a duplicate user.created webhook would conflict
  // and the existing onConflictDoNothing(target: clerkId) keeps
  // dedupe by clerkId — meaning the re-signup would sit on the
  // "finishing setting up" placeholder until backfill / manual
  // cleanup. Acceptable trade-off vs. silently accumulating dup rows.
  email: text("email").notNull().unique(),
  plan: text("plan", { enum: ["free", "pro", "scale", "team"] })
    .notNull()
    .default("free"),
  // Team-id-as-user-id pattern: a "team" is just a user.id (the
  // owner). Members store teamOwnerUserId pointing at the owner;
  // the owner's own row has teamOwnerUserId = null. Per-team
  // aggregations (violations.teamId, violation_overrides.teamId)
  // all reference users.id. Documented per audit H-09. Trade-off:
  // deleting a team owner cascades to every member's historical
  // attribution, dropping their rows from per-team rollups. A future
  // migration to a dedicated `teams` table would decouple lifecycle;
  // intentionally not done yet because team-invite flow isn't shipped.
  teamOwnerUserId: text("team_owner_user_id"),
  // sha256(rawKey) hex digest. Raw cx_... tokens never persist — the key
  // shown to the user once at rotation/mint time is all they get. Unique
  // so bearer lookup via eq(apiKeyHash, sha256(bearer)) hits one row or
  // zero and never needs a scan. Nullable: a user without a current key
  // has no hash and must rotate to get one.
  apiKeyHash: text("api_key_hash").unique(),
  // Display-only prefix for the dashboard ("cx_a1b2c3d4…"). Stores the
  // first 12 chars of the raw key so the UI can confirm "yes, this is
  // still the one you copied" without persisting the rest. Non-unique
  // by design — collisions are vanishingly unlikely but not disallowed.
  apiKeyPrefix: text("api_key_prefix"),
  apiKeyCreatedAt: timestamp("api_key_created_at", { withTimezone: true }),
  // Stripe Customer ID. Set on first successful checkout and reused for
  // every subsequent subscription + Customer Portal session. Persists even
  // after a cancellation so the same customer lineage continues if the
  // user re-subscribes later.
  stripeCustomerId: text("stripe_customer_id").unique(),
  dittoApiKeyEncrypted: text("ditto_api_key_encrypted"),
  // Cost monitor (Phase 1, pre-pilot launch). Daily and monthly thresholds
  // for runaway-script detection. Defaults are anomaly-catching, not
  // normal-usage-capping — Free/Pro at typical Anthropic rates of
  // $0.01–0.20 per check would never approach $50/day or $500/month.
  // Lower per-user via /admin/costs when a pilot needs tighter control.
  // When `costPauseActive` is true, /api/check returns 402 until the
  // founder clears the flag.
  dailyCostThresholdUsd: numeric("daily_cost_threshold_usd", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("50.00"),
  monthlyCostThresholdUsd: numeric("monthly_cost_threshold_usd", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("500.00"),
  costPauseActive: boolean("cost_pause_active").notNull().default(false),
  // Phase 4 of the post-Phase-1 build: paid-plan customers opt in to
  // $0.10/check overage. Default is hard-cap (false). When true,
  // claimQuotaSlots takes Branch C: grant + record overage event for
  // end-of-month metering to Stripe. Free can't opt in (validated at
  // the API route — only Pro / Team / Scale users may flip the flag).
  overageOptInActive: boolean("overage_opt_in_active")
    .notNull()
    .default(false),
  overageOptedInAt: timestamp("overage_opted_in_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const usage = pgTable(
  "usage",
  {
    id: cuid(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    count: integer("count").notNull().default(0),
    // Token telemetry (audit M-24, PR 9). Roll-up of Anthropic token
    // usage across every /api/check the user made this month.
    // Lets us answer "how much did this customer cost us?" without
    // walking the engine logs. Default 0 so back-fill on first
    // increment after deploy is monotonic.
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Cache-read input tokens are billed at ~10% of normal input cost.
    // Tracking separately so the Pro/Team unit-cost picture stays
    // accurate as PR 8 prompt caching warms the cache.
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("usage_user_month_idx").on(t.userId, t.month)],
).enableRLS();

// Per-call usage event log for daily-granularity cost roll-ups. Phase 1,
// pre-pilot launch. The existing `usage` table is monthly-aggregate; this
// table is per-call so the cost monitor can compute per-day spend without
// over-counting. One row per /api/check completion. Read by /admin/costs
// (per-day per-user spend) and the threshold-evaluation logic that pauses
// users crossing daily/monthly cost caps.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: cuid(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Schema 3.0.0 (2026-05-05): the three-tier model collapsed to a
    // length-routed size class. Drizzle's enum is TS-only (no DB CHECK
    // constraint), so the live row data on prod is unaffected by
    // narrowing the TS list. The pre-3.0.0 values
    // ("standard", "document", "surface") stayed in the enum as
    // tolerance for legacy rows, but pre-launch test data is the only
    // possible source — no real customer ever wrote one. Drop them
    // from the TS enum so future writes can't accidentally hit the
    // deprecated values, and so the dashboard's per-size-class
    // rendering doesn't have to handle phantom branches.
    segmentType: text("segment_type", {
      enum: ["small", "large"],
    }).notNull(),
    unitsConsumed: integer("units_consumed").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens")
      .notNull()
      .default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .notNull()
      .default(0),
    modelId: text("model_id"),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 10,
      scale: 6,
    }),
    // Customer-facing check-history fields. Populated on every
    // successful /api/check completion so /dashboard/checks can show
    // the user their own activity. Privacy: text_preview is a
    // truncated copy of the input (first 80 chars) so the customer
    // can recognise what they checked. Customer-not-product principle
    // (ADR 2026-04-28) — the customer's own data, shown back to the
    // customer, is not aggregation or profiling. Future TTL job will
    // null text_preview after 90 days.
    teamId: text("team_id").references(() => users.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: SURFACE_SOURCES }),
    contentType: text("content_type"),
    moment: text("moment"),
    verdict: text("verdict"),
    reviewReason: text("review_reason"),
    violationCount: integer("violation_count").notNull().default(0),
    textHash: text("text_hash"),
    textPreview: text("text_preview"),
  },
  (t) => [
    // Primary access pattern: sum estimated_cost_usd for one user across
    // a time window (today, this month). The composite (userId, createdAt)
    // covers both per-user and per-user-per-day rollups efficiently.
    index("usage_events_user_created_idx").on(t.userId, t.createdAt),
    // Check-history hot path: list a team's recent checks ordered by
    // recency. Team-scoped because a Team-plan teammate sees the
    // owner's history alongside their own (intentional — see /dashboard
    // section in CLAUDE.md).
    index("usage_events_team_created_idx").on(t.teamId, t.createdAt),
  ],
).enableRLS();

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: cuid(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubId: text("stripe_sub_id").notNull().unique(),
    status: text("status").notNull(),
    plan: text("plan", { enum: ["pro", "team"] }).notNull(),
    seats: integer("seats").notNull().default(1),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    // PR-03 (pricing-and-unit-of-value-strategy 2026-04-26): launch SKU
    // additions. Coexist with `plan` until PR-07 reconciles. `plan` stays
    // the legacy 2-value enum; `pricingTier` is the forward-looking
    // 4-value enum that includes Scale.
    pricingTier: text("pricing_tier", {
      enum: ["free", "pro", "scale", "team"],
    })
      .notNull()
      .default("free"),
    // Customer-set spend ceiling for overage charges. PR-09 reads this
    // pre-call and 402s when the projected overage cost would cross it.
    // Defaults to $50 (Pro default per the pricing doc); Scale defaults
    // to $200 but that's set by the Checkout/upgrade flow, not here.
    softCapUsd: integer("soft_cap_usd").notNull().default(50),
    // Domain-grouping rollup. PR-21 sets this when 3+ same-domain
    // subscriptions are detected on Pro/Scale; the dashboard uses it
    // to surface team-level views without a Team purchase decision.
    domainGroupId: text("domain_group_id"),
    // PR-31 (90-day retention). Set when the Stripe webhook fires
    // `customer.subscription.deleted` for this row. The pseudonymize
    // cron uses this + a 90-day floor to decide which users to
    // anonymize. Distinct from `currentPeriodEnd` (which is when the
    // paid period ends — they keep access until then).
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    // Exactly one active subscription per user. Historical rows with
    // status="canceled" / "incomplete_expired" are legitimate and allowed.
    // Closes CLAUDE.md known limitation #6.
    uniqueIndex("subscriptions_user_active_idx")
      .on(t.userId)
      .where(sql`status = 'active'`),
    // FK index so cascade-delete on users doesn't full-scan this table.
    // The partial unique above only covers status='active' rows; we need
    // a plain index on user_id to make `DELETE FROM users WHERE id=?`
    // proportional to the user's subscription history rather than the
    // whole subscriptions table. Audit 2026-04-26 P1.
    index("subscriptions_user_id_idx").on(t.userId),
  ],
).enableRLS();

export const teamMembers = pgTable(
  "team_members",
  {
    id: cuid(),
    teamOwnerUserId: text("team_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memberUserId: text("member_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    // A user can be a member of a given team exactly once. Prevents
    // double-invites from inflating seat counts in analytics (Session 17).
    uniqueIndex("team_members_owner_member_idx").on(
      t.teamOwnerUserId,
      t.memberUserId,
    ),
    // FK index on member_user_id. Without this, "list all teams this
    // user is a member of" scans the whole table. Owner-side is covered
    // by the leading column of the composite unique index above.
    index("team_members_member_idx").on(t.memberUserId),
  ],
).enableRLS();

export const teamRules = pgTable(
  "team_rules",
  {
    id: cuid(),
    teamOwnerUserId: text("team_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    standardId: text("standard_id").notNull(),
    action: text("action", { enum: ["disable", "override", "add"] }).notNull(),
    ruleJson: jsonb("rule_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("team_rules_team_std_action_idx").on(
      t.teamOwnerUserId,
      t.standardId,
      t.action,
    ),
  ],
).enableRLS();

export const violations = pgTable(
  "violations",
  {
    id: cuid(),
    // userId is nullable + set-null on delete (audit H-08): when a
    // Clerk user.deleted event fires, the user identity is removed but
    // the violation row stays with userId=null. Preserves anonymized
    // training data for engine calibration without retaining personal
    // attribution. GDPR-friendly default. teamId already follows the
    // same pattern (team-id-as-user-id, owner deletion drops the team
    // link but keeps the row).
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    teamId: text("team_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    contentType: text("content_type").notNull(),
    moment: text("moment"),
    standardId: text("standard_id").notNull(),
    severity: text("severity").notNull(),
    textHash: text("text_hash").notNull(),
    source: text("source", { enum: SURFACE_SOURCES }).notNull(),
    // Source-file path for violations that originated from CI extraction
    // (GitHub Action runs against a repo). Nullable because plugin and
    // CLI checks have no file context. Powers the "Top files" panel in
    // team analytics.
    filePath: text("file_path"),
    // Session 34 activation (refinement-signals endpoint): groups every
    // violation row from the same /api/check call so co-firing standards
    // and standards_conflict clusters can be reconstructed. Cuid set at
    // log time by the check route. Nullable on pre-migration rows; new
    // rows always have it.
    checkEventId: text("check_event_id"),
    // Session 34 activation: captures CheckResult.review_reason (Session 2
    // subtypes) when the engine flagged the whole evaluation for review.
    // Enum at the app layer (engine emits one of the Session 2/13 values);
    // not enforced at the DB level because new subtypes may ship without
    // a migration.
    reviewReasonSubtype: text("review_reason_subtype"),
    // PR-40 — groups every violation logged during the same external
    // run. The GitHub Action sets this to GITHUB_RUN_ID so the
    // dashboard can render `/dashboard/runs/<run_id>` long after the
    // PR comment is gone (PRs close, action logs roll over, but the
    // dashboard view survives). Nullable: plugin/CLI/MCP/LSP/inline
    // checks have no run grouping.
    runId: text("run_id"),
  },
  (t) => [
    index("violations_user_created_idx").on(t.userId, t.createdAt),
    index("violations_team_created_idx").on(t.teamId, t.createdAt),
    index("violations_team_file_idx").on(t.teamId, t.filePath),
    // Session 34: cluster reconstruction (standards_conflict,
    // co-firing) needs to group by check.
    index("violations_check_event_idx").on(t.checkEventId),
    // Session 34: OOD / conflict clustering filters by subtype + window.
    index("violations_subtype_created_idx").on(
      t.reviewReasonSubtype,
      t.createdAt,
    ),
    // PR-40: per-run dashboard page query — `WHERE team_id = $1 AND
    // run_id = $2` ordered by createdAt.
    index("violations_team_run_idx").on(t.teamId, t.runId, t.createdAt),
  ],
).enableRLS();

export const dittoSyncs = pgTable(
  "ditto_syncs",
  {
    id: cuid(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // FK index on user_id so "list a user's ditto syncs" hits an index
    // instead of scanning the table.
    index("ditto_syncs_user_idx").on(t.userId),
  ],
).enableRLS();

// Violation overrides — Session 11 of BUILD_PLAN_v2.
//
// Captures every time a user dismisses, accepts-as-review, or marks-as-
// false-positive a violation. This is the implicit-labeling feedback
// loop: aggregated override rates surface "rules your team disagrees
// with" (dashboard) and "rules >25% of all teams override" (admin
// review queue) — the data behind the human-eval differentiator.
//
// Privacy: only the sha256 of the offending text persists. The team_id
// scopes per-team analytics; the standard_id + moment scope global
// rollups. No plaintext, ever.
export const violationOverrides = pgTable(
  "violation_overrides",
  {
    id: cuid(),
    teamId: text("team_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // userId is nullable + set-null on delete (audit H-08). Same
    // rationale as violations.userId — preserve the override signal
    // for engine calibration after the user is removed.
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Optional pointer to the originating violations row, when the
    // override comes from a logged violation (plugin dismiss). PR-comment
    // ignores from CI may not have a single source row, so this stays
    // nullable.
    violationId: text("violation_id").references(() => violations.id, {
      onDelete: "set null",
    }),
    standardId: text("standard_id").notNull(),
    moment: text("moment"),
    textHash: text("text_hash").notNull(),
    overrideType: text("override_type", {
      enum: ["dismiss", "accept_as_review", "mark_false_positive"],
    }).notNull(),
    overrideReason: text("override_reason"),
    source: text("source", {
      enum: ["plugin", "cli", "action", "dashboard", "lsp", "mcp"],
    }).notNull(),
    // Human-eval build plan Session 3 — richer override signal.
    //
    // `overrideStance` is the three-button verdict: whether the user
    // agrees with the finding, disagrees, or agrees-but-is-shipping-
    // anyway. This is a different axis from `overrideType` (which
    // describes what they did with the finding) — together they give
    // the reviewer both stance and action. Nullable on existing rows
    // because pre-Session-3 clients didn't capture it.
    overrideStance: text("override_stance", {
      enum: ["agree", "disagree", "agree_but_overriding"],
    }),
    // `actorRole` weights the signal. A content-designer override is
    // more informative than an engineer override in most cases, but
    // both are captured. Inferred at the surface or supplied by the
    // user. `other` covers cases where we can't infer.
    actorRole: text("actor_role", {
      enum: ["designer", "engineer", "pm", "other"],
    }),
    // `rationaleExpanded` — did the user click to expand the rationale
    // before taking action? Feeds the four-quadrant behavior model
    // (pattern-match / informed / reflex).
    rationaleExpanded: boolean("rationale_expanded"),
    // `timeToActionMs` — elapsed ms from verdict surfaced to user
    // action. Short + unexpanded ≈ reflex; short + expanded ≈
    // pattern-match after confirmation; long ≈ informed decision.
    timeToActionMs: integer("time_to_action_ms"),
    // Counterfactual triple — captured when the user rewrote the
    // flagged string. `textHash` is the original; `suggestedTextHash`
    // is what the tool proposed; `appliedTextHash` is what the user
    // actually shipped. When all three hashes differ, the eval is
    // flagged as `suggestion_rejected_alternative_applied` during
    // review — derivable from the hashes, not stored.
    suggestedTextHash: text("suggested_text_hash"),
    appliedTextHash: text("applied_text_hash"),
    // Human-eval build plan Session 4 — structured reason + session.
    //
    // `overrideReasonCode` is the five-item user-facing vocabulary (see
    // src/lib/override-reasons.ts). Distinct from Robert's triage_category
    // — the two feed different loops. The existing free-text
    // `overrideReason` column stays for optional single-line detail.
    overrideReasonCode: text("override_reason_code", {
      enum: [
        "not_applicable_here",
        "standard_too_strict",
        "fix_is_worse",
        "shipping_anyway",
        "confusing_need_more_context",
      ],
    }),
    // `sessionId` groups overrides from the same Figma scan, CI run, or
    // web session. Three+ overrides on the same standard inside one
    // session collapse to a single `standard_pushback` row in the
    // review queue (dashboard + Session 8). Nullable — legacy rows
    // without a session fall back to user+time-window grouping.
    sessionId: text("session_id"),
    // Founder-side triage state (Phase 5, pre-pilot launch). Every
    // dismissal lands as `open`; the founder triages each into one of
    // two resolved states from `/admin/overrides`:
    //   - addressed_patch     → routed into the patch queue
    //                           (rule needs work)
    //   - not_actionable      → pilot was wrong; rule fired correctly
    // `open` overrides surface in the inbox by default; resolved ones
    // hide unless explicitly filtered in.
    //
    // Per ADR 2026-05-11 the override row no longer carries plaintext
    // or a corpus-contribution path. Overrides are a private record of
    // the customer's own dismissals. Calibration corpus contributions
    // come exclusively through the Flag-for-Review consent flow
    // (`customer_flagged_reviews`).
    overrideStatus: text("override_status", {
      enum: ["open", "addressed_patch", "not_actionable"],
    })
      .notNull()
      .default("open"),
    overrideStatusUpdatedBy: text("override_status_updated_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    overrideStatusUpdatedAt: timestamp("override_status_updated_at", {
      withTimezone: true,
    }),
    overrideStatusNotes: text("override_status_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("violation_overrides_team_std_idx").on(t.teamId, t.standardId),
    index("violation_overrides_user_created_idx").on(t.userId, t.createdAt),
    // Aggregation hot path: counts per (team, standard, moment).
    index("violation_overrides_team_std_moment_idx").on(
      t.teamId,
      t.standardId,
      t.moment,
    ),
    // FK index on violation_id. When a violation is deleted, PG has to
    // find all overrides pointing at it to apply ON DELETE SET NULL —
    // without this, that's a table scan.
    index("violation_overrides_violation_idx").on(t.violationId),
    // Session aggregation hot path (Session 4): group-by
    // (session_id, standard_id) to collapse into standard_pushback.
    index("violation_overrides_session_std_idx").on(t.sessionId, t.standardId),
    // Inbox hot path (Phase 5): the override inbox lists rows where
    // override_status = 'open' sorted by created_at DESC. Partial
    // index keeps the index small since most resolved rows fall out.
    index("violation_overrides_open_created_idx")
      .on(t.createdAt)
      .where(sql`override_status = 'open'`),
  ],
).enableRLS();

// Suggestion candidates — ADR 2026-04-29 (suggestion calibration loop),
// scope narrowed by ADR 2026-05-11 to a single source.
//
// Engine-output popularity signal: when a customer copies a suggestion
// the engine produced, a row lands here with the engine's own
// `candidateText` and `shareUpstream = false`. No customer input
// strings ever land in this table; that path is `customer_flagged_reviews`,
// reached only through the Flag-for-Review consent flow.
//
// The founder /admin queue can promote rows into PRECEDENTS (the curated
// set the runtime LLM context reads). Only Robert's curation reaches the
// runtime prompt — customers never poison the model directly.
//
// Privacy: per ADR 2026-04-28 and ADR 2026-05-11, every text-bearing field
// is PII-screened before write (handled at the route layer via
// src/lib/pii-screen.ts). `shareUpstream` is hardcoded false for the
// remaining writer; the field stays for substrate-side queries that
// historically gated on it.
//
// Substrate context (moment, contentType, standardId) is server-side-
// correlated at write time by joining against the violations table via
// (userId, textHash). When correlation finds no match (race, deletion),
// the fields stay nullable and Robert's triage assigns them at /admin
// review time.
export const suggestionCandidates = pgTable(
  "suggestion_candidates",
  {
    id: cuid(),
    // Substrate bucket axes — populated server-side by correlating
    // against the violations table. Nullable because correlation may
    // miss; /admin triage backfills.
    moment: text("moment"),
    contentType: text("content_type"),
    standardId: text("standard_id"),
    // Source. After ADR 2026-05-11 the only remaining writer is the
    // copy-event route (engine-suggestion popularity tracking). The
    // customer_rewrite / team_rule / preference_pair sources are
    // retired with their respective callers.
    source: text("source", {
      enum: ["customer_copy"],
    }).notNull(),
    // Who emitted the signal. Nullable + set-null on delete to keep the
    // signal alive past account deletion (audit H-08 pattern).
    sourceUserId: text("source_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Team scope for opt-out tracking. When a row's team_owner_user_id
    // is set, it's visible to that team's admins regardless of
    // share_upstream. share_upstream additionally exposes it to /admin.
    sourceTeamOwnerUserId: text("source_team_owner_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    // sha256 of the input string the customer was checking. Same
    // hashing convention as violations.textHash. Used for clustering
    // and de-dup at /admin triage time.
    inputHash: text("input_hash").notNull(),
    // The LLM's own suggestion (engine output, not PII). Nullable when
    // the source row doesn't carry a candidate string.
    candidateText: text("candidate_text"),
    // Optional issue/notes context, useful for clustering at triage.
    // Carries the public-envelope `issue` field for customer-source
    // rows; null otherwise. PII-screened.
    issueContext: text("issue_context"),
    // Customer's explicit opt-in, per ADR 2026-04-28. Default FALSE.
    // FALSE = team-private. TRUE = eligible for /admin triage and
    // (after approval) promotion to suggestion_precedents.
    shareUpstream: boolean("share_upstream").notNull().default(false),
    // Triage state. Pending = unreviewed; Approved = promoted to
    // suggestion_precedents (Block 2a); Rejected = slop, kept for
    // metrics; Merged = combined into an existing precedent.
    status: text("status", {
      enum: ["pending", "approved", "rejected", "merged"],
    })
      .notNull()
      .default("pending"),
    reviewedBy: text("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // /admin triage hot path: bucket by (moment, content_type,
    // standard_id) and filter on status. Partial index on pending
    // rows — the queue Robert reads — keeps the index small.
    index("suggestion_candidates_bucket_status_idx").on(
      t.moment,
      t.contentType,
      t.standardId,
      t.status,
    ),
    // Team-private slice: when a customer's row is share_upstream=false,
    // it still surfaces to that team's analytics. This index supports
    // "show me my team's candidates."
    index("suggestion_candidates_team_idx").on(t.sourceTeamOwnerUserId),
    // FK index on source_user_id for the deletion cascade.
    index("suggestion_candidates_user_idx").on(t.sourceUserId),
    // Browsing: most recent first within a bucket.
    index("suggestion_candidates_created_idx").on(t.createdAt),
  ],
).enableRLS();

// Suggestion precedents — ADR 2026-04-29 (Phase 2 Block 2a).
//
// The CURATED side of the two-tier signal architecture. Robert's
// /admin triage promotes vetted suggestion_candidates rows here.
// At runtime, the LLM scan prompt's precedent retrieval (Block 2c)
// reads ONLY this table — never the noisy candidates table — so
// customer signal can't poison the model's voice without founder
// curation.
//
// Each row is one canonical good suggestion for a specific bucket
// (moment, content_type, standard_id). When multiple candidates
// are merged into one precedent, sample_size aggregates so retrieval
// can rank precedents by approval frequency.
//
// Privacy: approved_text is founder-curated content. PII pre-screen
// runs on /admin triage writes the same way it runs on customer
// /api/violations/adjust writes (defense in depth).
export const suggestionPrecedents = pgTable(
  "suggestion_precedents",
  {
    id: cuid(),
    // Bucket axes — REQUIRED for precedents (unlike candidates,
    // where they can be null pending triage). The retrieval module
    // reads on (moment, content_type, standard_id) directly; without
    // those, a precedent can't be matched to a runtime check.
    moment: text("moment").notNull(),
    contentType: text("content_type").notNull(),
    standardId: text("standard_id").notNull(),
    // The curated suggestion text. PII-screened on insert.
    approvedText: text("approved_text").notNull(),
    // Founder who promoted this precedent. set-null on delete to
    // keep the precedent alive past account changes (audit H-08).
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Optional traceability back to the candidate that seeded the
    // precedent. set-null on delete: candidates may be archived,
    // but the precedent stays.
    sourceCandidateId: text("source_candidate_id").references(
      () => suggestionCandidates.id,
      { onDelete: "set null" },
    ),
    // How many candidates have been merged into this precedent (or
    // approved as exact duplicates). Higher sample_size = stronger
    // signal at retrieval time.
    sampleSize: integer("sample_size").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Retrieval hot path: per-request bucket lookup with top-N by
    // sample_size DESC, created_at DESC. The runtime lookup has a
    // hard top-3 cap so cluster sizes never bloat the prompt.
    index("suggestion_precedents_bucket_idx").on(
      t.moment,
      t.contentType,
      t.standardId,
    ),
    // /admin browsing: recent approvals stream.
    index("suggestion_precedents_approved_at_idx").on(t.approvedAt),
    // FK index on source_candidate_id for the deletion cascade.
    index("suggestion_precedents_source_idx").on(t.sourceCandidateId),
  ],
).enableRLS();

// Graduation status per standard — human-eval build plan Session 10.
//
// Stores the current graduation level per standard (robo_labels →
// batch_approval → autonomous) plus the last readiness snapshot and
// audit metadata. Session 11's graduation UI reads + writes via the
// helpers in src/lib/graduation.ts; the metrics tool
// (`tools/graduation_metrics.py`) is the primary writer.
//
// Kept append-only via `history` JSONB: every promotion / demotion
// adds a snapshot entry so the ladder's audit trail survives
// recalibrations.
export const graduationStatus = pgTable(
  "graduation_status",
  {
    id: cuid(),
    standardId: text("standard_id").notNull().unique(),
    level: text("level", {
      enum: ["robo_labels", "batch_approval", "autonomous"],
    })
      .notNull()
      .default("robo_labels"),
    // Last computed readiness snapshot — the full per-criterion dict
    // from `tools/graduation_metrics.py`. Stored so the dashboard can
    // show breakdowns without re-running the tool.
    lastReadiness: jsonb("last_readiness"),
    lastReadinessAt: timestamp("last_readiness_at", { withTimezone: true }),
    // Append-only audit trail. Each entry: {level, reason, at, approver}.
    history: jsonb("history").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("graduation_status_level_idx").on(t.level),
  ],
).enableRLS();

// Rationale-chain feedback — human-eval build plan Session 21.
//
// When a user surfaces the rationale chain on a verdict and disagrees
// with one of its hops (most commonly the moment-detection hop),
// clicking the "Not this <hop>?" button posts a row here. The plan's
// acceptance criterion routes these into the review queue with
// subtype `situation_ambiguity` — we tag the correction_type accordingly
// so Session 8's review-queue reader can aggregate them alongside
// pipeline-emitted situation_ambiguity signals.
//
// Privacy: only `textHash` is persisted. The corrected value is the
// short identifier the user picked (e.g. a moment ID), not free-form
// content — it's safe to store in plaintext. `note` is optional, user-
// provided free-text and bounded at the route layer to 500 chars so
// one mis-click can't dump a paragraph.
export const rationaleFeedback = pgTable(
  "rationale_feedback",
  {
    id: cuid(),
    // userId nullable + set-null on delete (audit H-08). Anonymized
    // rationale-correction signal preserved for engine calibration.
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    teamId: text("team_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // sha256 of the user's text. Same convention as `violations.textHash`
    // so an administrator can cross-reference feedback to the original
    // check without either side holding plaintext.
    textHash: text("text_hash").notNull(),
    // Canonical pipeline hop names — mirrors VALID_HOPS in
    // src/content_checker/models.py. The enum is not locked at the DB
    // level because new hops might land without a schema migration;
    // the route layer validates membership against the TS constant.
    hopStep: text("hop_step").notNull(),
    // The user-observed value the hop emitted. For moment-detection
    // that's a moment ID; for classify it's a content_type ID; for
    // scan/validate it's typically a standard_id that the user
    // disagrees with being flagged.
    originalValue: text("original_value").notNull(),
    // Optional — the value the user thinks was correct. For
    // moment-misdetection: the moment they would have picked. Nullable
    // because "not this" alone is a useful signal even without a
    // proposed correction.
    correctedValue: text("corrected_value"),
    // Maps this feedback to a review_reason subtype in the Python
    // engine's vocabulary. The plan's explicit target is
    // `situation_ambiguity`; `other` is a catch-all for future hop
    // feedback (e.g. content_type misclassification) that's not
    // about moments per se.
    correctionType: text("correction_type", {
      enum: ["situation_ambiguity", "other"],
    }).notNull(),
    note: text("note"),
    source: text("source", {
      enum: ["plugin", "cli", "action", "dashboard", "mcp"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Aggregation hot path: counts per (correction_type, hop_step,
    // original_value). Matches the review-queue "which moment gets
    // misdetected most" drill-down.
    index("rationale_feedback_type_hop_value_idx").on(
      t.correctionType,
      t.hopStep,
      t.originalValue,
    ),
    index("rationale_feedback_user_created_idx").on(t.userId, t.createdAt),
  ],
).enableRLS();

// Audit Pack credits — one row per pack purchase. PR-06 inserts on
// successful Stripe webhook for the one-time invoice item. /api/check
// (PR-08) deducts pack credits BEFORE subscription quota when both
// exist, so audit-burst customers don't accidentally drain their
// monthly subscription before their pack. Pack credits expire 90 days
// after purchase; the cron job in PR-31 would reap rows past expiry
// (unused credits forfeit, by design — expiry creates urgency).
export const creditPacks = pgTable(
  "credit_packs",
  {
    id: cuid(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeInvoiceItemId: text("stripe_invoice_item_id").notNull(),
    creditsTotal: integer("credits_total").notNull(),
    creditsUsed: integer("credits_used").notNull().default(0),
    purchasedAt: timestamp("purchased_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    // Stripe sends an idempotency key on the invoice item — uniqueness
    // here prevents double-credit if the webhook retries.
    uniqueIndex("credit_packs_invoice_item_idx").on(t.stripeInvoiceItemId),
    // Hot path: "does this user have any active pack credits?" — filter
    // on userId + expiresAt > now ordered by purchasedAt asc.
    index("credit_packs_user_expires_idx").on(t.userId, t.expiresAt),
  ],
).enableRLS();

// Per-user, per-month overage tally. PR-09 reads this to project the
// month-end overage cost on each /api/check call and 402s when the
// projection crosses softCapUsd. Stripe Metered Billing is the source
// of truth for billing; this row is a fast local cache so the hot
// path doesn't have to round-trip Stripe on every call.
export const overageState = pgTable(
  "overage_state",
  {
    id: cuid(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // 'YYYY-MM'
    overageChecks: integer("overage_checks").notNull().default(0),
    overageUsdCents: integer("overage_usd_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row per user per month. Closes a race on the first overage
    // increment (concurrent requests would otherwise create dup rows).
    uniqueIndex("overage_state_user_month_idx").on(t.userId, t.month),
  ],
).enableRLS();

// Pending invitations to join a team. Distinct from team_members
// (which requires a Clerk user to exist) so we can hold the invite
// state for an email that hasn't signed up yet. On accept, the row is
// marked acceptedAt + acceptedByMemberUserId, and a corresponding
// team_members row is created. Tokens expire after 7 days by default
// — see src/lib/team-invitations.ts. RLS is on; queries only happen
// via the server-side `postgres` role.
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: cuid(),
    teamOwnerUserId: text("team_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByMemberUserId: text("accepted_by_member_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    // Token is the bearer credential — unique enforces single-use semantics.
    uniqueIndex("team_invitations_token_idx").on(t.token),
    // Listing pending invitations for a team owner is the hot path.
    index("team_invitations_owner_idx").on(t.teamOwnerUserId),
    // Pending-invite pre-check: composite covers both "any invite for
    // this email globally" (rare) and the hot "is there a pending invite
    // for this email under THIS team" (common). Partial unique below
    // closes the duplicate-outstanding-invite race at the DB level.
    index("team_invitations_owner_email_idx").on(
      t.teamOwnerUserId,
      t.email,
    ),
    uniqueIndex("team_invitations_pending_idx")
      .on(t.teamOwnerUserId, t.email)
      .where(sql`accepted_at IS NULL`),
  ],
).enableRLS();

// Customer-flagged reviews — per the redesigned /admin loop step 5.
//
// Customers can flag a check (text + verdict + finding context) for the
// founder to review, opening a contribution channel that improves the
// rulesets and the model. Distinct from `violation_overrides` (which
// captures *disagreements* with a finding) — a flagged review is a
// proactive "this is worth your eyes," even when the verdict was
// technically correct.
//
// Privacy contract — the row only exists because the customer gave
// explicit per-flag consent. Plaintext is stored (the founder needs to
// see it to act on the flag), but:
//   - `consent_recorded_at` captures the moment of consent
//   - PII pre-screen runs at write time (same path as /api/check)
//   - Per-entry display only on the founder surface; never aggregated,
//     never default-on (per ADR 2026-05-11 + CLAUDE.md customer-data
//     section)
//
// Triage parallels violation_overrides:
//   - addressed_corpus    → added to the eval corpus as a calibration
//                           example
//   - addressed_taxonomy  → routed into a standards-library refinement
//   - addressed_patch     → fix landed elsewhere (engine prompt, etc)
//   - not_actionable      → flagged in good faith but no model change
//                           is the right response
export const customerFlaggedReviews = pgTable(
  "customer_flagged_reviews",
  {
    id: cuid(),
    teamId: text("team_id").references(() => users.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Optional pointer to the originating violation when the flag came
    // from a /api/check result that contained one. Null when the flag
    // was on a `pass` verdict (the customer believes a finding SHOULD
    // have fired).
    violationId: text("violation_id").references(() => violations.id, {
      onDelete: "set null",
    }),
    // Plaintext that was checked. Populated unconditionally because the
    // existence of a row implies consent — the consent gate is in the
    // API route, not the schema.
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    contentType: text("content_type"),
    moment: text("moment"),
    // Engine verdict at the moment of the flag. Mirrors the wire-format
    // three-state vocabulary so we can reconstruct what the customer
    // was looking at.
    verdict: text("verdict", {
      enum: ["pass", "violation", "review_recommended"],
    }),
    // What the customer is asking us to look at. Three customer-shaped
    // axes (per the dashboard audit + Robo's spec):
    //
    //   - doesnt_match_experience    — the situation detector picked
    //                                  the wrong context for the copy
    //   - lacks_context              — the engine couldn't see something
    //                                  it needed to make a sensible call
    //   - not_clear_helpful_concise  — the suggestion text itself isn't
    //                                  good
    //
    // The DB column is plain `text` (drizzle enums are TS-only), so
    // historical rows from the pre-audit flag vocabulary still read
    // back fine — the admin inbox falls back gracefully on unknown
    // values via humanizeFlagReason().
    flagReason: text("flag_reason", {
      enum: [
        "doesnt_match_experience",
        "lacks_context",
        "not_clear_helpful_concise",
      ],
    }).notNull(),
    customerNote: text("customer_note"),
    source: text("source", {
      enum: ["dashboard", "plugin", "cli", "action", "lsp", "mcp"],
    }).notNull(),
    // Captured at insert time. Audit trail for the consent moment —
    // useful for a future privacy review or a customer's own data-export
    // request.
    consentRecordedAt: timestamp("consent_recorded_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    // Triage state. Mirrors violation_overrides.overrideStatus shape so
    // the founder uses the same mental model on both inboxes.
    status: text("status", {
      enum: [
        "open",
        "addressed_corpus",
        "addressed_taxonomy",
        "addressed_patch",
        "not_actionable",
      ],
    })
      .notNull()
      .default("open"),
    triagedBy: text("triaged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    triageNotes: text("triage_notes"),
    // Substrate-export tracking. Mirrors violation_overrides.exportedAt
    // — set by `scripts/export-corpus.ts` (or a sibling) when the row's
    // contribution lands in the private substrate.
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Inbox hot path: list open flags ordered by recency. Partial
    // index keeps it small as triaged rows fall out.
    index("customer_flagged_reviews_open_created_idx")
      .on(t.createdAt)
      .where(sql`status = 'open'`),
    // User activity lookup (founder filtering by customer).
    index("customer_flagged_reviews_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
    // Cross-reference with violation_overrides via text_hash so the
    // founder can see "this string was flagged AND overridden."
    index("customer_flagged_reviews_text_hash_idx").on(t.textHash),
  ],
).enableRLS();

// GitHub App installations for the weekly review agent — Phase G3
// follow-up of the 2026-05-09 roadmap.
//
// One row per (team, GitHub installation). When a team owner installs
// the ContentRX GitHub App on a repo, the webhook lands here and we
// store the installation id + the target repo coordinates. The cron
// reads this row at agent-run time, mints an installation-scoped
// access token via the App's private key, and opens a draft PR with
// the digest as the PR description.
//
// Multi-repo support is V2: V1 stores one row per team and uses the
// `target_repo_owner` + `target_repo_name` set at callback time. A
// later iteration can promote this to a one-to-many relationship.
export const agentGithubInstallations = pgTable(
  "agent_github_installations",
  {
    id: cuid(),
    teamId: text("team_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // GitHub's installation id for the connected user/org. Used to
    // mint installation-scoped access tokens for the API calls that
    // open the draft PR.
    githubInstallationId: integer("github_installation_id").notNull(),
    // Login + account_type are display-only; the installation_id is
    // the operative identifier.
    githubAccountLogin: text("github_account_login").notNull(),
    githubAccountType: text("github_account_type", {
      enum: ["User", "Organization"],
    }).notNull(),
    // The repo the cron opens its draft PR against. V1 takes the
    // first repo the App was installed on; V2 will let the team
    // pick.
    targetRepoOwner: text("target_repo_owner").notNull(),
    targetRepoName: text("target_repo_name").notNull(),
    targetBranch: text("target_branch").notNull().default("main"),
    // Bookkeeping for the dashboard's "last PR" affordance — the
    // most recent draft PR the cron opened.
    lastPrNumber: integer("last_pr_number"),
    lastPrUrl: text("last_pr_url"),
    lastPrAt: timestamp("last_pr_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One installation per team — V1 contract. If the team owner
    // re-installs (e.g. to switch repos), we update in place.
    uniqueIndex("agent_github_installations_team_unique").on(t.teamId),
    // Lookup by GitHub installation id during webhook delivery.
    uniqueIndex("agent_github_installations_installation_id_unique").on(
      t.githubInstallationId,
    ),
  ],
).enableRLS();

// Weekly review agent — Phase G1 of the 2026-05-09 roadmap.
//
// Captures one row per agent run. Agent V1 is read-only: it reads the
// team's flag history (the `violations` table), groups by pattern
// (deterministic, no LLM — see src/lib/agent/pattern-grouping.ts),
// and persists the resulting payload here for review at
// `/admin/agent-runs`. Zero LLM calls per run, zero checks consumed.
//
// `payload` carries the full run output (patterns, isolated flags,
// header variant, timing). JSONB so the founder can browse the
// structure in /admin without bloating the schema with per-run
// columns. Top-level summary columns (total_flags, header_variant)
// duplicate fields inside the payload but exist for index-friendly
// queries on the admin list page.
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: cuid(),
    teamId: text("team_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runAt: timestamp("run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Window the agent looked at, in days. V1 uses 30; the cron
    // schedule is weekly but the read window is monthly to ensure
    // patterns surface even when a team's checking cadence is bursty.
    windowDays: integer("window_days").notNull(),
    // Cached top-level summary fields for the admin list view's index.
    totalFlags: integer("total_flags").notNull(),
    headerVariant: text("header_variant").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    index("agent_runs_team_run_at_idx").on(t.teamId, t.runAt),
    index("agent_runs_run_at_idx").on(t.runAt),
  ],
).enableRLS();

export type User = InferSelectModel<typeof users>;
export type Usage = InferSelectModel<typeof usage>;
export type UsageEvent = InferSelectModel<typeof usageEvents>;
export type Subscription = InferSelectModel<typeof subscriptions>;
export type TeamMember = InferSelectModel<typeof teamMembers>;
export type TeamInvitation = InferSelectModel<typeof teamInvitations>;
export type TeamRule = InferSelectModel<typeof teamRules>;
export type Violation = InferSelectModel<typeof violations>;
export type DittoSync = InferSelectModel<typeof dittoSyncs>;
export type ViolationOverride = InferSelectModel<typeof violationOverrides>;
export type SuggestionCandidate = InferSelectModel<typeof suggestionCandidates>;
export type SuggestionPrecedent = InferSelectModel<typeof suggestionPrecedents>;
export type GraduationStatus = InferSelectModel<typeof graduationStatus>;
export type RationaleFeedback = InferSelectModel<typeof rationaleFeedback>;
export type CreditPack = InferSelectModel<typeof creditPacks>;
export type OverageState = InferSelectModel<typeof overageState>;
export type CustomerFlaggedReview = InferSelectModel<
  typeof customerFlaggedReviews
>;
export type AgentRun = InferSelectModel<typeof agentRuns>;
export type AgentGithubInstallation = InferSelectModel<
  typeof agentGithubInstallations
>;
