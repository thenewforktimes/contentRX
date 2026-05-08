/**
 * Phase 3 of the post-Phase-1 build asks for an idempotency test:
 * "send 100 quota-crossing checks at once; exactly one 80% email and
 * one 100% email fire". The dedupe is implemented via Redis SETNX
 * inside `sendEmail` — so this test exercises that layer directly,
 * not the full /api/check route. The route's threshold-detection
 * logic is exercised by the existing route tests; what wasn't
 * covered before is that 100 sendEmail calls with the same
 * dedupeKey land as exactly one outbound send.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createRedisStub, type RedisStub } from "./__test_db__/redis-stub";

const redisRef: { current: RedisStub | null } = { current: null };

vi.mock("./redis", () => ({
  getRedis: () => {
    if (redisRef.current === null) {
      throw new Error("redis stub not initialised");
    }
    return redisRef.current;
  },
}));

beforeEach(() => {
  redisRef.current = createRedisStub();
  // Make sure no RESEND_API_KEY leaks into the test process — the
  // dev/no-op path is what we want to exercise so we can count
  // would-have-sent calls without hitting Resend.
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  redisRef.current?.reset();
});

import { sendEmail } from "./email";

const dummyReact = { type: "div", props: {}, key: null } as unknown as
  Parameters<typeof sendEmail>[0]["react"];

describe("sendEmail dedupe (Phase 3 idempotency)", () => {
  it("100 concurrent sends with the same dedupeKey land as one would-be send", async () => {
    const dedupeKey = `quota-warning:user_abc:2026-05:80`;
    const calls = await Promise.all(
      Array.from({ length: 100 }, () =>
        sendEmail({
          to: "abc@test.local",
          subject: "Heads up. 200 ContentRX checks left this month",
          react: dummyReact,
          dedupeKey,
        }),
      ),
    );

    const firstSends = calls.filter((c) => c.ok && !c.deduplicated);
    const dedups = calls.filter((c) => c.ok && c.deduplicated);

    expect(firstSends.length).toBe(1);
    expect(dedups.length).toBe(99);
  });

  it("80% and 100% thresholds dedupe independently within the same month", async () => {
    const month = "2026-05";
    const userId = "user_abc";

    // 50 concurrent calls cross the 80% threshold.
    const eightyKey = `quota-warning:${userId}:${month}:80`;
    const eightyCalls = await Promise.all(
      Array.from({ length: 50 }, () =>
        sendEmail({
          to: "abc@test.local",
          subject: "80% threshold",
          react: dummyReact,
          dedupeKey: eightyKey,
        }),
      ),
    );
    expect(eightyCalls.filter((c) => !c.deduplicated).length).toBe(1);

    // 50 concurrent calls cross the 100% threshold — different key,
    // so it fires independently.
    const hundredKey = `quota-warning:${userId}:${month}:100`;
    const hundredCalls = await Promise.all(
      Array.from({ length: 50 }, () =>
        sendEmail({
          to: "abc@test.local",
          subject: "100% threshold",
          react: dummyReact,
          dedupeKey: hundredKey,
        }),
      ),
    );
    expect(hundredCalls.filter((c) => !c.deduplicated).length).toBe(1);

    // Across the two thresholds: exactly one 80%, exactly one 100%.
    expect(redisRef.current!.store.has(`email:${eightyKey}`)).toBe(true);
    expect(redisRef.current!.store.has(`email:${hundredKey}`)).toBe(true);
  });

  it("when dedupeKey is omitted, every call sends (no dedupe)", async () => {
    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        sendEmail({
          to: "abc@test.local",
          subject: "no dedupe",
          react: dummyReact,
        }),
      ),
    );
    expect(calls.every((c) => c.ok && !c.deduplicated)).toBe(true);
  });

  it("does not block the email send if Redis fails to set the dedupe key", async () => {
    redisRef.current!.failNext(new Error("simulated upstash outage"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await sendEmail({
      to: "abc@test.local",
      subject: "redis down",
      react: dummyReact,
      dedupeKey: "quota-warning:user_abc:2026-05:80",
    });

    expect(result.ok).toBe(true);
    expect(result.deduplicated).toBeUndefined();
    expect(consoleWarn).toHaveBeenCalled();
  });
});
