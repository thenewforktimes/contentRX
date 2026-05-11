/**
 * StepBadge — small numbered badge for marking the position of a
 * step in an ordered sequence.
 *
 *   <StepBadge index={1} />  →  ① (yellow-on-black pill)
 *
 * Uses the soft-caution token recipe (same as `<Eyebrow highlight>`
 * and `<Mark>`) so the marker-pen vocabulary stays consistent across
 * surfaces. Ditto's "One / Two / Three" numbered process pills are
 * the visual reference. We use numerals not words — the engine's
 * AP-numeral rule preserves the convention codebase-wide.
 *
 * Renders as a `<span>` with `aria-label="Step N"` for accessibility.
 * The visible digit reads correctly on its own; the aria-label
 * disambiguates for screen readers that might announce it as a
 * generic "1" without sequence context.
 *
 * Variant `complete` dims the badge to indicate "behind the
 * current step" — for diagrams that animate through stages or
 * checklists that mark progress. Pass `state="complete"` (or
 * `pending`/`active`) when the rendering surface owns the state
 * machine; default is `active` which matches "this is a step on
 * the path right now."
 */

import type { ReactNode } from "react";

export type StepBadgeState = "pending" | "active" | "complete";

const stateClasses: Record<StepBadgeState, string> = {
  pending: "bg-sunken text-quiet",
  active: "bg-accent-caution-soft text-accent-caution-text",
  complete: "bg-accent-affirm-soft text-accent-affirm-text",
};

export function StepBadge({
  index,
  state = "active",
  className = "",
  children,
}: {
  /** 1-indexed position in the sequence. */
  index: number;
  /** Visual state. `active` is the default and matches Ditto's
   * yellow numbered pill; `complete` switches to the affirm band;
   * `pending` quiets the badge. */
  state?: StepBadgeState;
  className?: string;
  /** Optional override for the visible label. Defaults to the
   * `index` numeral, which is the common case. Pass when you want
   * a non-numeric marker ("★", "?"). */
  children?: ReactNode;
}) {
  const label = children ?? index;
  return (
    <span
      aria-label={`Step ${index}`}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums ${stateClasses[state]} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
