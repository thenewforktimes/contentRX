/**
 * Tier-aware metering for /api/check.
 *
 * Pre-pilot launch (Phase 3): replaces the flat 3,000-char unit with
 * three tiers chosen by the caller. The /api/check route accepts an
 * optional `segment_type` field; if absent, the call defaults to
 * standard.
 *
 * Tier shapes:
 *   - standard: a single string of UI copy in context (a button label,
 *               an error message, a toast). Billed proportionally —
 *               1 unit per 300 characters, rounded up. A 50-char label
 *               is 1 unit; a 600-char paragraph is 2 units; a
 *               3,000-char paragraph is 10 units.
 *   - document: an end-to-end screen / article reviewed for cross-string
 *               consistency (a help article, a full empty state, a
 *               multi-paragraph onboarding flow). Billed flat at 8 units
 *               per call, regardless of length.
 *   - surface:  a complete review surface (a full PR diff, a Figma frame
 *               with all its labels). Billed flat at 25 units per call.
 *
 * Tiers self-select by caller economics:
 *   - Short content (<300 chars): standard wins (1 unit < 8/25).
 *   - Medium content (300–2,400 chars): standard or document depending
 *     on whether cross-string consistency matters.
 *   - Long content (>2,400 chars): document or surface flat-rate beats
 *     per-300-char windowing.
 *
 * No automatic escalation — the engine bills exactly the tier the
 * caller declared. Callers who pick the wrong tier overpay; that is
 * a UX problem solved by the dashboard's real-time estimator, not by
 * a server-side override that hides the bill from the user.
 *
 * The 1/8/25 multipliers are constants here (not in customer-facing
 * pricing copy) so we can re-tune quarterly against actual COGS without
 * a wire-format change.
 */

import { z } from "zod";

export type CheckTier = "standard" | "document" | "surface";

export const CHECK_TIERS = ["standard", "document", "surface"] as const;

/** Characters per standard-tier billable unit. A 300-char input bills
 * as 1 unit; 600 as 2; 1,500 as 5. */
export const STANDARD_CHAR_CAP = 300;

/** Flat unit costs for non-standard tiers, expressed in
 * standard-check equivalents. Document = 8x; surface = 25x. */
export const UNIT_COST_FLAT: Record<Exclude<CheckTier, "standard">, number> = {
  document: 8,
  surface: 25,
};

/** Hard ceiling on raw input characters per call, all tiers. Above this
 * the caller must split the input into multiple calls. Matches the
 * surface tier's natural cap. */
export const MAX_INPUT_CHARS = 50_000;

/** Zod schema for the optional segment_type field on /api/check
 * requests. Use as `segment_type: meterTierSchema.optional().default("standard")`
 * in the route's RequestSchema. */
export const meterTierSchema = z.enum(CHECK_TIERS);

export interface MeterDecision {
  /** The tier billed for this call. Equals the caller's declared
   * tier when present; otherwise `"standard"`. */
  tier: CheckTier;
  /** Billable units consumed in standard-check equivalents. */
  unitsConsumed: number;
  /** Raw character count of the input — populated for the response
   * `metering` block so integrators can show "$X chars · N units". */
  inputChars: number;
  /** Always 1 for single-string calls. Reserved for batch/multi-segment
   * surfaces; populated forward-compat so wire-format consumers don't
   * see the field appear later in 2.x. */
  inputSegments: number;
  /** Always false in the single-string regime. Reserved for the
   * batch/split path. */
  splitApplied: boolean;
}

/**
 * Calculate the meter decision for an incoming check.
 *
 * Pure function — no DB, no IO. Safe to call client-side from the
 * dashboard's live estimator (`explain-client.tsx`) and server-side
 * from `/api/check`. The same code is the source of truth on both
 * sides; mirroring drift can't happen.
 */
export function meter(
  text: string,
  segmentType: CheckTier = "standard",
): MeterDecision {
  const chars = text.length;

  let units: number;
  if (segmentType === "standard") {
    // Per-window billing: empty input still costs 1 unit so that
    // zero-length probes don't get a free pass through the meter.
    units = Math.max(1, Math.ceil(chars / STANDARD_CHAR_CAP));
  } else {
    units = UNIT_COST_FLAT[segmentType];
  }

  return {
    tier: segmentType,
    unitsConsumed: units,
    inputChars: chars,
    inputSegments: 1,
    splitApplied: false,
  };
}

/**
 * The metering block surfaced on /api/check responses. Wire-format
 * 2.1.0 — additive minor, clients that don't read this block keep
 * working unchanged.
 */
export interface MeteringBlock {
  tier: CheckTier;
  units_consumed: number;
  input_chars: number;
  input_segments: number;
  split_applied: boolean;
}

/** Map a `MeterDecision` to the wire-format-shaped block on the
 * response envelope. Snake-case keys match the public envelope's
 * convention (`schema_version`, `review_reason`, etc.). */
export function meteringBlock(decision: MeterDecision): MeteringBlock {
  return {
    tier: decision.tier,
    units_consumed: decision.unitsConsumed,
    input_chars: decision.inputChars,
    input_segments: decision.inputSegments,
    split_applied: decision.splitApplied,
  };
}
