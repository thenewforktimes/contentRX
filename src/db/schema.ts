import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
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
