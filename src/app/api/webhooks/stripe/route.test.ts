/**
 * Idempotency tests for the Stripe webhook handler.
 *
 * Audit 2026-04-26 P0: the dedupe path Stripe uses (`SET NX` on
 * event.id with 24h TTL) had zero regression coverage. This suite
 * exercises the replay scenarios — first delivery processes the
 * event, second delivery short-circuits with deduplicated:true,
 * Redis outage falls through.
 *
 * Mocking strategy:
 *   - getDb() → pglite harness (real Postgres semantics)
 *   - getRedis() → in-process Redis stub
 *   - stripe.webhooks.constructEventAsync → returns the canned event
 *
 * What's NOT covered here (out of scope — separate concerns):
 *   - per-handler side effects (handleCheckoutCompleted etc.); those
 *     are unit-tested separately or rely on Drizzle for correctness.
 *   - webhook signature validity; mocked.
 *   - Stripe SDK shape changes; mocked.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDbHarness } from "@/lib/__test_db__";
import { createRedisStub, type RedisStub } from "@/lib/__test_db__/redis-stub";

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

// Track side-effect calls so we can assert "fires once on first
// delivery, not on replay".
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

// Email JSX templates would force vitest to enable JSX transform.
// The handler only passes `react: <Email .../>` to sendEmail (which
// is already mocked), so a stub component-shape is sufficient.
vi.mock("@/emails/subscription-confirmation", () => ({
  SubscriptionConfirmationEmail: () => null,
}));
vi.mock("@/emails/welcome", () => ({
  WelcomeEmail: () => null,
}));

// Stripe SDK mock — canned events keyed by ID.
const stripeEvents = new Map<string, unknown>();
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>(
    "@/lib/stripe",
  );
  return {
    ...actual,
    getStripe: () => ({
      webhooks: {
        constructEventAsync: vi.fn(async () => {
          // Return whichever event was queued for this delivery.
          // Tests call `queueEvent(...)` before each POST.
          const next = stripeEvents.get("next");
          if (!next) {
            throw new Error("stripe stub: no event queued");
          }
          stripeEvents.delete("next");
          return next;
        }),
      },
    }),
  };
});

import { POST } from "./route";

let harness: TestDbHarness;

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_ID_PRO_MONTHLY = "price_pro_m";
  process.env.STRIPE_PRICE_ID_PRO_YEARLY = "price_pro_y";
  process.env.STRIPE_PRICE_ID_TEAM_MONTHLY = "price_team_m";
  process.env.STRIPE_PRICE_ID_TEAM_YEARLY = "price_team_y";
  process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
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
  stripeEvents.set("next", event);
}

function makeReq(): Request {
  return new Request("https://example.com/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=abc" },
    body: JSON.stringify({ ignored: "stub does not parse this" }),
  });
}

describe("Stripe webhook idempotency", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const req = new Request("https://example.com/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("processes the first delivery and writes the dedupe key", async () => {
    queueEvent({
      id: "evt_first",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.deduplicated).toBeUndefined();
    // The dedupe key was set with the event.id prefix.
    expect(redisRef.current!.store.has("stripe_event:evt_first")).toBe(true);
  });

  it("short-circuits a replay of the same event.id with deduplicated:true", async () => {
    // First delivery
    queueEvent({
      id: "evt_replay",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    });
    const first = await POST(makeReq());
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.deduplicated).toBeUndefined();

    // Second delivery — same event.id
    queueEvent({
      id: "evt_replay",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    });
    const second = await POST(makeReq());
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.received).toBe(true);
    expect(secondBody.deduplicated).toBe(true);
  });

  it("isolates dedupe keys across distinct event.ids", async () => {
    queueEvent({
      id: "evt_a",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x" } },
    });
    await POST(makeReq());
    queueEvent({
      id: "evt_b",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x" } },
    });
    const res = await POST(makeReq());
    const body = await res.json();
    // Distinct event.id → no dedupe → both processed.
    expect(body.deduplicated).toBeUndefined();
    expect(redisRef.current!.store.has("stripe_event:evt_a")).toBe(true);
    expect(redisRef.current!.store.has("stripe_event:evt_b")).toBe(true);
  });

  it("falls through and processes the event when Redis throws", async () => {
    // Prod policy: Redis outage shouldn't drop a valid webhook;
    // double-applying is safer than missing one. The handler logs
    // and proceeds.
    redisRef.current!.failNext();
    queueEvent({
      id: "evt_redis_outage",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x" } },
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.deduplicated).toBeUndefined();
    // The dedupe key was never set (the failure short-circuited it),
    // so a literal replay would re-process. Acceptable trade-off.
    expect(redisRef.current!.store.has("stripe_event:evt_redis_outage")).toBe(
      false,
    );
  });
});
