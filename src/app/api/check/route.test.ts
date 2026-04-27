/**
 * E2E test for the /api/check hot path.
 *
 * Audit 2026-04-26 P0: 215 LOC of auth → quota → custom-example
 * short-circuit → engine → log → return on the heaviest revenue
 * surface, with zero integration tests until now.
 *
 * Mocking strategy:
 *   - getDb() → pglite harness (real Postgres semantics for usage,
 *     violations, users)
 *   - getRedis() → in-process Redis stub (rate-limit + dedupe, where
 *     applicable)
 *   - evaluate() → returns a canned EvaluateResponse (the Python
 *     engine boundary; tested independently via pytest)
 *   - checkRateLimit() → success by default; per-test override available
 *   - sendEmail / trackEvent → no-op recorders
 *
 * Auth path tested: API-key (Bearer cx_…). Clerk-session path is
 * exercised via resolveAuth's Clerk branch in unit tests; this E2E
 * test stays on the bearer path because it doesn't require mocking
 * Clerk's async auth() helper.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestDb, seedUser, type TestDbHarness } from "@/lib/__test_db__";
import { createRedisStub, type RedisStub } from "@/lib/__test_db__/redis-stub";
import { hashApiKey } from "@/lib/api-key";

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

// Engine boundary — return whichever response the test pre-loads.
const cannedEval: { current: object | null } = { current: null };
vi.mock("@/lib/evaluate", () => ({
  evaluate: vi.fn(async () => {
    if (!cannedEval.current) throw new Error("no canned eval response");
    return cannedEval.current;
  }),
}));

// Rate-limiter — pass by default.
const rateLimit: { current: { success: boolean; reset: number } } = {
  current: { success: true, reset: 0 },
};
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(async () => rateLimit.current),
}));

// Side-effect recorders.
const sentEmails: Array<{ to: string; subject: string }> = [];
const trackedEvents: Array<{ name: string; props?: object }> = [];
vi.mock("@/lib/email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email")>(
    "@/lib/email",
  );
  return {
    ...actual,
    sendEmail: vi.fn(async (args: { to: string; subject: string }) => {
      sentEmails.push({ to: args.to, subject: args.subject });
      return { ok: true as const };
    }),
  };
});
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn((name: string, props?: object) => {
    trackedEvents.push({ name, props });
  }),
}));
vi.mock("@/emails/quota-warning", () => ({
  QuotaWarningEmail: () => null,
}));
vi.mock("@/emails/quota-exhausted", () => ({
  QuotaExhaustedEmail: () => null,
}));

// resolveAuth's Clerk-session branch fires when there's no Bearer
// token. In tests we always carry a Bearer; the no-bearer test
// expects 401, which Clerk's auth() can't deliver outside a Next.js
// request context. Mock auth() to act as "no authenticated session"
// so resolveAuth returns 401 cleanly.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
  clerkClient: vi.fn(),
}));

import { POST } from "./route";

let harness: TestDbHarness;

const TEST_API_KEY = "cx_aliceAaaaaaaabbbbbbbbccccccccdd";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://test.contentrx";
  // Force the default (private) taxonomy mode for these route tests.
  // The PUBLIC_TAXONOMY=true smoke CI sets the flag to true to exercise
  // the reversibility-insurance path; this suite is specifically the
  // private-taxonomy contract regression, so we override.
  delete process.env.PUBLIC_TAXONOMY;
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
  sentEmails.length = 0;
  trackedEvents.length = 0;
  cannedEval.current = null;
  rateLimit.current = { success: true, reset: 0 };
});

async function seedAuthedUser(plan: "free" | "pro" | "team" = "pro"): Promise<string> {
  return await seedUser(harness, {
    id: "alice",
    plan,
    apiKeyHash: hashApiKey(TEST_API_KEY),
    apiKeyPrefix: TEST_API_KEY.slice(0, 12),
  });
}

function makeReq(body: object, opts?: { auth?: string }): Request {
  return new Request("https://example.com/api/check", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: opts?.auth ?? `Bearer ${TEST_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

const VIOLATION_RESULT = {
  result: {
    content_type: "button_cta",
    overall_verdict: "fail",
    verdict: "violation",
    review_reason: null,
    violations: [
      {
        // Substrate fields the engine emits — public envelope must
        // strip these before returning to the caller.
        standard_id: "ACC-01",
        rule_version: "1.0.0",
        rule: "Avoid 'click here' link text.",
        source: "llm",
        // Public fields.
        issue: "Link text is too vague to convey destination.",
        suggestion: "Replace with the destination noun.",
        severity: "high",
        confidence: 0.91,
      },
    ],
    passes: [],
    summary: "One ACC-01 issue.",
    audience: "product_ui",
    moment: "wayfinding",
    pipeline: {},
    rationale_chain: [],
  },
  latency_ms: 42,
  tokens: { input: 1200, output: 80 },
};

const PASS_RESULT = {
  result: {
    content_type: "short_ui_copy",
    overall_verdict: "pass",
    verdict: "pass",
    review_reason: null,
    violations: [],
    passes: [],
    summary: "All clear.",
    audience: "product_ui",
    moment: "browsing_discovery",
    pipeline: {},
    rationale_chain: [],
  },
  latency_ms: 38,
  tokens: { input: 800, output: 50 },
};

// ---------------------------------------------------------------------------
// Auth & input validation
// ---------------------------------------------------------------------------

describe("/api/check — auth + input", () => {
  it("rejects requests without an API key", async () => {
    const res = await POST(
      makeReq({ text: "Click here" }, { auth: "" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects API keys that don't match a users row", async () => {
    const res = await POST(
      makeReq({ text: "Click here" }, { auth: "Bearer cx_unknownAxxxxxxxxxxxxxxxxxxx" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects malformed request bodies (zod validation)", async () => {
    await seedAuthedUser();
    const res = await POST(
      new Request("https://example.com/api/check", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ /* missing 'text' */ }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Happy path — engine called, envelope stripped, usage incremented
// ---------------------------------------------------------------------------

describe("/api/check — happy path", () => {
  it("returns the public envelope (schema 2.0.0) with substrate fields stripped", async () => {
    await seedAuthedUser("pro");
    cannedEval.current = VIOLATION_RESULT;

    const res = await POST(makeReq({ text: "Click here for more info" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.schema_version).toBe("2.0.0");
    expect(body.verdict).toBe("violation");
    expect(Array.isArray(body.violations)).toBe(true);
    expect(body.violations).toHaveLength(1);

    const v = body.violations[0];
    // Public envelope shape — exactly four fields.
    expect(v.issue).toBe("Link text is too vague to convey destination.");
    expect(v.suggestion).toBe("Replace with the destination noun.");
    expect(v.severity).toBe("high");
    expect(v.confidence).toBeCloseTo(0.91);

    // Substrate fields MUST NOT leak.
    expect(v.standard_id).toBeUndefined();
    expect(v.rule_version).toBeUndefined();
    expect(v.rule).toBeUndefined();
    expect(v.source).toBeUndefined();
    expect(v.related_standards).toBeUndefined();
    expect(v.docs_url).toBeUndefined();

    // Top-level substrate keys also stripped.
    expect(body.passes).toBeUndefined();
    expect(body.pipeline).toBeUndefined();
    expect(body.rationale_chain).toBeUndefined();
    expect(body.audience).toBeUndefined();
  });

  it("increments the user's monthly usage row", async () => {
    const userId = await seedAuthedUser("pro");
    cannedEval.current = PASS_RESULT;

    expect(await harness.db
      .select()
      .from(schema.usage)
      .where(eq(schema.usage.userId, userId))).toHaveLength(0);

    await POST(makeReq({ text: "Save changes" }));

    const [row] = await harness.db
      .select()
      .from(schema.usage)
      .where(eq(schema.usage.userId, userId));
    expect(row?.count).toBe(1);
    expect(row?.inputTokens).toBe(800);
    expect(row?.outputTokens).toBe(50);
  });

  it("logs each violation into the violations table with sha256 of text", async () => {
    const userId = await seedAuthedUser("pro");
    cannedEval.current = VIOLATION_RESULT;

    await POST(makeReq({ text: "Click here for more info" }));

    const rows = await harness.db
      .select()
      .from(schema.violations)
      .where(eq(schema.violations.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.standardId).toBe("ACC-01");
    expect(rows[0]?.severity).toBe("high");
    // Privacy: text is hashed, not stored.
    expect(rows[0]?.textHash).toMatch(/^[a-f0-9]{64}$/);
    // The actual text should never appear in any column.
    const concat = JSON.stringify(rows[0]);
    expect(concat).not.toContain("Click here for more info");
  });
});

// ---------------------------------------------------------------------------
// Quota + rate-limit gates
// ---------------------------------------------------------------------------

describe("/api/check — gates", () => {
  it("returns 429 + retry-after when rate-limited (does NOT decrement quota)", async () => {
    const userId = await seedAuthedUser("pro");
    cannedEval.current = PASS_RESULT;
    rateLimit.current = { success: false, reset: Date.now() + 30_000 };

    const res = await POST(makeReq({ text: "anything" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);

    const usageRows = await harness.db
      .select()
      .from(schema.usage)
      .where(eq(schema.usage.userId, userId));
    expect(usageRows).toHaveLength(0);
  });

  it("returns 402 when quota exhausted (does NOT call the engine)", async () => {
    const userId = await seedAuthedUser("free");
    // Pre-fill usage to the free-tier cap. monthlyQuota("free") is 250.
    await harness.db.insert(schema.usage).values({
      id: "u-fill",
      userId,
      month: new Date().toISOString().slice(0, 7),
      count: 250,
    });
    cannedEval.current = PASS_RESULT;

    const res = await POST(makeReq({ text: "anything" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/quota/i);
    expect(body.used).toBe(250);
    expect(body.plan).toBe("free");
  });

  it("under concurrent requests at the cap-1 boundary, exactly one succeeds", async () => {
    // Free-tier monthlyQuota is 25 (src/lib/quotas.ts). Pre-fill to
    // cap-1 (24), fire 5 concurrent POSTs; exactly one returns 200,
    // the rest return 402. Proves the claimQuotaSlot atomic upsert
    // holds end-to-end through the route handler — not just at the
    // unit-test layer where it's also proven (src/lib/usage.test.ts).
    const userId = await seedAuthedUser("free");
    const month = new Date().toISOString().slice(0, 7);
    await harness.db.insert(schema.usage).values({
      id: "u-boundary",
      userId,
      month,
      count: 24, // cap is 25
    });
    cannedEval.current = PASS_RESULT;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => POST(makeReq({ text: "burst" }))),
    );
    const oks = results.filter((r) => r.status === 200).length;
    const exhausted = results.filter((r) => r.status === 402).length;

    expect(oks).toBe(1);
    expect(exhausted).toBe(4);
    // Final usage equals the cap exactly — no above-cap leak.
    const [row] = await harness.db
      .select()
      .from(schema.usage)
      .where(eq(schema.usage.userId, userId));
    expect(row?.count).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Engine failure
// ---------------------------------------------------------------------------

describe("/api/check — engine failure", () => {
  it("returns 502 + opaque message when evaluate() throws", async () => {
    await seedAuthedUser("pro");
    const { evaluate } = await import("@/lib/evaluate");
    vi.mocked(evaluate).mockRejectedValueOnce(new Error("python engine down"));

    const res = await POST(makeReq({ text: "anything" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Evaluation service unavailable");
    // The internal error message must not leak.
    expect(JSON.stringify(body)).not.toContain("python engine down");
  });
});
