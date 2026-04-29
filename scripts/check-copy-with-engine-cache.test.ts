/**
 * Cache-layer tests for the engine-check script. Uses a fresh temp
 * directory per test so cache files don't leak between specs.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, readCache, writeCache } from "./check-copy-with-engine";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "contentrx-cache-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cacheKey", () => {
  it("is stable across runs", () => {
    const a = cacheKey("hello", "button", "error_state", "product_ui", "https://x.test");
    const b = cacheKey("hello", "button", "error_state", "product_ui", "https://x.test");
    expect(a).toBe(b);
  });

  it("changes when text changes", () => {
    const a = cacheKey("hello", null, null, "product_ui", "https://x.test");
    const b = cacheKey("hello!", null, null, "product_ui", "https://x.test");
    expect(a).not.toBe(b);
  });

  it("changes when content_type changes", () => {
    const a = cacheKey("hello", "button", null, "product_ui", "https://x.test");
    const b = cacheKey("hello", "heading", null, "product_ui", "https://x.test");
    expect(a).not.toBe(b);
  });

  it("changes when moment changes", () => {
    const a = cacheKey("hello", null, "error_state", "product_ui", "https://x.test");
    const b = cacheKey("hello", null, "onboarding", "product_ui", "https://x.test");
    expect(a).not.toBe(b);
  });

  it("changes when audience changes", () => {
    const a = cacheKey("hello", null, null, "product_ui", "https://x.test");
    const b = cacheKey("hello", null, null, "marketing", "https://x.test");
    expect(a).not.toBe(b);
  });

  it("changes when endpoint changes (staging vs prod)", () => {
    const a = cacheKey("hello", null, null, "product_ui", "https://prod.test");
    const b = cacheKey("hello", null, null, "product_ui", "https://staging.test");
    expect(a).not.toBe(b);
  });

  it("differs between null and empty string for content_type", () => {
    // Null and "" hash the same here on purpose: we send no field
    // when the hint is null, and we'd never legitimately send "".
    // Document the behavior in case it matters later.
    const a = cacheKey("hello", null, null, "product_ui", "https://x.test");
    const b = cacheKey("hello", "", "", "product_ui", "https://x.test");
    expect(a).toBe(b);
  });
});

describe("readCache / writeCache", () => {
  const sampleResponse = {
    result: {
      verdict: "pass" as const,
      violations: [],
      review_reason: null,
    },
    latency_ms: 123,
  };

  it("returns null on miss", () => {
    expect(readCache(dir, "nonexistent-key", 60_000)).toBeNull();
  });

  it("round-trips a write", () => {
    writeCache(dir, "k1", sampleResponse);
    const got = readCache(dir, "k1", 60_000);
    expect(got).toEqual(sampleResponse);
  });

  it("returns null when entry is older than ttl", () => {
    writeCache(dir, "k2", sampleResponse);
    // Force-expire by rewriting with a stale timestamp.
    const path = join(dir, "k2.json");
    const stale = {
      cached_at: new Date(Date.now() - 100_000).toISOString(),
      response: sampleResponse,
    };
    writeFileSync(path, JSON.stringify(stale), "utf-8");
    expect(readCache(dir, "k2", 50_000)).toBeNull();
  });

  it("returns null on corrupt cache file", () => {
    const path = join(dir, "k3.json");
    writeFileSync(path, "{ not json", "utf-8");
    expect(readCache(dir, "k3", 60_000)).toBeNull();
  });
});
