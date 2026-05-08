/**
 * Resolver tests for /api/violations/override.
 *
 * Schema 2.0.0 stripped substrate from the public Violation envelope,
 * so surfaces like the Figma plugin don't carry standard_id. The
 * route accepts the override anyway and recovers standard_id from
 * the violations table by:
 *   1. violation_id (direct FK), then
 *   2. (userId, textHash) match (most recent).
 * If neither resolves the route 400s — without a standard the row
 * would poison override analytics.
 *
 * These tests cover the new resolver paths only — the auth, PII, and
 * rate-limit branches are exercised at /api/check's E2E test and via
 * the lib unit tests (pii-screen, ratelimit). Direct-standard_id
 * (CLI / dashboard / GH Action / LSP / MCP) is the existing path
 * and stays unchanged; one assertion confirms the wire is intact.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedUser, type TestDbHarness } from "@/lib/__test_db__";
import { createRedisStub, type RedisStub } from "@/lib/__test_db__/redis-stub";
import { hashApiKey } from "@/lib/api-key";
import { hashText } from "@/lib/log-violations";

const dbRef: { current: TestDbHarness["db"] | null } = { current: null };
const redisRef: { current: RedisStub | null } = { current: null };

vi.mock("@/db", async () => {
  const actual = await vi.importActual<typeof import("@/db")>("@/db");
  return {
    ...actual,
    getDb: () => {
      if (!dbRef.current) throw new Error("test harness not initialised");
      return dbRef.current;
    },
  };
});

vi.mock("@/lib/redis", () => ({
  getRedis: () => {
    if (!redisRef.current) throw new Error("redis stub not initialised");
    return redisRef.current;
  },
}));

const rateLimit: { current: { success: boolean; reset: number } } = {
  current: { success: true, reset: 0 },
};
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(async () => rateLimit.current),
}));

vi.mock("@/lib/revalidate", () => ({
  revalidateDashboard: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
  clerkClient: vi.fn(),
}));

import { POST } from "./route";

let harness: TestDbHarness;

const TEST_API_KEY = "cx_aliceAaaaaaaabbbbbbbbccccccccdd";
const USER_ID = "alice";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://test.contentrx";
  harness = await createTestDb();
  dbRef.current = harness.db;
  redisRef.current = createRedisStub();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
  redisRef.current?.reset();
  rateLimit.current = { success: true, reset: 0 };
  await seedUser(harness, {
    id: USER_ID,
    plan: "pro",
    apiKeyHash: hashApiKey(TEST_API_KEY),
    apiKeyPrefix: TEST_API_KEY.slice(0, 12),
  });
});

function makeReq(body: object): Request {
  return new Request("https://example.com/api/violations/override", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TEST_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

async function seedViolation(args: {
  standardId: string;
  text: string;
  source?: "plugin" | "dashboard";
}): Promise<string> {
  const id = `vio_${Math.random().toString(36).slice(2, 10)}`;
  await harness.db.insert(schema.violations).values({
    id,
    userId: USER_ID,
    teamId: USER_ID,
    contentType: "button_cta",
    standardId: args.standardId,
    severity: "high",
    textHash: hashText(args.text),
    source: args.source ?? "plugin",
  });
  return id;
}

describe("POST /api/violations/override — standard_id resolver", () => {
  it("recovers standard_id from a textHash match when not supplied", async () => {
    await seedViolation({ standardId: "ACC-01", text: "Click here" });

    const res = await POST(
      makeReq({
        text: "Click here",
        override_type: "dismiss",
        source: "plugin",
        override_stance: "disagree",
      }),
    );

    expect(res.status).toBe(201);
    const [row] = await harness.db
      .select()
      .from(schema.violationOverrides);
    expect(row?.standardId).toBe("ACC-01");
    expect(row?.source).toBe("plugin");
  });

  it("prefers violation_id over textHash when both available", async () => {
    const olderId = await seedViolation({
      standardId: "GRM-01",
      text: "shared text",
    });
    // A second, newer violation with a different standard for the
    // same text — the textHash fallback would prefer this one (it's
    // newer); the violation_id path must override that.
    await seedViolation({ standardId: "ACC-01", text: "shared text" });

    const res = await POST(
      makeReq({
        text: "shared text",
        override_type: "dismiss",
        source: "plugin",
        violation_id: olderId,
      }),
    );

    expect(res.status).toBe(201);
    const [row] = await harness.db
      .select()
      .from(schema.violationOverrides);
    expect(row?.standardId).toBe("GRM-01");
  });

  it("400s when no violations row matches and no standard_id supplied", async () => {
    const res = await POST(
      makeReq({
        text: "never logged before",
        override_type: "dismiss",
        source: "plugin",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/attribute this override/);
    const overrides = await harness.db
      .select()
      .from(schema.violationOverrides);
    expect(overrides).toHaveLength(0);
  });

  it("uses the supplied standard_id directly without a violations lookup", async () => {
    // No violations row seeded — would 400 under the resolver path,
    // but a directly-supplied standard_id (CLI / GH Action / dashboard)
    // bypasses recovery and inserts as-is.
    const res = await POST(
      makeReq({
        text: "any text",
        standard_id: "ACT-01",
        override_type: "dismiss",
        source: "cli",
      }),
    );

    expect(res.status).toBe(201);
    const [row] = await harness.db
      .select()
      .from(schema.violationOverrides);
    expect(row?.standardId).toBe("ACT-01");
    expect(row?.source).toBe("cli");
  });
});
