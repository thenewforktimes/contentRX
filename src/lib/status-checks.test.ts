/**
 * Unit tests for the status helpers.
 *
 * The DB and Redis clients are mocked so the test runs offline. The
 * timeout-and-shape contract is what matters here: a probe that hangs
 * surfaces as `{ ok: false, error: "...timed out..." }` rather than
 * blocking the whole status response.
 */

import { describe, expect, it, vi } from "vitest";

const dbExecute = vi.fn();
const redisPing = vi.fn();

vi.mock("@/db", () => ({
  getDb: () => ({ execute: dbExecute }),
}));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({ ping: redisPing }),
}));

import { checkDb, checkRedis, gatherStatus } from "./status-checks";

describe("checkDb", () => {
  it("returns ok=true with latency when SELECT 1 succeeds", async () => {
    dbExecute.mockResolvedValueOnce([{ "?column?": 1 }]);
    const result = await checkDb();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns ok=false with the error message on failure", async () => {
    dbExecute.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await checkDb();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});

describe("checkRedis", () => {
  it("returns ok=true when ping resolves", async () => {
    redisPing.mockResolvedValueOnce("PONG");
    const result = await checkRedis();
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns ok=false on a hang (timeout)", async () => {
    // Simulate a hang — the probe never resolves. The 2s timeout in
    // the helper should kick in. We use a short fake clock here so
    // the test doesn't actually wait two seconds.
    redisPing.mockImplementationOnce(
      () => new Promise(() => {}),
    );
    vi.useFakeTimers();
    const promise = checkRedis();
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;
    vi.useRealTimers();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });
});

describe("gatherStatus", () => {
  it("aggregates ok=true when both checks pass", async () => {
    dbExecute.mockResolvedValueOnce([]);
    redisPing.mockResolvedValueOnce("PONG");
    const report = await gatherStatus();
    expect(report.ok).toBe(true);
    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.redis.ok).toBe(true);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("aggregates ok=false when any check fails", async () => {
    dbExecute.mockResolvedValueOnce([]);
    redisPing.mockRejectedValueOnce(new Error("network"));
    const report = await gatherStatus();
    expect(report.ok).toBe(false);
    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.redis.ok).toBe(false);
  });
});
