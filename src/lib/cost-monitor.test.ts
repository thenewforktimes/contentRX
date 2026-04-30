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

import {
  checkCostPause,
  clearCostPause,
  dailyCostRollup,
  evaluateAndPauseIfExceeded,
  recordUsageEvent,
} from "./cost-monitor";

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

describe("recordUsageEvent", () => {
  it("inserts a row with the computed estimated cost", async () => {
    const userId = await seedUser(harness);
    const result = await recordUsageEvent({
      userId,
      segmentType: "standard",
      unitsConsumed: 1,
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: "claude-haiku-4-5",
    });
    expect(result.estimatedCostUsd).toBeCloseTo(0.0015, 6);

    const rows = await harness.db
      .select()
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unitsConsumed).toBe(1);
    expect(rows[0]!.segmentType).toBe("standard");
    expect(rows[0]!.modelId).toBe("claude-haiku-4-5");
    expect(parseFloat(rows[0]!.estimatedCostUsd ?? "0")).toBeCloseTo(
      0.0015,
      6,
    );
  });

  it("accepts null modelId and records cost using the fallback rate", async () => {
    const userId = await seedUser(harness);
    const result = await recordUsageEvent({
      userId,
      segmentType: "document",
      unitsConsumed: 8,
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: null,
    });
    // Fallback Sonnet input rate: $3/MTok × 1k tokens = $0.003
    expect(result.estimatedCostUsd).toBeCloseTo(0.003, 6);
  });
});

describe("evaluateAndPauseIfExceeded", () => {
  it("returns null when the user does not exist", async () => {
    expect(await evaluateAndPauseIfExceeded("nonexistent")).toBeNull();
  });

  it("does not pause a user under both thresholds", async () => {
    const userId = await seedUser(harness);
    await recordUsageEvent({
      userId,
      segmentType: "standard",
      unitsConsumed: 1,
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: "claude-haiku-4-5",
    });
    const result = await evaluateAndPauseIfExceeded(userId);
    expect(result?.pausedNow).toBe(false);
    expect(result?.alreadyPaused).toBe(false);
    expect(result?.dailySpendUsd).toBeCloseTo(0.0015, 6);
    expect(await checkCostPause(userId)).toBe(false);
  });

  it("flips the pause flag when the daily threshold is crossed", async () => {
    const userId = await seedUser(harness);
    // Lower the daily threshold to a value the test can cross.
    await harness.db
      .update(schema.users)
      .set({ dailyCostThresholdUsd: "0.01" })
      .where(eq(schema.users.id, userId));

    // 1M input tokens at Haiku × $1/MTok = $1.00, well past $0.01.
    await recordUsageEvent({
      userId,
      segmentType: "surface",
      unitsConsumed: 25,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: "claude-haiku-4-5",
    });
    const result = await evaluateAndPauseIfExceeded(userId);
    expect(result?.pausedNow).toBe(true);
    expect(result?.alreadyPaused).toBe(false);
    expect(result?.dailySpendUsd).toBeCloseTo(1.0, 6);
    expect(await checkCostPause(userId)).toBe(true);
  });

  it("flips the pause flag when the monthly threshold is crossed", async () => {
    const userId = await seedUser(harness);
    await harness.db
      .update(schema.users)
      .set({
        // Daily wide-open, monthly tight.
        dailyCostThresholdUsd: "1000.00",
        monthlyCostThresholdUsd: "0.01",
      })
      .where(eq(schema.users.id, userId));

    await recordUsageEvent({
      userId,
      segmentType: "standard",
      unitsConsumed: 1,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: "claude-haiku-4-5",
    });
    const result = await evaluateAndPauseIfExceeded(userId);
    expect(result?.pausedNow).toBe(true);
    expect(result?.monthlySpendUsd).toBeCloseTo(1.0, 6);
    expect(await checkCostPause(userId)).toBe(true);
  });

  it("returns pausedNow=false on the second call after the flag is already set", async () => {
    const userId = await seedUser(harness);
    await harness.db
      .update(schema.users)
      .set({ dailyCostThresholdUsd: "0.01" })
      .where(eq(schema.users.id, userId));
    await recordUsageEvent({
      userId,
      segmentType: "surface",
      unitsConsumed: 25,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: "claude-haiku-4-5",
    });
    const first = await evaluateAndPauseIfExceeded(userId);
    expect(first?.pausedNow).toBe(true);

    const second = await evaluateAndPauseIfExceeded(userId);
    // Second call: user is already paused, so the function exits
    // before flipping the flag again. `pausedNow` stays false.
    expect(second?.pausedNow).toBe(false);
    expect(second?.alreadyPaused).toBe(true);
  });
});

describe("checkCostPause", () => {
  it("returns false for users without a row", async () => {
    expect(await checkCostPause("missing")).toBe(false);
  });

  it("returns false for new users (default flag value)", async () => {
    const userId = await seedUser(harness);
    expect(await checkCostPause(userId)).toBe(false);
  });

  it("returns true when the user is paused", async () => {
    const userId = await seedUser(harness);
    await harness.db
      .update(schema.users)
      .set({ costPauseActive: true })
      .where(eq(schema.users.id, userId));
    expect(await checkCostPause(userId)).toBe(true);
  });
});

describe("clearCostPause", () => {
  it("flips the flag back to false", async () => {
    const userId = await seedUser(harness);
    await harness.db
      .update(schema.users)
      .set({ costPauseActive: true })
      .where(eq(schema.users.id, userId));
    expect(await clearCostPause(userId)).toBe(true);
    expect(await checkCostPause(userId)).toBe(false);
  });

  it("returns false when the user was already not paused (idempotent)", async () => {
    const userId = await seedUser(harness);
    expect(await clearCostPause(userId)).toBe(false);
  });
});

describe("dailyCostRollup", () => {
  it("groups events by user and day, sorted most-recent-first", async () => {
    const userA = await seedUser(harness);
    const userB = await seedUser(harness);
    await recordUsageEvent({
      userId: userA,
      segmentType: "standard",
      unitsConsumed: 1,
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: "claude-haiku-4-5",
    });
    await recordUsageEvent({
      userId: userB,
      segmentType: "document",
      unitsConsumed: 8,
      inputTokens: 5_000,
      outputTokens: 500,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelId: "claude-sonnet-4-6",
    });
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const rollup = await dailyCostRollup({ start: yesterday });
    expect(rollup.length).toBeGreaterThanOrEqual(2);
    const ids = rollup.map((r) => r.userId);
    expect(ids).toContain(userA);
    expect(ids).toContain(userB);
    for (const row of rollup) {
      expect(row.totalCostUsd).toBeGreaterThan(0);
      expect(row.eventCount).toBeGreaterThan(0);
    }
  });
});
