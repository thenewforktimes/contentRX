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

import { searchAdmin } from "./search";

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

describe("searchAdmin", () => {
  it("returns empty results for empty query", async () => {
    const r = await searchAdmin("");
    expect(r.results).toEqual([]);
    expect(r.countsBySource).toEqual({ override: 0, queue: 0, flag: 0 });
  });

  it("matches a flag by plaintext substring", async () => {
    const user = await seedUser(harness);
    await harness.db.insert(schema.customerFlaggedReviews).values({
      id: "f1",
      userId: user,
      teamId: user,
      text: "Click here to learn more",
      textHash: "a3f2deadbeef",
      flagReason: "not_clear_helpful_concise",
      source: "dashboard",
    });

    const r = await searchAdmin("learn");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].type).toBe("flag");
    expect(r.results[0].textPreview).toContain("learn more");
  });

  it("matches an override by standard_id", async () => {
    const user = await seedUser(harness);
    await harness.db.insert(schema.violationOverrides).values({
      id: "ovr_1",
      userId: user,
      teamId: user,
      standardId: "ACT-01",
      textHash: "abcd1234",
      overrideType: "dismiss",
      source: "dashboard",
    });

    const r = await searchAdmin("ACT-01");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].type).toBe("override");
  });

  it("matches multiple sources from a single substring", async () => {
    const user = await seedUser(harness);
    // Override w/ shared text
    await harness.db.insert(schema.violationOverrides).values({
      id: "ovr_1",
      userId: user,
      teamId: user,
      standardId: "VOC-01",
      textHash: "h1",
      overrideType: "dismiss",
      source: "dashboard",
      contributeUpstream: true,
      text: "save your work",
    });
    // Flag w/ matching text
    await harness.db.insert(schema.customerFlaggedReviews).values({
      id: "flag_1",
      userId: user,
      teamId: user,
      text: "save your changes",
      textHash: "h2",
      flagReason: "doesnt_match_experience",
      source: "dashboard",
    });

    const r = await searchAdmin("save");
    const types = new Set(r.results.map((x) => x.type));
    expect(types.has("override")).toBe(true);
    expect(types.has("flag")).toBe(true);
  });

  it("matches by hash prefix when query starts with #", async () => {
    const user = await seedUser(harness);
    await harness.db.insert(schema.customerFlaggedReviews).values({
      id: "f_match",
      userId: user,
      teamId: user,
      text: "should not be substring-matched",
      textHash: "deadbeef1234",
      flagReason: "lacks_context",
      source: "dashboard",
    });
    await harness.db.insert(schema.customerFlaggedReviews).values({
      id: "f_other",
      userId: user,
      teamId: user,
      text: "deadbeef in the body shouldn't match a hash query",
      textHash: "1234567890ab",
      flagReason: "lacks_context",
      source: "dashboard",
    });

    const r = await searchAdmin("#deadbeef");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].id).toBe("f_match");
  });

  it("sorts results most-recent-first across sources", async () => {
    const user = await seedUser(harness);

    const old = new Date(Date.now() - 60_000);
    const recent = new Date();

    await harness.db.insert(schema.violationOverrides).values({
      id: "ovr_old",
      userId: user,
      teamId: user,
      standardId: "VOC-01",
      textHash: "h1",
      overrideType: "dismiss",
      source: "dashboard",
      contributeUpstream: true,
      text: "save older",
      createdAt: old,
    });
    await harness.db.insert(schema.customerFlaggedReviews).values({
      id: "flag_recent",
      userId: user,
      teamId: user,
      text: "save more recent",
      textHash: "h2",
      flagReason: "doesnt_match_experience",
      source: "dashboard",
      createdAt: recent,
    });

    const r = await searchAdmin("save");
    expect(r.results[0].id).toBe("flag_recent");
    expect(r.results[1].id).toBe("ovr_old");
  });
});
