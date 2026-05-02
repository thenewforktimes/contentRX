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

import {
  flagInboxCounts,
  loadFlagInbox,
  triageFlag,
} from "./customer-flag-inbox";

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

async function seedFlag(
  userId: string,
  id: string,
  overrides: Partial<typeof schema.customerFlaggedReviews.$inferInsert> = {},
): Promise<void> {
  await harness.db.insert(schema.customerFlaggedReviews).values({
    id,
    userId,
    teamId: userId,
    text: "Click here",
    textHash: "hash_" + id,
    flagReason: "doesnt_match_experience",
    source: "dashboard",
    ...overrides,
  });
}

describe("loadFlagInbox", () => {
  it("returns open flags by default, sorted most-recent-first", async () => {
    const user = await seedUser(harness);
    await seedFlag(user, "flag_old", { text: "older" });
    await new Promise((r) => setTimeout(r, 5));
    await seedFlag(user, "flag_new", { text: "newer" });

    const rows = await loadFlagInbox();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("flag_new");
    expect(rows[1].id).toBe("flag_old");
  });

  it("filters out non-open rows by default", async () => {
    const user = await seedUser(harness);
    await seedFlag(user, "flag_open", { text: "open one" });
    await seedFlag(user, "flag_closed", {
      text: "closed one",
      status: "addressed_corpus",
    });

    const rows = await loadFlagInbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("open one");
  });

  it("status='all' returns everything in the window", async () => {
    const user = await seedUser(harness);
    await seedFlag(user, "f1");
    await seedFlag(user, "f2", { status: "addressed_corpus" });
    await seedFlag(user, "f3", { status: "not_actionable" });

    const rows = await loadFlagInbox({ status: "all" });
    expect(rows).toHaveLength(3);
  });

  it("joins user email", async () => {
    const user = await seedUser(harness, { email: "robo@example.com" });
    await seedFlag(user, "f1");

    const rows = await loadFlagInbox();
    expect(rows[0].userEmail).toBe("robo@example.com");
  });
});

describe("triageFlag — race guard", () => {
  it("flips an open flag to the new status and returns true", async () => {
    const triager = await seedUser(harness, { id: "triager" });
    const owner = await seedUser(harness, { id: "owner" });
    await seedFlag(owner, "f1");

    const ok = await triageFlag({
      flagId: "f1",
      newStatus: "addressed_corpus",
      triagedBy: triager,
      notes: "good calibration example",
    });
    expect(ok).toBe(true);

    const [row] = await harness.db
      .select()
      .from(schema.customerFlaggedReviews)
      .where(eq(schema.customerFlaggedReviews.id, "f1"));
    expect(row.status).toBe("addressed_corpus");
    expect(row.triagedBy).toBe(triager);
    expect(row.triageNotes).toBe("good calibration example");
    expect(row.triagedAt).not.toBeNull();
  });

  it("a second triage on an already-triaged row is a no-op", async () => {
    const triager = await seedUser(harness, { id: "triager" });
    const owner = await seedUser(harness, { id: "owner" });
    await seedFlag(owner, "f1");

    const first = await triageFlag({
      flagId: "f1",
      newStatus: "addressed_corpus",
      triagedBy: triager,
    });
    const second = await triageFlag({
      flagId: "f1",
      newStatus: "not_actionable",
      triagedBy: triager,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const [row] = await harness.db
      .select()
      .from(schema.customerFlaggedReviews)
      .where(eq(schema.customerFlaggedReviews.id, "f1"));
    expect(row.status).toBe("addressed_corpus");
  });

  it("returns false for a non-existent flag id", async () => {
    const triager = await seedUser(harness, { id: "triager" });
    const ok = await triageFlag({
      flagId: "no-such-id",
      newStatus: "addressed_corpus",
      triagedBy: triager,
    });
    expect(ok).toBe(false);
  });
});

describe("flagInboxCounts", () => {
  it("returns open + total counts", async () => {
    const user = await seedUser(harness);
    await seedFlag(user, "f1");
    await seedFlag(user, "f2");
    await seedFlag(user, "f3", { status: "addressed_corpus" });

    const counts = await flagInboxCounts();
    expect(counts.open).toBe(2);
    expect(counts.total).toBe(3);
  });

  it("returns zero when empty", async () => {
    const counts = await flagInboxCounts();
    expect(counts.open).toBe(0);
    expect(counts.total).toBe(0);
  });
});
