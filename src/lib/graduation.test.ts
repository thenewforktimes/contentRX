import { describe, it, expect, afterEach } from "vitest";
import {
  GRADUATION_LEVELS,
  LEVEL_CONSEQUENCES,
  canApproveGraduation,
  isPromotion,
  levelRank,
} from "./graduation";

describe("GRADUATION_LEVELS", () => {
  it("is the three-step ladder in ascending order", () => {
    expect(GRADUATION_LEVELS).toEqual([
      "robo_labels",
      "batch_approval",
      "autonomous",
    ]);
  });
});

describe("levelRank", () => {
  it("assigns ascending ranks", () => {
    expect(levelRank("robo_labels")).toBeLessThan(levelRank("batch_approval"));
    expect(levelRank("batch_approval")).toBeLessThan(levelRank("autonomous"));
  });
});

describe("isPromotion", () => {
  it("flags strict promotions", () => {
    expect(isPromotion("robo_labels", "batch_approval")).toBe(true);
    expect(isPromotion("robo_labels", "autonomous")).toBe(true);
    expect(isPromotion("batch_approval", "autonomous")).toBe(true);
  });

  it("rejects demotions", () => {
    expect(isPromotion("autonomous", "batch_approval")).toBe(false);
    expect(isPromotion("batch_approval", "robo_labels")).toBe(false);
  });

  it("rejects same-level", () => {
    expect(isPromotion("batch_approval", "batch_approval")).toBe(false);
  });
});

describe("LEVEL_CONSEQUENCES", () => {
  it("has a non-empty string per level", () => {
    for (const lvl of GRADUATION_LEVELS) {
      expect(LEVEL_CONSEQUENCES[lvl]).toBeTypeOf("string");
      expect(LEVEL_CONSEQUENCES[lvl].length).toBeGreaterThan(10);
    }
  });

  it("mentions rollback triggers on batch + autonomous copy", () => {
    expect(LEVEL_CONSEQUENCES.batch_approval).toMatch(/rollback/i);
    expect(LEVEL_CONSEQUENCES.autonomous).toMatch(/rollback/i);
  });
});

describe("canApproveGraduation", () => {
  const orig = process.env.CONTENTRX_ADMIN_CLERK_IDS;
  afterEach(() => {
    if (orig === undefined) delete process.env.CONTENTRX_ADMIN_CLERK_IDS;
    else process.env.CONTENTRX_ADMIN_CLERK_IDS = orig;
  });

  it("returns false when the allow-list is unset", () => {
    delete process.env.CONTENTRX_ADMIN_CLERK_IDS;
    expect(canApproveGraduation("user_123")).toBe(false);
  });

  it("returns false when the allow-list is empty", () => {
    process.env.CONTENTRX_ADMIN_CLERK_IDS = "";
    expect(canApproveGraduation("user_123")).toBe(false);
  });

  it("returns false for a user not on the allow-list", () => {
    process.env.CONTENTRX_ADMIN_CLERK_IDS = "user_999";
    expect(canApproveGraduation("user_123")).toBe(false);
  });

  it("returns true for a user on the allow-list", () => {
    process.env.CONTENTRX_ADMIN_CLERK_IDS = "user_123";
    expect(canApproveGraduation("user_123")).toBe(true);
  });

  it("handles comma-separated allow-list entries + trims whitespace", () => {
    process.env.CONTENTRX_ADMIN_CLERK_IDS = "user_a,  user_b ,user_c";
    expect(canApproveGraduation("user_a")).toBe(true);
    expect(canApproveGraduation("user_b")).toBe(true);
    expect(canApproveGraduation("user_c")).toBe(true);
    expect(canApproveGraduation("user_d")).toBe(false);
  });

  it("returns false for null / undefined clerkIds", () => {
    process.env.CONTENTRX_ADMIN_CLERK_IDS = "user_123";
    expect(canApproveGraduation(null)).toBe(false);
    expect(canApproveGraduation(undefined)).toBe(false);
    expect(canApproveGraduation("")).toBe(false);
  });
});
