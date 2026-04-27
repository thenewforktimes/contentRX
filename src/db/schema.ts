import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";

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
  plan: text("plan", { enum: ["free", "pro", "team"] })
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
  // Human-eval build plan Session 31. When set, the user opted out of
  // pairwise-preference elicitation prompts. `/dashboard/calibrate`
  // honors it immediately; weekly scheduler skips opted-out users.
  // Null = opted in (default). The timestamp records when they opted
  // out so we can distinguish "never asked" from "explicitly declined"
  // in telemetry.
  preferenceOptedOutAt: timestamp("preference_opted_out_at", {
    withTimezone: true,
  }),
  // PR-31 (90-day retention). Set by the
  // /api/cron/pseudonymize-cancelled job when this user's
  // subscription has been cancelled for >= 90 days AND no other
  // active subscription exists. Once set: email + apiKeyHash +
  // apiKeyPrefix have been replaced with sentinels, team-scoped
  // rows have been deleted, and historical violations /
  // violation_overrides / preferences have userId set to null.
  // Reactivation post-pseudonymize is a cold start — the user
  // appears as a fresh signup to themselves, but their anonymized
  // signal continues to feed engine calibration.
  pseudonymizedAt: timestamp("pseudonymized_at", { withTimezone: true }),
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
    source: text("source", {
      enum: ["plugin", "cli", "action", "ditto", "lsp", "mcp"],
    }).notNull(),
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
    // src/lib/override-reasons.ts). Distinct from Robo's triage_category
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

// Custom examples — human-eval build plan Session 30.
//
// Team-authored, team-scoped string-level decisions that short-circuit
// evaluation. When /api/check sees an input whose normalized text
// matches an entry for the team's scope, the LLM call is skipped and
// the stored verdict is returned directly. This carves out surgical
// exceptions for team voice quirks without weakening global rules —
// a team that ships "Let's go." on confirmations can mark the string
// as a pass without disabling PRF-03 everywhere else.
//
// Privacy: `text` is plaintext and team-owned (team admins authored
// it; no user text ever lands here). Scoped by `teamOwnerUserId`
// exactly like `team_rules`.
//
// Naming: "custom examples" throughout the product surface. The word
// "example" matches how content designers already talk about specific
// phrasings + is a count noun that scales cleanly across the CLI
// (`contentrx example list`), MCP (`custom_example_add`), and web
// audit UI.
export const teamCustomExamples = pgTable(
  "team_custom_examples",
  {
    id: cuid(),
    // Team scope. Matches `team_rules.team_owner_user_id` — every
    // member of the team gets the short-circuit; only the admin
    // (team owner) can manage.
    teamOwnerUserId: text("team_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Who added the entry. Set-null on delete so the entry survives
    // an admin's account deletion — the team keeps its custom
    // examples even when a specific admin leaves.
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // The string to short-circuit on. Plaintext; bounded at 100k to
    // match /api/check's input cap.
    text: text("text").notNull(),
    // Case + whitespace normalized form used for deterministic
    // matching. Computed in code (src/lib/custom-examples.ts)
    // on create and update so the logic stays changeable without
    // a migration.
    normalizedText: text("normalized_text").notNull(),
    // Only `pass` and `violation` — `review_recommended` doesn't
    // make sense for a team-decided verdict.
    verdict: text("verdict", { enum: ["pass", "violation"] }).notNull(),
    // Optional context filters. When set, the match only fires when
    // the request's moment / content_type matches. When unset, the
    // entry matches any context.
    moment: text("moment"),
    contentType: text("content_type"),
    // For verdict=violation, the standard the team asserts fires.
    // Shows up in the rationale chain as the one-hop short-circuit
    // citation. Nullable for verdict=pass entries.
    standardId: text("standard_id"),
    // Admin-authored prose explaining why this entry exists. Surfaced
    // to team members when the short-circuit fires so newcomers see
    // the team's reasoning.
    notes: text("notes"),
    // Opt-in to anonymised contribution to the core content model
    // when Robo reviews. Defaults to false — zero assumptions about
    // whether the team wants their voice decisions to flow upstream.
    contributeUpstream: boolean("contribute_upstream").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Hot path: /api/check looks up (team, normalized_text) for every
    // scan. Without this index every eval does a table scan of
    // everyone's custom examples — catastrophic at any scale.
    index("team_custom_examples_team_text_idx").on(
      t.teamOwnerUserId,
      t.normalizedText,
    ),
    // Admin list view sorts by recency.
    index("team_custom_examples_team_created_idx").on(
      t.teamOwnerUserId,
      t.createdAt,
    ),
    // No duplicate (team, normalized_text) entries. Uniqueness is on
    // the normalized form so "Let's go." and "Let's Go." can't both
    // exist as competing entries for the same team.
    uniqueIndex("team_custom_examples_team_text_unique").on(
      t.teamOwnerUserId,
      t.normalizedText,
    ),
  ],
).enableRLS();

// Pairwise-preference curation pool — human-eval build plan Session 31.
//
// Each row is a hand-picked pair of strings that ask a content-design
// judgment call: given (moment, content_type, standard), which of
// these two candidate strings is better? The `/dashboard/calibrate`
// surface picks three unseen pairs per user per session (weekly) and
// writes the user's answer into `preferences`.
//
// Seed pool ships as a JSON artifact (`evals/preference_pairs.json`)
// and is loaded into the DB via `tools/seed_preference_pairs.py`. New
// pairs can be appended without a migration — the JSON is the source
// of truth, the DB is the cache for fast lookup.
//
// Privacy: both `leftText` and `rightText` are author-curated (Robo +
// collaborators), not user-submitted. Nothing here is PII.
export const preferencePairs = pgTable(
  "preference_pairs",
  {
    id: cuid(),
    // Stable cross-version identifier from the seed JSON. Lets the
    // seeder re-run idempotently and keeps a pair's identity stable
    // across DB re-creations so historic `preferences` rows remain
    // interpretable.
    seedKey: text("seed_key").notNull().unique(),
    moment: text("moment").notNull(),
    contentType: text("content_type").notNull(),
    // The standard this pair is probing. Responses aggregate by
    // (standard_id, content_type, verdict) into the precedent index
    // the auto-annotator consults.
    standardId: text("standard_id").notNull(),
    leftText: text("left_text").notNull(),
    rightText: text("right_text").notNull(),
    // Which side the pair's author believes is the stronger answer.
    // Optional — when unset, the pair is treated as a genuine judgment
    // probe with no canonical answer. When set, we can compute a
    // "percent aligned with author" rollup during review.
    expectedPreferred: text("expected_preferred", {
      enum: ["left", "right"],
    }),
    // Short prompt shown above the pair, e.g. "Which confirms a
    // destructive action more clearly?" Optional.
    prompt: text("prompt"),
    // Admin-only flag for pairs that should be pulled from rotation
    // without deleting the row (preserves historic responses).
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("preference_pairs_moment_content_idx").on(t.moment, t.contentType),
    index("preference_pairs_standard_idx").on(t.standardId),
  ],
).enableRLS();

// Pairwise-preference responses — human-eval build plan Session 31.
//
// One row per (user, pair) answered. The `preferred` enum captures
// "left is better", "right is better", or "neither" (user explicitly
// declined to prefer). Unanswered pairs don't land here.
//
// Aggregation: counts of (standard_id, content_type, preferred_verdict)
// feed the auto-annotator's precedent index as a second source
// alongside existing approved annotations. Mapping from preferred-side
// to verdict depends on the pair metadata — if `expected_preferred`
// is "left" and the user picked "left", that's alignment with the
// standard-encoded preference (→ verdict maps to "fail" for the
// other side / "pass" for the chosen side, depending on pair framing).
// The library helper in `src/lib/preferences.ts` handles the mapping.
export const preferences = pgTable(
  "preferences",
  {
    id: cuid(),
    // userId nullable + set-null on delete (audit H-08). Anonymized
    // pairwise-preference signal preserved for engine training.
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    teamId: text("team_id").references(() => users.id, {
      onDelete: "set null",
    }),
    pairId: text("pair_id")
      .notNull()
      .references(() => preferencePairs.id, { onDelete: "cascade" }),
    preferred: text("preferred", {
      enum: ["left", "right", "neither"],
    }).notNull(),
    // Optional free-text rationale. Bounded at route level.
    note: text("note"),
    // How long the user spent on the pair, ms. Short + "neither"
    // ≈ skip; long + confident pick ≈ informed call. Powers a
    // signal-quality lens on the preferences export.
    timeMs: integer("time_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A user answers each pair at most once. Changing your mind later
    // is a new pair, not a mutation of this row.
    uniqueIndex("preferences_user_pair_unique").on(t.userId, t.pairId),
    index("preferences_user_created_idx").on(t.userId, t.createdAt),
    // Precedent-index hot path: aggregate by pair (which implies
    // standard/content_type) without a join.
    index("preferences_pair_idx").on(t.pairId),
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
    // "Do we already have an outstanding invite for this email?" pre-check.
    index("team_invitations_email_idx").on(t.email),
  ],
).enableRLS();

export type User = InferSelectModel<typeof users>;
export type Usage = InferSelectModel<typeof usage>;
export type Subscription = InferSelectModel<typeof subscriptions>;
export type TeamMember = InferSelectModel<typeof teamMembers>;
export type TeamInvitation = InferSelectModel<typeof teamInvitations>;
export type TeamRule = InferSelectModel<typeof teamRules>;
export type Violation = InferSelectModel<typeof violations>;
export type DittoSync = InferSelectModel<typeof dittoSyncs>;
export type ViolationOverride = InferSelectModel<typeof violationOverrides>;
export type GraduationStatus = InferSelectModel<typeof graduationStatus>;
export type RationaleFeedback = InferSelectModel<typeof rationaleFeedback>;
export type TeamCustomExample = InferSelectModel<typeof teamCustomExamples>;
export type PreferencePair = InferSelectModel<typeof preferencePairs>;
export type Preference = InferSelectModel<typeof preferences>;
export type CreditPack = InferSelectModel<typeof creditPacks>;
export type OverageState = InferSelectModel<typeof overageState>;
