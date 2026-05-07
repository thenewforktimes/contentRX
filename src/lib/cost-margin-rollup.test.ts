import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  getCostMarginRollup,
  plansBelowMarginThreshold,
} from "./cost-margin-rollup";

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

async function seedEvent(
  userId: string,
  costUsd: number,
  units: number,
  opts: {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    daysAgo?: number;
  } = {},
) {
  const createdAt = new Date(
    Date.now() - (opts.daysAgo ?? 0) * 24 * 60 * 60 * 1000,
  );
  await harness.db.insert(schema.usageEvents).values({
    userId,
    segmentType: "small",
    unitsConsumed: units,
    inputTokens: opts.inputTokens ?? 1_000,
    outputTokens: 100,
    cacheReadInputTokens: opts.cacheReadTokens ?? 0,
    cacheCreationInputTokens: opts.cacheCreationTokens ?? 0,
    estimatedCostUsd: costUsd.toFixed(6),
    createdAt,
  });
}

describe("getCostMarginRollup", () => {
  it("groups by plan and computes per-unit cost + margin", async () => {
    const proUser = await seedUser(harness, { plan: "pro" });
    const teamUser = await seedUser(harness, { plan: "team" });

    // Pro: 100 units consumed at $0.015/unit total = $1.50.
    //   Per-unit revenue is $39 / 1000 = $0.039.
    //   Expected margin = (0.039 - 0.015) / 0.039 = ~61.5%.
    await seedEvent(proUser, 1.5, 100);

    // Team: 200 units at $0.015/unit total = $3.00.
    //   Per-unit revenue is $79 / 2000 = $0.0395.
    //   Expected margin = (0.0395 - 0.015) / 0.0395 = ~62%.
    await seedEvent(teamUser, 3.0, 200);

    const rollup = await getCostMarginRollup({ windowDays: 7 });
    expect(rollup.windowDays).toBe(7);
    expect(rollup.plans).toHaveLength(2);

    const pro = rollup.plans.find((p) => p.plan === "pro")!;
    expect(pro.totalUnits).toBe(100);
    expect(pro.totalCostUsd).toBeCloseTo(1.5, 6);
    expect(pro.avgCostPerUnitUsd).toBeCloseTo(0.015, 6);
    expect(pro.perUnitRevenueUsd).toBeCloseTo(0.039, 6);
    expect(pro.marginPct).toBeCloseTo(61.5, 1);

    const team = rollup.plans.find((p) => p.plan === "team")!;
    expect(team.totalUnits).toBe(200);
    expect(team.marginPct).toBeCloseTo(62.0, 1);
  });

  it("excludes events outside the window", async () => {
    const proUser = await seedUser(harness, { plan: "pro" });
    await seedEvent(proUser, 1.0, 50, { daysAgo: 0 });
    await seedEvent(proUser, 99.0, 50, { daysAgo: 30 });

    const rollup = await getCostMarginRollup({ windowDays: 7 });
    const pro = rollup.plans.find((p) => p.plan === "pro")!;
    expect(pro.totalCostUsd).toBeCloseTo(1.0, 6);
    expect(pro.totalUnits).toBe(50);
  });

  it("reports null margin for the free plan", async () => {
    const freeUser = await seedUser(harness, { plan: "free" });
    await seedEvent(freeUser, 0.5, 30);

    const rollup = await getCostMarginRollup();
    const free = rollup.plans.find((p) => p.plan === "free")!;
    expect(free.perUnitRevenueUsd).toBe(0);
    expect(free.marginPct).toBeNull();
  });

  it("computes cache hit ratio across input + cache_read + cache_create", async () => {
    const proUser = await seedUser(harness, { plan: "pro" });
    // 1,000 input + 4,000 cache_read + 0 cache_create = 5,000 total
    // cache_read / total = 4,000 / 5,000 = 0.80.
    await seedEvent(proUser, 0.05, 5, {
      inputTokens: 1_000,
      cacheReadTokens: 4_000,
    });

    const rollup = await getCostMarginRollup();
    const pro = rollup.plans.find((p) => p.plan === "pro")!;
    expect(pro.avgCacheHitRatio).toBeCloseTo(0.8, 4);
  });

  it("counts currently paused users", async () => {
    await seedUser(harness, { plan: "pro" });
    const paused1 = await seedUser(harness, { plan: "pro" });
    const paused2 = await seedUser(harness, { plan: "team" });
    await harness.db
      .update(schema.users)
      .set({ costPauseActive: true })
      .where(
        // OR-ish: just flip the two we want
        (await import("drizzle-orm")).inArray(schema.users.id, [
          paused1,
          paused2,
        ]),
      );

    const rollup = await getCostMarginRollup();
    expect(rollup.currentlyPausedCount).toBe(2);
  });
});

describe("plansBelowMarginThreshold", () => {
  it("returns paid plans whose margin is below the threshold", async () => {
    const proUser = await seedUser(harness, { plan: "pro" });
    // Cost $0.038/unit on $0.039/unit revenue → ~2.6% margin.
    await seedEvent(proUser, 3.8, 100);

    const rollup = await getCostMarginRollup();
    const breaches = plansBelowMarginThreshold(rollup, 30);
    expect(breaches.map((b) => b.plan)).toEqual(["pro"]);
  });

  it("ignores free-plan activity", async () => {
    const freeUser = await seedUser(harness, { plan: "free" });
    await seedEvent(freeUser, 5.0, 50);

    const rollup = await getCostMarginRollup();
    const breaches = plansBelowMarginThreshold(rollup, 30);
    expect(breaches).toEqual([]);
  });

  it("returns empty when every paid plan is above threshold", async () => {
    const proUser = await seedUser(harness, { plan: "pro" });
    // Cost $0.005/unit on $0.039 → 87% margin.
    await seedEvent(proUser, 0.5, 100);

    const rollup = await getCostMarginRollup();
    const breaches = plansBelowMarginThreshold(rollup, 30);
    expect(breaches).toEqual([]);
  });
});
