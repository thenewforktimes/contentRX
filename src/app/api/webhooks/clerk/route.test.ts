/**
 * Idempotency tests for the Clerk webhook handler.
 *
 * Audit 2026-04-26 P0: Clerk's dedupe gates *side effects* (welcome
 * email + signup analytics) — not the DB writes themselves. The DB
 * writes are idempotent (`onConflictDoNothing`), but the side effects
 * are not. The fix shipped on 2026-04-25 in response to a real
 * incident; this suite is the regression coverage.
 *
 * Mocking strategy:
 *   - getDb() → pglite harness
 *   - getRedis() → in-process Redis stub
 *   - svix Webhook.verify → returns the canned event
 *   - sendEmail / trackEvent → recorders so we can count side effects
 *   - next/headers → returns the synthetic Request's headers
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestDb, type TestDbHarness } from "@/lib/__test_db__";
import { createRedisStub, type RedisStub } from "@/lib/__test_db__/redis-stub";

const dbRef: { current: TestDbHarness["db"] | null } = { current: null };
const redisRef: { current: RedisStub | null } = { current: null };
const incomingHeaders: { current: Headers | null } = { current: null };

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

vi.mock("next/headers", () => ({
  headers: async () => {
    if (!incomingHeaders.current) {
      throw new Error("incomingHeaders not set for this request");
    }
    return incomingHeaders.current;
  },
}));

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

vi.mock("@/emails/welcome", () => ({
  WelcomeEmail: () => null,
}));

// svix mock — return whatever event was queued for this delivery.
const svixEvents = new Map<string, unknown>();
vi.mock("svix", () => ({
  Webhook: class {
    verify() {
      const next = svixEvents.get("next");
      if (!next) throw new Error("svix stub: no event queued");
      svixEvents.delete("next");
      return next;
    }
  },
}));

import { POST } from "./route";

let harness: TestDbHarness;

beforeAll(async () => {
  process.env.CLERK_WEBHOOK_SECRET = "whsec_test";
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
  sentEmails.length = 0;
  trackedEvents.length = 0;
});

function queueEvent(event: object): void {
  svixEvents.set("next", event);
}

function makeReq(svixId: string): Request {
  const hdrs = new Headers({
    "svix-id": svixId,
    "svix-timestamp": String(Math.floor(Date.now() / 1000)),
    "svix-signature": "v1,abc",
    "content-type": "application/json",
  });
  incomingHeaders.current = hdrs;
  return new Request("https://example.com/api/webhooks/clerk", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ ignored: "stub does not parse this" }),
  });
}

describe("Clerk webhook idempotency", () => {
  it("returns 400 when svix headers are missing", async () => {
    incomingHeaders.current = new Headers();
    const req = new Request("https://example.com/api/webhooks/clerk", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates the user row + sends welcome email on first user.created", async () => {
    queueEvent({
      type: "user.created",
      data: {
        id: "clerk_alice",
        email_addresses: [{ id: "e1", email_address: "alice@test.local" }],
        primary_email_address_id: "e1",
      },
    });
    const res = await POST(makeReq("svix_first"));
    expect(res.status).toBe(200);

    const [row] = await harness.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.clerkId, "clerk_alice"));
    expect(row?.email).toBe("alice@test.local");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.to).toBe("alice@test.local");
    expect(trackedEvents.some((e) => e.name === "signup")).toBe(true);
    // Dedupe key was set with svix-id prefix.
    expect(redisRef.current!.store.has("clerk_event:svix_first")).toBe(true);
  });

  it("does NOT re-send the welcome email on a replay (same svix-id)", async () => {
    // First delivery
    queueEvent({
      type: "user.created",
      data: {
        id: "clerk_bob",
        email_addresses: [{ id: "e1", email_address: "bob@test.local" }],
        primary_email_address_id: "e1",
      },
    });
    await POST(makeReq("svix_replay"));
    expect(sentEmails).toHaveLength(1);

    // Replay — same svix-id, same event payload.
    queueEvent({
      type: "user.created",
      data: {
        id: "clerk_bob",
        email_addresses: [{ id: "e1", email_address: "bob@test.local" }],
        primary_email_address_id: "e1",
      },
    });
    const res = await POST(makeReq("svix_replay"));
    expect(res.status).toBe(200);

    // Welcome email did NOT fire again.
    expect(sentEmails).toHaveLength(1);
    // user_signup analytics did NOT re-fire.
    const signupEvents = trackedEvents.filter((e) => e.name === "signup");
    expect(signupEvents).toHaveLength(1);
  });

  it("DB writes are idempotent across retries (no second row)", async () => {
    // The audit's incident: a webhook that crashed mid-flight on the
    // first attempt. The retry must not be blocked by an over-eager
    // dedupe set, AND must not produce duplicate rows.
    queueEvent({
      type: "user.created",
      data: {
        id: "clerk_carol",
        email_addresses: [{ id: "e1", email_address: "carol@test.local" }],
        primary_email_address_id: "e1",
      },
    });
    await POST(makeReq("svix_retry_1"));
    queueEvent({
      type: "user.created",
      data: {
        id: "clerk_carol",
        email_addresses: [{ id: "e1", email_address: "carol@test.local" }],
        primary_email_address_id: "e1",
      },
    });
    await POST(makeReq("svix_retry_2")); // distinct svix-id (new attempt)

    const rows = await harness.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.clerkId, "clerk_carol"));
    // onConflictDoNothing prevents duplicates.
    expect(rows).toHaveLength(1);
  });

  it("falls through (still fires welcome) when Redis throws on dedupe lookup", async () => {
    redisRef.current!.failNext();
    queueEvent({
      type: "user.created",
      data: {
        id: "clerk_dave",
        email_addresses: [{ id: "e1", email_address: "dave@test.local" }],
        primary_email_address_id: "e1",
      },
    });
    const res = await POST(makeReq("svix_redis_outage"));
    expect(res.status).toBe(200);
    // Welcome email fired despite the Redis failure (better a duplicate
    // than a missed welcome).
    expect(sentEmails).toHaveLength(1);
  });

  it("ignores non-user events without crashing", async () => {
    queueEvent({
      type: "session.created" as "user.created",
      data: { id: "sess_x", email_addresses: [], primary_email_address_id: null },
    });
    const res = await POST(makeReq("svix_session"));
    expect(res.status).toBe(200);
    // No DB write, no email, no analytics for unknown event types.
    expect(sentEmails).toHaveLength(0);
    expect(trackedEvents.some((e) => e.name === "signup")).toBe(false);
  });
});
