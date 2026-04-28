/**
 * Unit tests for the dashboard cache-tag taxonomy (audit Pf3).
 *
 * The shape and naming of the tags is the contract: every loader's
 * `unstable_cache` references the same tag a writer's revalidator
 * uses, so a misnamed string in either spot silently breaks
 * invalidation. These tests pin the names down.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from "next/cache";
import {
  revalidateAfterCheck,
  revalidateSubscription,
  revalidateUsage,
  revalidateViolations,
  tags,
} from "./cache-tags";

describe("tags — generators produce stable names", () => {
  it("usage tag includes user id", () => {
    expect(tags.usage("user_123")).toBe("usage:user:user_123");
  });

  it("subscription tag includes owner id", () => {
    expect(tags.subscription("owner_abc")).toBe("subscription:owner:owner_abc");
  });

  it("violations tag includes team id", () => {
    expect(tags.violations("team_xyz")).toBe("violations:team:team_xyz");
  });

  it("tags differ across scopes for the same id", () => {
    // Same string can't accidentally bust the wrong scope.
    expect(tags.usage("u1")).not.toBe(tags.subscription("u1"));
    expect(tags.subscription("u1")).not.toBe(tags.violations("u1"));
  });
});

describe("revalidate helpers — call revalidateTag with the matching name", () => {
  it("revalidateUsage busts the user's usage tag", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateUsage("user_123");
    expect(revalidateTag).toHaveBeenCalledWith("usage:user:user_123");
  });

  it("revalidateSubscription busts the owner's subscription tag", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateSubscription("owner_abc");
    expect(revalidateTag).toHaveBeenCalledWith("subscription:owner:owner_abc");
  });

  it("revalidateViolations busts the team's violations tag", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateViolations("team_xyz");
    expect(revalidateTag).toHaveBeenCalledWith("violations:team:team_xyz");
  });

  it("revalidateAfterCheck busts both usage and violations", () => {
    vi.mocked(revalidateTag).mockClear();
    revalidateAfterCheck({ userId: "u1", teamId: "t1" });
    expect(revalidateTag).toHaveBeenCalledWith("usage:user:u1");
    expect(revalidateTag).toHaveBeenCalledWith("violations:team:t1");
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });

  it("swallows revalidateTag failures so writes don't 500", () => {
    vi.mocked(revalidateTag).mockClear();
    vi.mocked(revalidateTag).mockImplementationOnce(() => {
      throw new Error("static-generation-store missing");
    });
    // Must not throw — the write request returning 200 is the contract.
    expect(() => revalidateUsage("user_500")).not.toThrow();
  });
});
