/**
 * Tests for the signed-nonce CARL consent layer.
 *
 * Single-use enforcement is exercised against a Redis stub (same
 * pattern as email.test.ts) so the test suite stays self-contained.
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
  process.env.CONSENT_HMAC_SECRET = "test-secret-do-not-use-in-production";
});

afterEach(() => {
  vi.restoreAllMocks();
  redisRef.current?.reset();
  delete process.env.CONSENT_HMAC_SECRET;
});

import { mintConsentToken, verifyConsentToken } from "./consent-token";

describe("mintConsentToken", () => {
  it("produces a token in the expected `<b64url>.<b64url>` shape", () => {
    const token = mintConsentToken({
      userId: "usr_alpha",
      action: "auto-renewal",
    });
    expect(token.split(".")).toHaveLength(2);
  });

  it("emits a unique token per call (different nonces)", () => {
    const a = mintConsentToken({ userId: "u", action: "auto-renewal" });
    const b = mintConsentToken({ userId: "u", action: "auto-renewal" });
    expect(a).not.toBe(b);
  });
});

describe("verifyConsentToken — happy path", () => {
  it("accepts a freshly-minted token from the same user + action", async () => {
    const token = mintConsentToken({
      userId: "usr_alpha",
      action: "auto-renewal",
    });
    const result = await verifyConsentToken({
      token,
      expectedUserId: "usr_alpha",
      expectedAction: "auto-renewal",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.nonce).toBe("string");
      expect(result.nonce.length).toBeGreaterThan(0);
      expect(typeof result.issuedAt).toBe("number");
    }
  });
});

describe("verifyConsentToken — rejections", () => {
  it("rejects a token that isn't `<part>.<part>`", async () => {
    const result = await verifyConsentToken({
      token: "not-a-real-token",
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("rejects a token with garbage payload", async () => {
    const result = await verifyConsentToken({
      token: "!!!.!!!",
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("rejects a token where the signature was tampered with", async () => {
    const token = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    const [payload] = token.split(".");
    // Flip the signature to something same-length but wrong.
    const fakeSig = "A".repeat(token.split(".")[1].length);
    const tampered = `${payload}.${fakeSig}`;
    const result = await verifyConsentToken({
      token: tampered,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad-signature");
  });

  it("rejects a token where the payload was tampered with (signature no longer matches)", async () => {
    const token = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    const [, sig] = token.split(".");
    // Swap in a different payload but keep the original signature.
    const fakePayload = Buffer.from(
      JSON.stringify({
        uid: "ATTACKER",
        iat: Date.now(),
        act: "auto-renewal",
        nonce: "x",
      }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tampered = `${fakePayload}.${sig}`;
    const result = await verifyConsentToken({
      token: tampered,
      expectedUserId: "ATTACKER",
      expectedAction: "auto-renewal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad-signature");
  });

  it("rejects a token issued for a different user", async () => {
    const token = mintConsentToken({
      userId: "usr_alpha",
      action: "auto-renewal",
    });
    const result = await verifyConsentToken({
      token,
      expectedUserId: "usr_beta",
      expectedAction: "auto-renewal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong-user");
  });

  it("rejects an expired token", async () => {
    const token = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    const result = await verifyConsentToken({
      token,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
      // Pretend we're verifying 20 minutes after the mint.
      now: Date.now() + 20 * 60 * 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects a future-dated token (clock skew defense)", async () => {
    // Mint with a clock pretending to be 10 minutes in the future.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 10 * 60 * 1000);
    const token = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    vi.restoreAllMocks();
    // Verifier's clock is "now" (in the past relative to mint).
    const result = await verifyConsentToken({
      token,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
      now: realNow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });
});

describe("verifyConsentToken — single-use", () => {
  it("rejects the second use of the same token (replay defense)", async () => {
    const token = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    const first = await verifyConsentToken({
      token,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    expect(first.ok).toBe(true);

    const second = await verifyConsentToken({
      token,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("replayed");
  });

  it("allows two distinct tokens to verify independently", async () => {
    const a = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    const b = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    const ra = await verifyConsentToken({
      token: a,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    const rb = await verifyConsentToken({
      token: b,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
  });
});

describe("verifyConsentToken — Redis outage", () => {
  it("still accepts a valid token when Redis throws (degraded but not closed)", async () => {
    redisRef.current!.failNext(new Error("simulated upstash outage"));
    const token = mintConsentToken({
      userId: "u",
      action: "auto-renewal",
    });
    const result = await verifyConsentToken({
      token,
      expectedUserId: "u",
      expectedAction: "auto-renewal",
    });
    expect(result.ok).toBe(true);
  });
});
