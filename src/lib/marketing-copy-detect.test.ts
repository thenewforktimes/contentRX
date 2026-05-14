import { describe, expect, it } from "vitest";
import {
  countMarketingMarkers,
  looksLikeMarketingCopy,
  shouldShowMarketingBanner,
  MARKETING_MARKER_THRESHOLD,
} from "./marketing-copy-detect";

/**
 * Marketing-copy heuristic tests (Phase F2, 2026-05-09 roadmap).
 *
 * The heuristic is intentionally noisy on the side of false positives.
 * Tests pin the threshold behavior, the case-insensitivity, the
 * length pre-condition, and the engine-moment fallthrough.
 */

describe("countMarketingMarkers", () => {
  it("returns zero for an empty string", () => {
    expect(countMarketingMarkers("")).toBe(0);
  });

  it("returns zero for plain product writing", () => {
    const text =
      "Save changes and reload the dashboard. The team rules are " +
      "applied on every check.";
    expect(countMarketingMarkers(text)).toBe(0);
  });

  it("counts a single hype adjective", () => {
    expect(countMarketingMarkers("Our amazing new feature.")).toBe(1);
  });

  it("counts repeated occurrences separately", () => {
    expect(countMarketingMarkers("Amazing new feature. Amazing!")).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(countMarketingMarkers("AMAZING")).toBe(1);
    expect(countMarketingMarkers("Amazing")).toBe(1);
    expect(countMarketingMarkers("amazing")).toBe(1);
  });

  it("catches both hyphenated and spaced multi-word markers", () => {
    expect(countMarketingMarkers("our world-class team")).toBe(1);
    expect(countMarketingMarkers("our world class team")).toBe(1);
  });

  it("counts every marker in a paragraph of marketing copy", () => {
    const marketing =
      "We're thrilled to announce our revolutionary new platform. " +
      "Industry-leading features and a world-class team will " +
      "supercharge your workflow.";
    // thrilled (1) + revolutionary (1) + industry-leading (1) +
    // world-class (1) + supercharge (1). "excited to announce" is
    // also a marker but the example uses "thrilled to announce."
    expect(countMarketingMarkers(marketing)).toBeGreaterThanOrEqual(5);
  });
});

describe("looksLikeMarketingCopy", () => {
  it("returns false when no markers are present", () => {
    const text = "We rotated affected sessions and emailed every user.";
    expect(looksLikeMarketingCopy(text)).toBe(false);
  });

  it("returns false below the threshold", () => {
    // Two markers, threshold is 3.
    const text = "Our amazing team built a robust system.";
    expect(countMarketingMarkers(text)).toBe(2);
    expect(MARKETING_MARKER_THRESHOLD).toBe(3);
    expect(looksLikeMarketingCopy(text)).toBe(false);
  });

  it("returns true at or above the threshold", () => {
    const text = "Our amazing, robust, and innovative new platform.";
    expect(looksLikeMarketingCopy(text)).toBe(true);
  });
});

describe("shouldShowMarketingBanner", () => {
  it("returns false for short inputs even when markers are present", () => {
    // Below 200 chars; banner doesn't fire regardless of marker count.
    const short = "Our amazing, robust, and innovative new platform.";
    expect(short.length).toBeLessThan(200);
    expect(shouldShowMarketingBanner(short, null)).toBe(false);
  });

  it("returns true on a long input with three or more markers", () => {
    const long =
      "We're absolutely thrilled to announce our newest feature, " +
      "advanced review intelligence. This robust capability " +
      "leverages cutting-edge AI to facilitate your team's ability " +
      "to optimize content workflows. The intuitive new dashboard " +
      "streamlines the review paradigm.";
    expect(long.length).toBeGreaterThan(200);
    expect(shouldShowMarketingBanner(long, null)).toBe(true);
  });

  it("returns false on long product writing without marketing markers", () => {
    const long =
      "On April 12, 2026, an attacker accessed email addresses for " +
      "1,200 accounts. No passwords or content were exposed. We " +
      "rotated affected sessions and emailed every affected user " +
      "on April 13th. If you didn't get an email, you weren't " +
      "affected. Questions: security@contentrx.io.";
    expect(long.length).toBeGreaterThan(200);
    expect(shouldShowMarketingBanner(long, null)).toBe(false);
  });

  it("triggers when the engine returns moment === 'marketing' even without markers", () => {
    // Forward-compat: engine MOMENTS list doesn't include "marketing"
    // today; the day it does, the banner should pick it up.
    const long =
      "A long-form draft that doesn't trip the heuristic on its own " +
      "but the engine has classified as marketing. The reader is " +
      "going to scroll through the flag list and the calibration " +
      "context matters before they decide whether to argue with the " +
      "engine. The banner gets the calibration in front of the work.";
    expect(long.length).toBeGreaterThan(200);
    expect(shouldShowMarketingBanner(long, "marketing")).toBe(true);
  });

  it("does not trigger when moment is something other than 'marketing' and markers are below threshold", () => {
    const long =
      "A neutral product update that mentions innovative once and " +
      "stays calm otherwise. The change is small. The reader doesn't " +
      "have to translate the announcement, and the engine doesn't " +
      "have anything to say about marketing-shaped writing here. " +
      "The banner stays away.";
    expect(long.length).toBeGreaterThan(200);
    expect(shouldShowMarketingBanner(long, "notification")).toBe(false);
  });
});
