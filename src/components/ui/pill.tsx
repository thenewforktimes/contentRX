/**
 * Pill — single shape, single contrast formula, six color variants.
 *
 * Backed by the design tokens defined in `src/app/globals.css`. Every
 * tone uses a `{accent}-soft` background paired with `{accent}-text`
 * foreground — both verified against WCAG 2.1 AAA (≥7:1) in dark and
 * light mode. No 50% opacity backgrounds, no -300 shouting text. The
 * pill reads as a tag at the same visual weight as body text, never
 * brighter.
 *
 * Tone names map to the semantic accent roles in the design system:
 *
 *   neutral  — default; plan-free, generic status (raised surface)
 *   emerald  — affirm role: pass verdict, plan-pro, connected
 *   amber    — caution role: review_recommended, "needs attention"
 *   red      — concern role: violation, past_due, error
 *   stone    — muted; "no value", placeholder, disabled
 *   blue     — info role; rarely used; only when emerald is taken
 *
 * The legacy color-name API (emerald/amber/red/blue) is preserved so
 * existing callers don't need to migrate. New code can use the same
 * names knowing they map to semantic tokens internally — the pill
 * primitive is the single seam between callers and the design system.
 *
 * Two sizes only — adding a third invites drift; if a third feels
 * necessary, it's usually a sign the surrounding layout wants attention
 * instead.
 */

import type { ReactNode } from "react";

export type PillTone =
  | "neutral"
  | "emerald"
  | "amber"
  | "red"
  | "stone"
  | "blue";

export type PillSize = "sm" | "xs";

const toneClasses: Record<PillTone, string> = {
  neutral:
    "border-line bg-raised text-default",
  emerald:
    "border-accent-affirm-border bg-accent-affirm-soft text-accent-affirm-text",
  amber:
    "border-accent-caution-border bg-accent-caution-soft text-accent-caution-text",
  red:
    "border-accent-concern-border bg-accent-concern-soft text-accent-concern-text",
  stone:
    "border-line bg-canvas text-quiet",
  blue:
    "border-accent-info-border bg-accent-info-soft text-accent-info-text",
};

const sizeClasses: Record<PillSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  xs: "px-2 py-0.5 text-[10px]",
};

const baseClasses =
  "inline-flex items-center gap-1.5 rounded-md border font-medium";

export function pillStyles(
  tone: PillTone = "neutral",
  className = "",
  size: PillSize = "sm",
): string {
  return [baseClasses, sizeClasses[size], toneClasses[tone], className]
    .filter(Boolean)
    .join(" ");
}

export function Pill({
  tone = "neutral",
  size = "sm",
  className,
  children,
}: {
  tone?: PillTone;
  size?: PillSize;
  className?: string;
  children: ReactNode;
}) {
  return <span className={pillStyles(tone, className, size)}>{children}</span>;
}
