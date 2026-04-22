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
});

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
);

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
);

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
  ],
);

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
);

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
);

export const dittoSyncs = pgTable("ditto_syncs", {
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
});

export type User = InferSelectModel<typeof users>;
export type Usage = InferSelectModel<typeof usage>;
export type Subscription = InferSelectModel<typeof subscriptions>;
export type TeamMember = InferSelectModel<typeof teamMembers>;
export type TeamRule = InferSelectModel<typeof teamRules>;
export type Violation = InferSelectModel<typeof violations>;
export type DittoSync = InferSelectModel<typeof dittoSyncs>;
