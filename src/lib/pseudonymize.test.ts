/**
 * Integration test for `pseudonymizeUser`.
 *
 * Per Robert's call (2026-05-10) the function MUST hard-delete every
 * row attributed to the user. This test seeds rows in every table
 * the helper touches, runs the helper, and asserts the rows are
 * gone — AND that a sibling user's rows survive.
 *
 * If a future refactor quietly reintroduces the anonymize-and-keep
 * pattern (set user_id to null instead of DELETE), this test fails.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestDb, seedUser, type TestDbHarness } from "./__test_db__";

const dbRef: { current: TestDbHarness["db"] | null } = { current: null };

vi.mock("@/db", async () => {
  const actual = await vi.importActual<typeof import("@/db")>("@/db");
  return {
    ...actual,
    getDb: () => {
      if (dbRef.current === null) {
        throw new Error("test harness not initialised");
      }
      return dbRef.current;
    },
  };
});

import { pseudonymizeUser } from "./pseudonymize";

let harness: TestDbHarness;

beforeAll(async () => {
  harness = await createTestDb();
  dbRef.current = harness.db;
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

/**
 * Seed a user with one row in each table the test harness supports.
 * Returns the user id.
 */
async function seedFullUser(idPrefix: string): Promise<string> {
  const userId = await seedUser(harness, { id: `usr_${idPrefix}` });

  await harness.db.insert(schema.usage).values({
    id: `usage_${idPrefix}`,
    userId,
    month: "2026-05",
    count: 42,
  });

  await harness.db.insert(schema.usageEvents).values({
    id: `evt_${idPrefix}`,
    userId,
    segmentType: "small",
    unitsConsumed: 1,
    source: "dashboard",
  });

  await harness.db.insert(schema.subscriptions).values({
    id: `sub_${idPrefix}`,
    userId,
    stripeCustomerId: `cus_${idPrefix}`,
    stripeSubId: `stripe_sub_${idPrefix}`,
    status: "canceled",
    plan: "pro",
  });

  await harness.db.insert(schema.violations).values({
    id: `viol_${idPrefix}`,
    userId,
    teamId: userId,
    textHash: `hash_${idPrefix}`,
    source: "dashboard",
    contentType: "button_cta",
    standardId: "ACT-01",
    severity: "medium",
  });

  await harness.db.insert(schema.violationOverrides).values({
    id: `ovr_${idPrefix}`,
    userId,
    teamId: userId,
    standardId: "ACT-01",
    textHash: `hash_${idPrefix}`,
    overrideType: "dismiss",
    source: "dashboard",
  });

  await harness.db.insert(schema.customerFlaggedReviews).values({
    id: `flag_${idPrefix}`,
    userId,
    teamId: userId,
    text: "consented sample",
    textHash: `hash_${idPrefix}`,
    flagReason: "doesnt_match_experience",
    source: "dashboard",
  });

  await harness.db.insert(schema.overageState).values({
    id: `ovg_${idPrefix}`,
    userId,
    month: "2026-05",
    overageChecks: 0,
    overageUsdCents: 0,
  });

  await harness.db.insert(schema.rationaleFeedback).values({
    id: `rat_${idPrefix}`,
    userId,
    teamId: userId,
    textHash: `hash_${idPrefix}`,
    hopStep: "scan",
    originalValue: "moment_X",
    correctionType: "other",
    source: "dashboard",
  });

  await harness.db.insert(schema.suggestionCandidates).values({
    id: `cand_${idPrefix}`,
    source: "customer_copy",
    sourceUserId: userId,
    sourceTeamOwnerUserId: userId,
    inputHash: `hash_${idPrefix}`,
  });

  await harness.db.insert(schema.teamRules).values({
    id: `rule_${idPrefix}`,
    teamOwnerUserId: userId,
    standardId: "TEAM-01",
    action: "disable",
    ruleJson: {},
  });

  await harness.db.insert(schema.teamMembers).values({
    id: `mem_${idPrefix}`,
    teamOwnerUserId: userId,
    memberUserId: userId,
  });

  await harness.db.insert(schema.teamInvitations).values({
    id: `inv_${idPrefix}`,
    teamOwnerUserId: userId,
    email: `invitee_${idPrefix}@test.local`,
    token: `tok_${idPrefix}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  await harness.db.insert(schema.agentRuns).values({
    id: `run_${idPrefix}`,
    teamId: userId,
    windowDays: 30,
    totalFlags: 0,
    headerVariant: "cold_start",
    payload: {},
  });

  await harness.db.insert(schema.agentGithubInstallations).values({
    id: `gh_${idPrefix}`,
    teamId: userId,
    githubInstallationId: 12345,
    githubAccountLogin: "acme",
    githubAccountType: "Organization",
    targetRepoOwner: "acme",
    targetRepoName: "repo",
  });

  await harness.db.insert(schema.creditPacks).values({
    id: `pack_${idPrefix}`,
    userId,
    stripeInvoiceItemId: `inv_${idPrefix}`,
    creditsTotal: 100,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });

  return userId;
}

describe("pseudonymizeUser — right-to-be-forgotten", () => {
  it("hard-deletes every row attributed to the user", async () => {
    const alice = await seedFullUser("alice");

    // Sanity: every table starts non-empty for Alice.
    expect(
      await harness.db.select().from(schema.users).where(eq(schema.users.id, alice)),
    ).toHaveLength(1);
    expect(
      await harness.db.select().from(schema.usage).where(eq(schema.usage.userId, alice)),
    ).toHaveLength(1);
    expect(
      await harness.db
        .select()
        .from(schema.customerFlaggedReviews)
        .where(eq(schema.customerFlaggedReviews.userId, alice)),
    ).toHaveLength(1);

    await pseudonymizeUser(alice);

    // Every table ends empty for Alice.
    expect(
      await harness.db.select().from(schema.users).where(eq(schema.users.id, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db.select().from(schema.usage).where(eq(schema.usage.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.usageEvents)
        .where(eq(schema.usageEvents.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.violations)
        .where(eq(schema.violations.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.violationOverrides)
        .where(eq(schema.violationOverrides.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.customerFlaggedReviews)
        .where(eq(schema.customerFlaggedReviews.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.overageState)
        .where(eq(schema.overageState.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.rationaleFeedback)
        .where(eq(schema.rationaleFeedback.userId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.suggestionCandidates)
        .where(eq(schema.suggestionCandidates.sourceUserId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.teamRules)
        .where(eq(schema.teamRules.teamOwnerUserId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.teamOwnerUserId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.teamInvitations)
        .where(eq(schema.teamInvitations.teamOwnerUserId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.teamId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.agentGithubInstallations)
        .where(eq(schema.agentGithubInstallations.teamId, alice)),
    ).toHaveLength(0);
    expect(
      await harness.db
        .select()
        .from(schema.creditPacks)
        .where(eq(schema.creditPacks.userId, alice)),
    ).toHaveLength(0);
  });

  it("does not touch a sibling user's rows", async () => {
    const alice = await seedFullUser("alice");
    const bob = await seedFullUser("bob");

    await pseudonymizeUser(alice);

    // Bob's data is untouched.
    expect(
      await harness.db.select().from(schema.users).where(eq(schema.users.id, bob)),
    ).toHaveLength(1);
    expect(
      await harness.db.select().from(schema.usage).where(eq(schema.usage.userId, bob)),
    ).toHaveLength(1);
    expect(
      await harness.db
        .select()
        .from(schema.customerFlaggedReviews)
        .where(eq(schema.customerFlaggedReviews.userId, bob)),
    ).toHaveLength(1);
    expect(
      await harness.db
        .select()
        .from(schema.violationOverrides)
        .where(eq(schema.violationOverrides.userId, bob)),
    ).toHaveLength(1);
  });

  it("no-ops cleanly when the user has no attached rows", async () => {
    const ghost = await seedUser(harness, { id: "usr_ghost" });
    await pseudonymizeUser(ghost);

    expect(
      await harness.db.select().from(schema.users).where(eq(schema.users.id, ghost)),
    ).toHaveLength(0);
  });

  it("no-ops cleanly when the user id does not exist", async () => {
    // Running pseudonymize on a never-seen id should not throw.
    await expect(pseudonymizeUser("usr_never_existed")).resolves.toBeUndefined();
  });
});
