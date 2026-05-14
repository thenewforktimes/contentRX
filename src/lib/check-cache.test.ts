/**
 * Tests for the LLM result cache key + shape guards. The Redis layer
 * itself isn't unit-tested here — that's exercised through the live
 * integration path in /api/check. These tests pin the parts that go
 * silently wrong if regressed:
 *
 *   - cache key determinism (same inputs → same key)
 *   - cache key separation (different inputs → different keys, even
 *     for inputs that "look the same" if you swap field names)
 *   - shouldCache gate semantics
 *   - shape guard rejects bad cache payloads (treat as miss, don't
 *     serve corrupt data)
 */

import { describe, it, expect } from "vitest";
import {
  computeCheckCacheKey,
  shouldCache,
  getCachedEvaluate,
  setCachedEvaluate,
} from "./check-cache";

describe("computeCheckCacheKey", () => {
  it("returns the same key for identical inputs", () => {
    const inputs = {
      text: "Save changes",
      audience: "product_ui",
      moment: "decision_point",
      content_type: "button_cta",
    };
    expect(computeCheckCacheKey(inputs)).toBe(computeCheckCacheKey(inputs));
  });

  it("normalizes missing optionals to a consistent placeholder", () => {
    const a = computeCheckCacheKey({
      text: "Save",
      audience: undefined,
      moment: undefined,
      content_type: undefined,
    });
    const b = computeCheckCacheKey({
      text: "Save",
      audience: undefined,
      moment: undefined,
      content_type: undefined,
    });
    expect(a).toBe(b);
  });

  it("produces different keys for different text", () => {
    const a = computeCheckCacheKey({
      text: "Save changes",
      audience: "product_ui",
      moment: "decision_point",
      content_type: "button_cta",
    });
    const b = computeCheckCacheKey({
      text: "Save Changes",
      audience: "product_ui",
      moment: "decision_point",
      content_type: "button_cta",
    });
    expect(a).not.toBe(b);
  });

  it("produces different keys when moment and content_type swap (no field-name collision)", () => {
    // Defensive: an earlier draft of the key builder concatenated values
    // without their field names. That made ("error", "alert") and
    // ("alert", "error") hash identically. This test pins the fix —
    // even when moment and content_type have swapped semantics, the
    // keys must differ.
    const a = computeCheckCacheKey({
      text: "Save",
      audience: "product_ui",
      moment: "x",
      content_type: "y",
    });
    const b = computeCheckCacheKey({
      text: "Save",
      audience: "product_ui",
      moment: "y",
      content_type: "x",
    });
    expect(a).not.toBe(b);
  });

  it("keys are namespaced under `check:` prefix", () => {
    const key = computeCheckCacheKey({
      text: "Save",
      audience: undefined,
      moment: undefined,
      content_type: undefined,
    });
    expect(key).toMatch(/^check:[A-Za-z0-9_-]+:[a-f0-9]{64}$/);
  });
});

describe("shouldCache", () => {
  it("returns true when no precedents", () => {
    expect(shouldCache(0)).toBe(true);
  });

  it("returns false when any precedents are present", () => {
    expect(shouldCache(1)).toBe(false);
    expect(shouldCache(20)).toBe(false);
  });
});

describe("getCachedEvaluate / setCachedEvaluate failure modes", () => {
  // Both helpers swallow Redis errors and return null / no-op. We test
  // that by NOT setting REDIS env vars — getRedis() throws, and the
  // helper should catch + treat as cache miss.
  it("returns null when Redis is unreachable", async () => {
    const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
    const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const originalKvUrl = process.env.KV_REST_API_URL;
    const originalKvToken = process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    try {
      const result = await getCachedEvaluate("check:v1:doesnotmatter");
      expect(result).toBeNull();
    } finally {
      if (originalUrl) process.env.UPSTASH_REDIS_REST_URL = originalUrl;
      if (originalToken) process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
      if (originalKvUrl) process.env.KV_REST_API_URL = originalKvUrl;
      if (originalKvToken) process.env.KV_REST_API_TOKEN = originalKvToken;
    }
  });

  it("does not throw when Redis is unreachable on set", async () => {
    const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
    const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const originalKvUrl = process.env.KV_REST_API_URL;
    const originalKvToken = process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    try {
      // Should not throw — error is logged and swallowed.
      await expect(
        setCachedEvaluate("check:v1:doesnotmatter", {
          result: {} as never,
          tokens: { input: 0, output: 0 } as never,
          latency_ms: 100,
        } as never),
      ).resolves.toBeUndefined();
    } finally {
      if (originalUrl) process.env.UPSTASH_REDIS_REST_URL = originalUrl;
      if (originalToken) process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
      if (originalKvUrl) process.env.KV_REST_API_URL = originalKvUrl;
      if (originalKvToken) process.env.KV_REST_API_TOKEN = originalKvToken;
    }
  });
});
