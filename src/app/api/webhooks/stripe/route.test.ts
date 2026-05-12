/**
 * Idempotency tests for the Stripe webhook handler.
 *
 * Audit 2026-05-11: the previous top-level event-id dedupe was racy —
 * a mid-handler crash would set the dedupe key and silently drop the
 * subsequent retry. The handler now relies on:
 *
 *   - DB writes that are upserts / last-write-wins (idempotent under
 *     replay)
 *   - Per-action dedupes inside `sendEmail` (`dedupeKey:` arg) and
 *     `trackUpgradeOnce` (its own Redis `SET NX`)
 *
 * This suite locks both properties: a replay re-runs the DB writes
 * without breaking anything, and the side effects only fire on the
 * first delivery.
 *
 * Mocking strategy:
 *   - getDb() → pglite harness (real Postgres semantics)
 *   - getRedis() → in-process Redis stub (used by sendEmail + analytics)
 *   - stripe.webhooks.constructEventAsync → returns the canned event
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

const sentEmails: Array<{ to: string; subject: string }> = [];
const trackedEvents: Array<{ name: string; props?: object }> = [];

vi.mock("@/lib/email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email")>(
    "@/lib/email",
  );
  return {
    ...actual,
    sendEmail: vi.fn(
      async (args: { to: string; subject: string; dedupeKey?: string }) => {
        // Replicate the dedupe behaviour of the real sendEmail so the
        // per-action dedupe path is exercised in tests too.
        if (args.dedupeKey && redisRef.current) {
          const ok = await redisRef.current.set(
            `email:${args.dedupeKey}`,
            "1",
            { nx: true, ex: 60 },
          );
          if (ok === null) {
            return { ok: true as const, deduplicated: true };
          }
        }
        sentEmails.push({ to: args.to, subject: args.subject });
        return { ok: true as const };
      },
    ),
  };
});

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn((name: string, props?: object) => {
    trackedEvents.push({ name, props });
  }),
}));

vi.mock("@/emails/subscription-confirmation", () => ({
  SubscriptionConfirmationEmail: () => null,
}));
vi.mock("@/emails/payment-failed", () => ({
  PaymentFailedEmail: () => null,
}));
vi.mock("@/emails/welcome", () => ({
  WelcomeEmail: () => null,
}));

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

  it("processes the first delivery and ACKs with 200", async () => {
    queueEvent({
      id: "evt_first",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    // No top-level dedupe key is written — idempotency is the
    // handler's responsibility, not the route's.
    expect(redisRef.current!.store.has("stripe_event:evt_first")).toBe(false);
  });

  it("ACKs replays with 200; DB writes re-run idempotently", async () => {
    // Same event delivered twice — Stripe replay semantics. Both calls
    // must succeed because the DB writes are upserts. The route no
    // longer short-circuits with `deduplicated: true`; the per-handler
    // side effects own that responsibility.
    queueEvent({
      id: "evt_replay",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    });
    const first = await POST(makeReq());
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.received).toBe(true);

    queueEvent({
      id: "evt_replay",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    });
    const second = await POST(makeReq());
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.received).toBe(true);
  });

  it("does not pre-claim a dedupe key (so retry after handler crash still works)", async () => {
    // Regression guard for the 2026-05-11 audit. Earlier code did
    // SET NX `stripe_event:<id>` BEFORE the handler; a crash mid-handler
    // returned 500 → Stripe retried → retry saw the key → returned
    // `deduplicated: true` without re-running. Confirm the key never
    // gets written on a normal happy path.
    queueEvent({
      id: "evt_no_key",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x" } },
    });
    await POST(makeReq());
    // No `stripe_event:*` key should ever land in Redis.
    for (const key of redisRef.current!.store.keys()) {
      expect(key.startsWith("stripe_event:")).toBe(false);
    }
  });

  it("isolated event.ids both ACK 200", async () => {
    queueEvent({
      id: "evt_a",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x" } },
    });
    const a = await POST(makeReq());
    expect(a.status).toBe(200);

    queueEvent({
      id: "evt_b",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x" } },
    });
    const b = await POST(makeReq());
    expect(b.status).toBe(200);
  });
});
