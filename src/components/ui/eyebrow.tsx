/**
 * Eyebrow — small uppercase sans-serif label that sits above an H1 or H2.
 *
 * The single most-repeated text pattern on the public surface
 * (~15+ inlined uses pre-extraction). Promotes the
 * `text-xs font-semibold uppercase tracking-widest text-quiet`
 * recipe to a first-class component so future pages don't re-derive
 * it (and the eventual color/spacing tweak is a one-place change).
 *
 * Uses Inter (the body sans, via font-sans) at semibold + uppercase
 * + wide tracking. Earlier draft used `font-mono` for the small-label
 * look, which read as "tech tool" against Inter's editorial body —
 * Plausible, Linear, Stripe, and most editorial sites use the body
 * sans in caps for eyebrows. Mono stays where it actually fits:
 * code samples, hashes, IDs, timestamps.
 *
 * Uses `text-quiet` (≥7:1 AAA Normal contrast in both modes) — readable
 * but visually subordinate to the H1/H2 it labels.
 *
 * 2026-05-10 highlight variant:
 *   <Eyebrow highlight>...</Eyebrow>
 * Wraps the text in a `bg-accent-caution-soft text-accent-caution-text`
 * inline swatch — the marker-pen treatment Ditto uses on their pricing
 * eyebrow. Adds personality on a per-page basis (opt-in via prop)
 * without affecting any existing caller. AAA contrast preserved
 * because both `bg-accent-caution-soft` and `text-accent-caution-text`
 * are AAA-verified tokens; the variant swaps the recipe, not the
 * color story.
 */

import type { ReactNode } from "react";

export function Eyebrow({
  children,
  className = "",
  highlight = false,
}: {
  children: ReactNode;
  className?: string;
  /** When true, render the text inside a soft-caution swatch (the
   *  marker-pen treatment). When false (default), render plain quiet
   *  text. Existing callers unaffected. */
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <p
        className={`text-xs font-semibold uppercase tracking-widest ${className}`.trim()}
      >
        <span className="inline-block rounded-sm bg-accent-caution-soft px-1.5 py-0.5 text-accent-caution-text">
          {children}
        </span>
      </p>
    );
  }
  return (
    <p
      className={`text-xs font-semibold uppercase tracking-widest text-quiet ${className}`.trim()}
    >
      {children}
    </p>
  );
}
