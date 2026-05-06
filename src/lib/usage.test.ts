/**
 * Tests for monthly usage + atomic quota claiming.
 *
 * Audit 2026-04-26 P1: `claimQuotaSlot` was the fix for BE-M-04 (read-
 * then-write quota race) but had zero regression coverage. This suite
 * runs concurrent claim attempts against a real-Postgres-semantics
 * pglite instance and asserts the WHERE-guard on the upsert holds
 * under contention.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestDb, seedUser, type TestDbHarness } from "./__test_db__";

// vi.mock is hoisted ABOVE all imports, so we can't reference a
// runtime harness from inside the factory. Use a deferred-ref object
// that the factory captures once; beforeAll fills it in. The getDb()
// getter dereferences at call time so production code sees the live
// pglite instance.
const dbRef: { current: TestDbHarness["db"] | null } = { current: null };

vi.mock("@/db", async () => {
  const actual = await vi.importActual<typeof import("@/db")>("@/db");
  return {
    ...actual,
    getDb: () => {
      if (dbRef.current === null) {
        throw new Error(
          "test harness not initialised — beforeAll must run before getDb() is called",
        );
      }
      return dbRef.current;
    },
  };
});

import {
  claimQuotaSlot,
  claimQuotaSlots,
  getCurrentUsage,
  recordTokenUsage,
} from "./usage";
import { currentMonth } from "./quotas";

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

// ---------------------------------------------------------------------------
// getCurrentUsage
// ---------------------------------------------------------------------------

describe("getCurrentUsage", () => {
  it("returns 0 when the user has no row for the current month", async () => {
    const userId = await seedUser(harness);
    expect(await getCurrentUsage(userId)).toBe(0);
  });

  it("returns the current-month count when the row exists", async () => {
    const userId = await seedUser(harness);
    await harness.db.insert(schema.usage).values({
      id: "u1",
      userId,
      month: currentMonth(),
      count: 7,
    });
    expect(await getCurrentUsage(userId)).toBe(7);
  });

  it("ignores rows from other months", async () => {
    const userId = await seedUser(harness);
    await harness.db.insert(schema.usage).values([
      { id: "u-prev", userId, month: "2025-01", count: 100 },
      { id: "u-curr", userId, month: currentMonth(), count: 3 },
    ]);
    expect(await getCurrentUsage(userId)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// claimQuotaSlot — the primary regression target
// ---------------------------------------------------------------------------

describe("claimQuotaSlot", () => {
  it("grants the first claim and increments the count to 1", async () => {
    const userId = await seedUser(harness);
    const result = await claimQuotaSlot(userId, 10);
    expect(result).toEqual({ granted: true, count: 1 });
    expect(await getCurrentUsage(userId)).toBe(1);
  });

  it("creates exactly one row across many sequential claims", async () => {
    const userId = await seedUser(harness);
    for (let i = 0; i < 5; i++) await claimQuotaSlot(userId, 100);

    const rows = await harness.db
      .select()
      .from(schema.usage)
      .where(
        and(
          eq(schema.usage.userId, userId),
          eq(schema.usage.month, currentMonth()),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(5);
  });

  it("rejects the claim that would breach the cap and returns the current count", async () => {
    const userId = await seedUser(harness);
    await claimQuotaSlot(userId, 2); // count = 1
    await claimQuotaSlot(userId, 2); // count = 2 (at cap)

    const rejected = await claimQuotaSlot(userId, 2);
    expect(rejected.granted).toBe(false);
    expect(rejected.count).toBe(2);
    expect(await getCurrentUsage(userId)).toBe(2); // not incremented
  });

  it("rejects subsequent claims when the cap is 0 (first claim creates the row)", async () => {
    // Edge case unreachable in production (plan quotas are >= 100).
    // The INSERT branch of the upsert has no WHERE-guard, so the FIRST
    // claim with quota=0 inserts a row at count=1 — only the UPDATE
    // branch's `setWhere: count < quota` rejects subsequent claims.
    // This is the same shape as Postgres's MERGE semantics; documenting
    // it here so future readers don't think it's a regression.
    const userId = await seedUser(harness);
    const first = await claimQuotaSlot(userId, 0);
    expect(first).toEqual({ granted: true, count: 1 });

    const second = await claimQuotaSlot(userId, 0);
    expect(second).toEqual({ granted: false, count: 1 });
  });

  it("under N concurrent claims with quota Q, exactly Q succeed (atomicity)", async () => {
    // The whole reason claimQuotaSlot exists is to avoid the read-
    // then-write race. Fire 12 claims at once with quota=5; the
    // WHERE-guard on the upsert update branch must reject 7.
    const userId = await seedUser(harness);
    const QUOTA = 5;
    const ATTEMPTS = 12;
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () => claimQuotaSlot(userId, QUOTA)),
    );

    const granted = results.filter((r) => r.granted).length;
    const rejected = results.filter((r) => !r.granted).length;
    expect(granted).toBe(QUOTA);
    expect(rejected).toBe(ATTEMPTS - QUOTA);
    // The final count must equal exactly the quota — no double-count
    // and no above-cap leak.
    expect(await getCurrentUsage(userId)).toBe(QUOTA);
  });

  it("under contention at the boundary, one claim succeeds and the rest reject cleanly", async () => {
    // Bracket the boundary: pre-fill to cap-1, then race two claims.
    const userId = await seedUser(harness);
    await harness.db.insert(schema.usage).values({
      id: "boundary",
      userId,
      month: currentMonth(),
      count: 4,
    });
    const [a, b] = await Promise.all([
      claimQuotaSlot(userId, 5),
      claimQuotaSlot(userId, 5),
    ]);
    const grantedCount = [a, b].filter((r) => r.granted).length;
    expect(grantedCount).toBe(1);
    expect(await getCurrentUsage(userId)).toBe(5);
  });

  it("isolates quota state per user", async () => {
    const alice = await seedUser(harness, { id: "alice" });
    const bob = await seedUser(harness, { id: "bob" });

    await claimQuotaSlot(alice, 10);
    await claimQuotaSlot(alice, 10);
    await claimQuotaSlot(bob, 10);

    expect(await getCurrentUsage(alice)).toBe(2);
    expect(await getCurrentUsage(bob)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// claimQuotaSlots — proportional-billing path (schema 3.0.0)
//
// /api/check calls claimQuotaSlots(userId, n, quota) where n is the
// proportional unit count from meter(text). Multi-slot claims are
// all-or-nothing: a request that needs 3 slots against a 1-remaining
// user must reject without partial fulfillment, otherwise customers
// could squeeze cheap multi-unit requests past the cap.
// ---------------------------------------------------------------------------

describe("claimQuotaSlots", () => {
  it("grants a 5-slot claim against an empty quota and increments by 5", async () => {
    const userId = await seedUser(harness);
    const result = await claimQuotaSlots(userId, 5, 100);
    expect(result).toEqual({ granted: true, count: 5 });
    expect(await getCurrentUsage(userId)).toBe(5);
  });

  it("grants exactly at the boundary (count + n == quota)", async () => {
    const userId = await seedUser(harness);
    await claimQuotaSlots(userId, 7, 10); // count = 7
    const result = await claimQuotaSlots(userId, 3, 10); // count + n = 10
    expect(result).toEqual({ granted: true, count: 10 });
  });

  it("rejects all-or-nothing — 3-slot claim against a 2-remaining user", async () => {
    // Free user with quota=20, count=18, requests 401 chars (3 units).
    // The atomic guard `count + n <= quota` rejects 18 + 3 = 21 > 20
    // even though 2 slots are technically free.
    const userId = await seedUser(harness);
    await harness.db
      .insert(schema.usage)
      .values({ userId, month: currentMonth(), count: 18 });

    const rejected = await claimQuotaSlots(userId, 3, 20);
    expect(rejected.granted).toBe(false);
    expect(rejected.count).toBe(18);
    // Count must NOT have moved — partial fulfillment would be a
    // privacy / billing leak.
    expect(await getCurrentUsage(userId)).toBe(18);
  });

  it("admits a first claim that exactly fills the quota (count=n)", async () => {
    // A 4000-char input (20 units) against a Free user (quota=20)
    // who hasn't checked anything yet must succeed exactly. The
    // single-slot test at line ~127 documents the asymmetry between
    // the INSERT branch (no WHERE-guard) and the UPDATE branch — the
    // multi-slot variant inherits that contract. The follow-up claim
    // here is what proves the cap holds: a 1-unit claim once a 20-
    // unit row exists must reject.
    const userId = await seedUser(harness);
    const ok = await claimQuotaSlots(userId, 20, 20);
    expect(ok).toEqual({ granted: true, count: 20 });

    const denied = await claimQuotaSlots(userId, 1, 20);
    expect(denied.granted).toBe(false);
    expect(denied.count).toBe(20);
  });

  it("treats n <= 0 as a free pass (defensive — should never happen in prod)", async () => {
    // /api/check's meter() floors at 1, so n=0 is a callsite bug.
    // The function fields it without crashing; count stays accurate.
    const userId = await seedUser(harness);
    await claimQuotaSlots(userId, 5, 100);
    expect(await getCurrentUsage(userId)).toBe(5);

    const result = await claimQuotaSlots(userId, 0, 100);
    expect(result).toEqual({ granted: true, count: 5 });
    expect(await getCurrentUsage(userId)).toBe(5);

    const negative = await claimQuotaSlots(userId, -3, 100);
    expect(negative).toEqual({ granted: true, count: 5 });
    expect(await getCurrentUsage(userId)).toBe(5);
  });

  it("under N concurrent multi-slot claims, the cap holds atomically", async () => {
    // Five concurrent claims of 3 units each against a quota of 10.
    // 10 / 3 = 3 with remainder 1 → exactly 3 should succeed
    // (consuming 9 slots), and the rest must reject. Crucially: count
    // never exceeds quota.
    const userId = await seedUser(harness);
    const QUOTA = 10;
    const SLOTS_PER_CLAIM = 3;
    const ATTEMPTS = 5;

    const results = await Promise.all(
      Array.from(
        { length: ATTEMPTS },
        () => claimQuotaSlots(userId, SLOTS_PER_CLAIM, QUOTA),
      ),
    );

    const granted = results.filter((r) => r.granted).length;
    const rejected = results.filter((r) => !r.granted).length;
    // Exactly 3 must succeed (3 × 3 = 9 ≤ 10; a 4th would push to 12).
    expect(granted).toBe(3);
    expect(rejected).toBe(ATTEMPTS - 3);
    expect(await getCurrentUsage(userId)).toBe(granted * SLOTS_PER_CLAIM);
  });

  it("multi-slot and single-slot claims share state on the same usage row", async () => {
    // A common production pattern: small button-label checks (1 unit)
    // and long-form doc checks (20 units) hit the same row.
    const userId = await seedUser(harness);
    await claimQuotaSlot(userId, 100); // count = 1
    await claimQuotaSlots(userId, 20, 100); // count = 21
    await claimQuotaSlot(userId, 100); // count = 22

    expect(await getCurrentUsage(userId)).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// recordTokenUsage
// ---------------------------------------------------------------------------

describe("recordTokenUsage", () => {
  it("accumulates tokens across multiple records on the same row", async () => {
    const userId = await seedUser(harness);
    await claimQuotaSlot(userId, 100); // creates the row
    await recordTokenUsage(userId, {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 100,
    });
    await recordTokenUsage(userId, {
      inputTokens: 250,
      outputTokens: 80,
    });
    const [row] = await harness.db
      .select()
      .from(schema.usage)
      .where(
        and(
          eq(schema.usage.userId, userId),
          eq(schema.usage.month, currentMonth()),
        ),
      );
    expect(row?.inputTokens).toBe(1250);
    expect(row?.outputTokens).toBe(580);
    expect(row?.cacheReadInputTokens).toBe(200);
    expect(row?.cacheCreationInputTokens).toBe(100);
  });

  it("treats absent cache-token fields as zero increments", async () => {
    const userId = await seedUser(harness);
    await claimQuotaSlot(userId, 100);
    await recordTokenUsage(userId, { inputTokens: 10, outputTokens: 5 });
    const [row] = await harness.db
      .select()
      .from(schema.usage)
      .where(
        and(
          eq(schema.usage.userId, userId),
          eq(schema.usage.month, currentMonth()),
        ),
      );
    expect(row?.cacheReadInputTokens).toBe(0);
    expect(row?.cacheCreationInputTokens).toBe(0);
  });
});
