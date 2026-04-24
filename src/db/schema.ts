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
  email: text("email").notNull(),
  plan: text("plan", { enum: ["free", "pro", "team"] })
    .notNull()
    .default("free"),
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
  },
  (t) => [
    // Exactly one active subscription per user. Historical rows with
    // status="canceled" / "incomplete_expired" are legitimate and allowed.
    // Closes CLAUDE.md known limitation #6.
    uniqueIndex("subscriptions_user_active_idx")
      .on(t.userId)
      .where(sql`status = 'active'`),
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
      enum: ["plugin", "cli", "action", "ditto"],
    }).notNull(),
    // Source-file path for violations that originated from CI extraction
    // (GitHub Action runs against a repo). Nullable because plugin and
    // CLI checks have no file context. Powers the "Top files" panel in
    // team analytics.
    filePath: text("file_path"),
  },
  (t) => [
    index("violations_user_created_idx").on(t.userId, t.createdAt),
    index("violations_team_created_idx").on(t.teamId, t.createdAt),
    index("violations_team_file_idx").on(t.teamId, t.filePath),
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
      enum: ["plugin", "cli", "action", "dashboard"],
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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

export type User = InferSelectModel<typeof users>;
export type Usage = InferSelectModel<typeof usage>;
export type Subscription = InferSelectModel<typeof subscriptions>;
export type TeamMember = InferSelectModel<typeof teamMembers>;
export type TeamRule = InferSelectModel<typeof teamRules>;
export type Violation = InferSelectModel<typeof violations>;
export type DittoSync = InferSelectModel<typeof dittoSyncs>;
export type ViolationOverride = InferSelectModel<typeof violationOverrides>;
export type GraduationStatus = InferSelectModel<typeof graduationStatus>;
export type RationaleFeedback = InferSelectModel<typeof rationaleFeedback>;
