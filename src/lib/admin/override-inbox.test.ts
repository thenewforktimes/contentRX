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
import { createTestDb, seedUser, type TestDbHarness } from "../__test_db__";

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

import { triageOverride } from "./override-inbox";

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

async function seedOpenOverride(
  userId: string,
  overrideId: string,
): Promise<void> {
  await harness.db.insert(schema.violationOverrides).values({
    id: overrideId,
    teamId: userId,
    userId,
    standardId: "ACT-01",
    moment: "error_recovery",
    textHash: "hash_" + overrideId,
    overrideType: "dismiss",
    source: "dashboard",
    contributeUpstream: true,
    text: "Save changes",
  });
}

describe("triageOverride() — race guard", () => {
  it("flips an open override to the target status and returns true", async () => {
    const triager = await seedUser(harness, { id: "triager" });
    const owner = await seedUser(harness, { id: "owner" });
    await seedOpenOverride(owner, "ovr_1");

    const result = await triageOverride({
      overrideId: "ovr_1",
      newStatus: "addressed_corpus",
      triagedBy: triager,
    });
    expect(result).toBe(true);

    const [row] = await harness.db
      .select()
      .from(schema.violationOverrides)
      .where(eq(schema.violationOverrides.id, "ovr_1"));
    expect(row?.overrideStatus).toBe("addressed_corpus");
    expect(row?.overrideStatusUpdatedBy).toBe(triager);
  });

  it("rejects a second triage on a row that's already resolved", async () => {
    const a = await seedUser(harness, { id: "founder_a" });
    const b = await seedUser(harness, { id: "founder_b" });
    const owner = await seedUser(harness, { id: "owner" });
    await seedOpenOverride(owner, "ovr_2");

    const first = await triageOverride({
      overrideId: "ovr_2",
      newStatus: "addressed_corpus",
      triagedBy: a,
    });
    const second = await triageOverride({
      overrideId: "ovr_2",
      newStatus: "addressed_patch",
      triagedBy: b,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    // Original triage attribution survives — the race guard prevented
    // founder B from silently overwriting founder A's resolution.
    const [row] = await harness.db
      .select()
      .from(schema.violationOverrides)
      .where(eq(schema.violationOverrides.id, "ovr_2"));
    expect(row?.overrideStatus).toBe("addressed_corpus");
    expect(row?.overrideStatusUpdatedBy).toBe(a);
  });

  it("returns false when the row doesn't exist", async () => {
    const triager = await seedUser(harness, { id: "triager" });
    const result = await triageOverride({
      overrideId: "nonexistent",
      newStatus: "not_actionable",
      triagedBy: triager,
    });
    expect(result).toBe(false);
  });
});
