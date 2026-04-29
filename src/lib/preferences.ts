/**
 * Pairwise-preference elicitation — human-eval build plan Session 31.
 *
 * Shape of the feature:
 *
 *   1. A curated pool of `preferencePairs` lives in the DB (seeded
 *      from `evals/preference_pairs.json`).
 *   2. The /api/preferences/session endpoint serves opted-in callers
 *      three unseen pairs per session. Callers pick "left", "right",
 *      or "neither". Answers land in `preferences`.
 *   3. Weekly scheduling: a user who hasn't answered any pairs in the
 *      last 7 days and has no opt-out timestamp is eligible to be
 *      prompted. The caller enforces this; no background job runs.
 *   4. The auto-annotator's precedent index consults the aggregated
 *      preference signal as a second precedent source.
 *
 * The customer-facing `/dashboard/calibrate` surface that originally
 * drove this elicitation was removed 2026-04-29 — see
 * `src/app/(authed)/dashboard/page.tsx` for the rationale. The
 * substrate (this module + the API routes + the DB columns) stays
 * in place; calibration continues behind the scenes via /admin.
 *
 * This module holds the pure logic — selection, scheduling gate,
 * signal aggregation. DB I/O lives in the route handlers.
 */

import type { Preference, PreferencePair } from "@/db/schema";

/** Pairs shown per elicitation session. */
export const PAIRS_PER_SESSION = 3;
/** Minimum days between sessions for a single user. */
export const SESSION_COOLDOWN_DAYS = 7;

// ---------------------------------------------------------------------------
// Scheduling gate
// ---------------------------------------------------------------------------

export interface SchedulingInput {
  /** null = never opted out. */
  optedOutAt: Date | null;
  /** Newest answered-preference timestamp for this user. null = never answered. */
  lastAnsweredAt: Date | null;
  /** Reference `now` — injectable for tests. */
  now: Date;
  cooldownDays?: number;
}

export type SchedulingGate =
  | { eligible: true; reason: "never_answered" | "cooldown_elapsed" }
  | {
      eligible: false;
      reason: "opted_out" | "cooldown_active";
      /** Only set when `reason === "cooldown_active"`. */
      nextEligibleAt?: Date;
    };

/**
 * Decide whether the current user should see an elicitation session.
 *
 * Truth table:
 *   - optedOutAt set          → opted_out (never eligible until unopted)
 *   - no prior answers        → never_answered (eligible)
 *   - last answer older than 7d → cooldown_elapsed (eligible)
 *   - last answer within 7d   → cooldown_active (not eligible, returns next window)
 */
export function shouldPrompt(input: SchedulingInput): SchedulingGate {
  if (input.optedOutAt) {
    return { eligible: false, reason: "opted_out" };
  }
  if (!input.lastAnsweredAt) {
    return { eligible: true, reason: "never_answered" };
  }
  const cooldownMs =
    (input.cooldownDays ?? SESSION_COOLDOWN_DAYS) * 24 * 60 * 60 * 1000;
  const elapsed = input.now.getTime() - input.lastAnsweredAt.getTime();
  if (elapsed >= cooldownMs) {
    return { eligible: true, reason: "cooldown_elapsed" };
  }
  return {
    eligible: false,
    reason: "cooldown_active",
    nextEligibleAt: new Date(input.lastAnsweredAt.getTime() + cooldownMs),
  };
}

// ---------------------------------------------------------------------------
// Pair selection
// ---------------------------------------------------------------------------

export interface SelectionInput {
  /** All active (non-retired) pairs in the pool. */
  availablePairs: readonly PreferencePair[];
  /** Pair IDs the user has already answered — excluded from selection. */
  seenPairIds: readonly string[];
  /**
   * Current precedent counts keyed by `${standardId}|${contentType}`.
   * Used as a tie-breaker: pairs probing under-represented
   * (standard, content_type) tuples rank higher.
   */
  precedentCounts?: Readonly<Record<string, number>>;
  /**
   * Deterministic tie-break seed (e.g. user id). Two users hitting
   * the endpoint at the same instant get stable-but-distinct picks.
   */
  seed: string;
  limit?: number;
}

/**
 * Pick up to `limit` pairs for this session. Selection priorities:
 *   1. Not-yet-seen by this user.
 *   2. Not retired.
 *   3. Target under-represented (standard_id, content_type) first
 *      — lower precedent count ranks higher.
 *   4. Stable-deterministic tie-break using a seeded hash so repeat
 *      requests inside the same second don't yield different pairs.
 */
export function selectSessionPairs(input: SelectionInput): PreferencePair[] {
  const limit = input.limit ?? PAIRS_PER_SESSION;
  const seen = new Set(input.seenPairIds);
  const precedents = input.precedentCounts ?? {};

  const candidates = input.availablePairs.filter(
    (p) => !p.retiredAt && !seen.has(p.id),
  );

  function pairPriority(pair: PreferencePair): number {
    const key = `${pair.standardId}|${pair.contentType}`;
    // Lower count → higher priority (we want to reduce the unknown
    // first). Unknown standard/content_type defaults to 0.
    return precedents[key] ?? 0;
  }

  const sorted = [...candidates].sort((a, b) => {
    const pa = pairPriority(a);
    const pb = pairPriority(b);
    if (pa !== pb) return pa - pb;
    // Deterministic tie-break: hash of (seed, id).
    const ha = stableHash(`${input.seed}|${a.id}`);
    const hb = stableHash(`${input.seed}|${b.id}`);
    if (ha !== hb) return ha - hb;
    return a.id.localeCompare(b.id);
  });

  return sorted.slice(0, limit);
}

/**
 * Cheap, deterministic 32-bit hash. Not cryptographic — only used for
 * deterministic ordering in `selectSessionPairs`. Stable across
 * Node/browser so tests don't drift.
 */
export function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Coerce to unsigned 32-bit.
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Precedent-index signal
// ---------------------------------------------------------------------------

export interface PreferenceSignal {
  /** `${standardId}|${contentType}|${verdict}` — matches annotator_prompt.py keys. */
  key: string;
  /** Aligned responses (picked the stronger side per `expectedPreferred`). */
  aligned: number;
  /** Responses picking the weaker side. */
  conflicting: number;
  /** Responses that chose "neither". */
  neither: number;
}

export interface PairWithResponses {
  pair: PreferencePair;
  responses: Pick<Preference, "preferred">[];
}

/**
 * Build the per-(standard, content_type, verdict) signal from raw
 * pair + response data. The auto-annotator reads this alongside its
 * human-annotation precedents when computing `suggested_confidence`.
 *
 * Mapping convention: when `expected_preferred` is set on the pair,
 * a user picking that side is "aligned" with the standards-encoded
 * preference, and the signal key uses verdict=pass (the text is a
 * good example of the standard). When the user picks the other side,
 * that's a "conflicting" signal at the same key. "Neither" never
 * aligns — it's a judgment-refused signal that weakens confidence
 * in either direction.
 *
 * For pairs with no `expected_preferred` (genuine probes), the key
 * still records responses but alignment stays 0/0 across all
 * responses; the sum of responses is what the caller uses to gauge
 * judgment-probe saturation.
 */
export function buildPreferenceSignals(
  data: PairWithResponses[],
): PreferenceSignal[] {
  const byKey = new Map<string, PreferenceSignal>();

  for (const { pair, responses } of data) {
    // We record verdict=pass as the signal target — the pair asks
    // "which string passes the standard". Aligned picks strengthen
    // "pass"; conflicting picks are evidence the standard's
    // preference isn't universally shared and should be treated with
    // lower confidence.
    const key = `${pair.standardId}|${pair.contentType}|pass`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, aligned: 0, conflicting: 0, neither: 0 };
      byKey.set(key, row);
    }
    for (const r of responses) {
      if (r.preferred === "neither") {
        row.neither += 1;
        continue;
      }
      if (!pair.expectedPreferred) {
        // Judgment probe — count as neither for alignment purposes.
        row.neither += 1;
        continue;
      }
      if (r.preferred === pair.expectedPreferred) row.aligned += 1;
      else row.conflicting += 1;
    }
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Collapse preference signals into the simple `{key → count}` shape
 * that `annotator_prompt.py`'s `_build_precedent_index` consumes.
 * Only counts `aligned` responses — conflicting picks reduce
 * confidence (the caller applies a penalty), and "neither" is
 * noise. Keys with 0 aligned responses are omitted.
 */
export function signalsToPrecedentCounts(
  signals: readonly PreferenceSignal[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of signals) {
    if (s.aligned > 0) out[s.key] = s.aligned;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Confidence calibration
// ---------------------------------------------------------------------------

export type CalibratedConfidence = "high" | "medium" | "low";

/**
 * Blend preference signal with existing annotation precedent count
 * to derive a suggested confidence. Used by the auto-annotator when
 * the annotation count alone is borderline.
 *
 * Rules (conservative — preferences supplement but don't override
 * annotations):
 *   - 3+ annotation precedents → high (preferences only downgrade if
 *     aligned < conflicting and (aligned + conflicting) ≥ 3).
 *   - 1-2 annotation precedents → medium, upgraded to high when
 *     preference ratio is strong (aligned ≥ 3, conflicting = 0) or
 *     downgraded to low when conflicting dominates.
 *   - 0 annotation precedents → low, upgraded to medium when
 *     preference ratio is strong.
 */
export function calibrateConfidence(input: {
  annotationCount: number;
  preferenceSignal?: PreferenceSignal;
}): CalibratedConfidence {
  const { annotationCount: a, preferenceSignal: p } = input;
  const aligned = p?.aligned ?? 0;
  const conflicting = p?.conflicting ?? 0;
  const total = aligned + conflicting;
  const conflictDominates =
    total >= 3 && conflicting > aligned;
  const strongAlignment = aligned >= 3 && conflicting === 0;

  if (a >= 3) {
    return conflictDominates ? "medium" : "high";
  }
  if (a >= 1) {
    if (strongAlignment) return "high";
    if (conflictDominates) return "low";
    return "medium";
  }
  // Zero annotations
  if (strongAlignment) return "medium";
  return "low";
}
