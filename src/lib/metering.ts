/**
 * Length-routed metering for /api/check.
 *
 * Schema 3.0.0 (2026-05-05) collapsed the previous three-tier model
 * (Standard / Document / Surface) into a single proportional rate
 * with a length-based size class. The caller no longer chooses a
 * tier; the engine routes by `text.length`:
 *
 *   - small  (≤200 chars) — billed as 1 unit (the floor).
 *   - large  (>200 chars) — billed proportionally, 1 unit per 200
 *                           characters, rounded up. A 201-char input
 *                           is 2 units; a 4,000-char input is 20.
 *
 * The `sizeClass` is a derived label used for analytics and to drive
 * the dashboard's rendering branch (≤200 chars → standard per-finding
 * UX; >200 chars → rich doc-tier UX with rewrite, sticky verdict,
 * categorized findings, inline excerpts). It is NOT a customer-facing
 * tier name. The dashboard estimator surfaces "X characters · Y units"
 * with no tier label.
 *
 * Why this replaced the three-tier model:
 *   1. Customers couldn't tell Document from Surface — the labels
 *      created friction without commensurate benefit.
 *   2. Standard tier on long inputs broke the dashboard UX (the
 *      wall-of-red-strikethrough antipattern). Routing by length
 *      lets the rich UX apply automatically.
 *   3. Flat-rate tiers (8 / 25 units) rewarded picking the right
 *      tier; proportional billing is honest and tier-free.
 *   4. Pre-launch with zero paying customers was the right time to
 *      break the wire format.
 */

/** Size class derived from input length. Used for analytics + the
 * dashboard's UX routing. Never a user-chosen value. */
export type SizeClass = "small" | "large";

/** The single character window used for proportional billing. A
 * `UNIT_WINDOW`-char input bills as 1 unit; `2 * UNIT_WINDOW` as 2.
 * The same number governs the small/large boundary for the
 * dashboard's UX routing. */
export const UNIT_WINDOW = 200;

/** Hard ceiling on raw input characters per call. Above this the
 * caller must split the input into multiple calls. */
export const MAX_INPUT_CHARS = 50_000;

export interface MeterDecision {
  /** Derived size class. `"small"` for ≤UNIT_WINDOW; `"large"` above. */
  sizeClass: SizeClass;
  /** Billable units consumed in standard-check equivalents. */
  unitsConsumed: number;
  /** Raw character count of the input — populated for the response
   * `metering` block so integrators can show "X chars · N units". */
  inputChars: number;
  /** Always 1 for single-string calls. Reserved for batch/multi-segment
   * surfaces; populated forward-compat so wire-format consumers don't
   * see the field appear later in 3.x. */
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
 *
 * Empty input still costs 1 unit so that zero-length probes don't get
 * a free pass through the meter.
 */
export function meter(text: string): MeterDecision {
  const chars = text.length;
  const unitsConsumed = Math.max(1, Math.ceil(chars / UNIT_WINDOW));
  const sizeClass: SizeClass = chars > UNIT_WINDOW ? "large" : "small";
  return {
    sizeClass,
    unitsConsumed,
    inputChars: chars,
    inputSegments: 1,
    splitApplied: false,
  };
}

/**
 * The metering block surfaced on /api/check responses. Wire-format
 * 3.0.0 — replaces the three-tier `tier` field with a derived
 * `size_class`. Clients that read the metering block need to update
 * their type definitions; clients that ignore the block keep working.
 */
export interface MeteringBlock {
  size_class: SizeClass;
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
    size_class: decision.sizeClass,
    units_consumed: decision.unitsConsumed,
    input_chars: decision.inputChars,
    input_segments: decision.inputSegments,
    split_applied: decision.splitApplied,
  };
}

/**
 * Predicate for the rich-UX branch on the dashboard. Inputs above the
 * unit window (>200 chars) get the doc-tier UX (sticky verdict,
 * suggested rewrite, categorized findings, inline excerpts). At-or-
 * below get the standard per-finding-card UX with inline word diffs.
 */
export function isLargeInput(text: string): boolean {
  return text.length > UNIT_WINDOW;
}

// Backward-compat re-exports for any consumer still importing the
// pre-3.0.0 names. These are deprecated — new code should use
// `UNIT_WINDOW` / `meter(text)` / `SizeClass` directly. The Zod
// schema is no longer needed (no segment_type request param), so it's
// removed entirely.
//
// `STANDARD_CHAR_CAP` previously held 300; the new boundary is 200,
// reflecting both the smaller billing window and the UX cutoff. If a
// downstream caller imports the old constant, they'll silently shift
// from 300-char windows to 200-char windows on import, which is the
// correct behavior under the new schema.
/** @deprecated Use `UNIT_WINDOW` instead. Retained for one cycle as
 * a soft-fail import path during the 3.0.0 cutover. */
export const STANDARD_CHAR_CAP = UNIT_WINDOW;
