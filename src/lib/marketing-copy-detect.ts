/**
 * Marketing-copy heuristic for the dashboard paste-mode banner (Phase
 * F2, 2026-05-09 roadmap).
 *
 * The /dashboard paste surface is calibrated for product and internal
 * writing. Long-form persuasive marketing copy is the predictable
 * false-positive case: the engine flags more "worth a look" findings
 * than the writer expects, and the writer concludes ContentRX is
 * wrong. The marketing-copy banner is the hedge — it shows up when
 * the input looks marketing-shaped and explains the calibration up
 * front, before the reader scans the flag list.
 *
 * The trigger is intentionally noisy on the side of false positives.
 * A false positive costs the user one banner they can ignore. A false
 * negative costs the user trust in the engine. The cost asymmetry
 * justifies the noisy heuristic.
 *
 * Two signals combine:
 *
 *   1. The engine returns `moment === "marketing"`. This is the
 *      forward-compat path; humanize.ts knows the label, the engine
 *      MOMENTS list doesn't include it today (2026-05-09). Listed
 *      here so the day the engine adds the moment, the banner picks
 *      it up automatically.
 *
 *   2. A client-side substring count of marketing-language markers
 *      (hype adjectives, hedge words, jargon verbs). Threshold 3+
 *      filters out single uses in real product writing.
 *
 * Pre-condition for both: text length > 200 chars. Short UI strings
 * aren't "marketing copy" in the relevant sense; the banner only
 * makes sense for paragraph-shaped input.
 */

/**
 * Marketing-language markers. Three buckets:
 *   - Hype adjectives: words that promise without specifying.
 *   - Hedge / excited verbs: words that perform feeling.
 *   - Jargon / corporate verbs: words a content designer would flag
 *     in any register, but that pile up especially in marketing.
 *
 * Both hyphenated and spaced variants of multi-word markers are
 * listed explicitly so a simple substring scan catches both.
 */
const MARKETING_MARKERS: readonly string[] = [
  // Hype adjectives
  "amazing",
  "incredible",
  "revolutionary",
  "world-class",
  "world class",
  "best-in-class",
  "best in class",
  "industry-leading",
  "industry leading",
  "cutting-edge",
  "cutting edge",
  "innovative",
  "next-generation",
  "next generation",
  "game-changing",
  "game changing",
  "groundbreaking",
  "ground-breaking",
  "ground breaking",
  "robust",
  "scalable",
  "seamless",
  "intuitive",
  // Excited / hedge verbs
  "thrilled",
  "delighted",
  "excited to announce",
  // Jargon verbs
  "unleash",
  "supercharge",
  "transform",
  "empower",
  "elevate",
  "leverage",
  "synergize",
  "ideate",
  "optimize",
  "utilize",
];

/** A 4,000-character draft is the F2 acceptance scenario; the banner
 * pre-condition lines up with the metering boundary between small
 * (≤200 chars, per-finding UI) and large (>200 chars, document UI).
 */
const MIN_LENGTH_FOR_BANNER = 200;

/** Number of marker hits required to trigger the heuristic. Tuned so
 * a single appearance of "innovative" or "robust" in real product
 * writing doesn't fire; three or more do. */
export const MARKETING_MARKER_THRESHOLD = 3;

/**
 * Count substring matches of marketing markers in the input. Case-
 * insensitive. Multiple occurrences of the same marker count
 * separately ("amazing ... amazing" counts twice). Substring (not
 * word-boundary) match — false positives like "rescalable" are
 * acceptable per the cost asymmetry above.
 */
export function countMarketingMarkers(text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  for (const marker of MARKETING_MARKERS) {
    let pos = 0;
    while ((pos = lower.indexOf(marker, pos)) !== -1) {
      count++;
      pos += marker.length;
    }
  }
  return count;
}

/** Heuristic-only check: does the text use enough marketing-language
 * markers to trip the threshold? Pure function over text alone. */
export function looksLikeMarketingCopy(text: string): boolean {
  return countMarketingMarkers(text) >= MARKETING_MARKER_THRESHOLD;
}

/**
 * Combined check used by the dashboard. Returns true when:
 *   - the input is long enough to be paragraph-shaped (>200 chars), AND
 *   - either the engine classified moment as "marketing" OR the
 *     client-side heuristic matched.
 */
export function shouldShowMarketingBanner(
  text: string,
  moment: string | null,
): boolean {
  if (!text || text.length <= MIN_LENGTH_FOR_BANNER) return false;
  if (moment === "marketing") return true;
  return looksLikeMarketingCopy(text);
}
