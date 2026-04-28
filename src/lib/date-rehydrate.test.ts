/**
 * Pinning the cache-hit-Date-deserialization contract.
 *
 * These tests exist because of a real production incident on 2026-04-28
 * where unstable_cache returned a Date field as an ISO string, the
 * downstream consumer called `.getTime()`, and the dashboard render
 * crashed. The asDate + rehydrateMappedDates helpers are the canonical
 * fix; these tests pin their behavior so a future contributor can't
 * silently weaken the contract.
 */

import { describe, expect, it } from "vitest";
import { asDate, rehydrateMappedDates } from "./date-rehydrate";

describe("asDate", () => {
  it("returns null for null", () => {
    expect(asDate(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(asDate(undefined)).toBeNull();
  });

  it("returns the same instance when given a Date", () => {
    const d = new Date("2026-04-28T16:40:00.000Z");
    expect(asDate(d)).toBe(d);
  });

  it("parses a valid ISO string into a Date", () => {
    const result = asDate("2026-04-28T16:40:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-04-28T16:40:00.000Z");
  });

  it("returns an Invalid Date (not a throw) for an unparseable string", () => {
    // The contract is degrade gracefully, not crash. Downstream code
    // calling .getTime() on the returned Date gets NaN — surfaces as
    // weird display values, never as a runtime exception.
    const result = asDate("not a real date");
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result?.getTime())).toBe(true);
  });

  it("round-trips through JSON.stringify/parse — the cache simulation", () => {
    // This is the actual production scenario: a Date goes into the
    // cache, comes back as a JSON-serialized string, asDate rehydrates
    // it. Without this test the regression would be invisible.
    const original = new Date("2026-04-28T16:40:00.000Z");
    const serialized: string = JSON.parse(JSON.stringify(original));
    expect(typeof serialized).toBe("string"); // confirm the cache-hit shape
    const rehydrated = asDate(serialized);
    expect(rehydrated).toBeInstanceOf(Date);
    expect(rehydrated?.getTime()).toBe(original.getTime());
  });
});

describe("rehydrateMappedDates", () => {
  it("rehydrates a Date field on every value in the map", () => {
    const cached = {
      mcp: { count: 3, lastAt: "2026-04-28T15:40:27.392Z" },
      cli: { count: 0, lastAt: null },
      web: { count: 7, lastAt: "2026-04-27T20:00:00.000Z" },
    };
    const result = rehydrateMappedDates(cached, "lastAt");

    expect(result.mcp.lastAt).toBeInstanceOf(Date);
    expect((result.mcp.lastAt as unknown as Date).toISOString()).toBe(
      "2026-04-28T15:40:27.392Z",
    );
    expect(result.cli.lastAt).toBeNull();
    expect(result.web.lastAt).toBeInstanceOf(Date);
    expect((result.web.lastAt as unknown as Date).toISOString()).toBe(
      "2026-04-27T20:00:00.000Z",
    );
  });

  it("preserves non-Date fields verbatim", () => {
    const cached = {
      mcp: { count: 3, lastAt: "2026-04-28T15:40:00.000Z" },
    };
    const result = rehydrateMappedDates(cached, "lastAt");
    expect(result.mcp.count).toBe(3);
  });

  it("does not mutate the input map", () => {
    const cached = {
      mcp: { count: 3, lastAt: "2026-04-28T15:40:00.000Z" },
    };
    const before = JSON.stringify(cached);
    rehydrateMappedDates(cached, "lastAt");
    expect(JSON.stringify(cached)).toBe(before);
  });

  it("handles already-Date inputs (cold-path / first-call shape)", () => {
    // On a cache miss the loader's own callback ran — the values are
    // real Date instances. The helper must accept that without
    // double-wrapping or losing the instance.
    const date = new Date("2026-04-28T16:40:00.000Z");
    const cached = {
      mcp: { count: 3, lastAt: date },
    };
    const result = rehydrateMappedDates(cached, "lastAt");
    expect(result.mcp.lastAt).toBe(date);
  });

  it("simulates the production failure mode end to end", () => {
    // The exact scenario: loadSourceStats puts a Date in activity,
    // unstable_cache JSON-serializes it, the cache hit returns
    // strings, the helper rehydrates, formatRelative is now safe to
    // call .getTime() on the result.
    const fresh = {
      mcp: { count: 1, lastAt: new Date("2026-04-28T15:40:27.392Z") },
      web: { count: 0, lastAt: null as Date | null },
    };
    // Round-trip through the cache layer's serialization.
    const cacheHit = JSON.parse(JSON.stringify(fresh)) as Record<
      string,
      { count: number; lastAt: string | null }
    >;
    expect(typeof cacheHit.mcp.lastAt).toBe("string"); // confirm the bug shape

    // Apply the rehydrator.
    const safe = rehydrateMappedDates(cacheHit, "lastAt");

    // The downstream consumer (formatRelative) can now call .getTime().
    // Cast through `unknown` because rehydrateMappedDates' return type
    // doesn't statically track that the field was rewritten — it's the
    // caller's responsibility to know the dateKey post-transform shape.
    // The runtime check (instanceof Date below) is what actually pins
    // the contract.
    const lastAt = safe.mcp.lastAt as unknown as Date;
    expect(lastAt).toBeInstanceOf(Date);
    expect(() => lastAt.getTime()).not.toThrow();
    expect(lastAt.getTime()).toBe(fresh.mcp.lastAt!.getTime());
    expect(safe.web.lastAt).toBeNull();
  });
});
