/**
 * Pill — single shape, single contrast formula, six color variants.
 *
 * The pre-refresh codebase had pill styles inlined in ~12 places with
 * three different shapes (rounded-full, rounded, rounded-md), two
 * casing schemes (UPPERCASE, sentence case), and inconsistent
 * border/fill combinations. The design critique called for one shape
 * (rounded-md) + sentence case + border-and-fill across the app.
 *
 * This file is the single source. Use `<Pill>` directly, or use
 * `pillStyles(...)` to get the className for cases where you can't
 * render a wrapper (e.g., applying the look to an existing inline
 * element).
 *
 * Colors map to semantic roles:
 *
 *   neutral  — default; plan-free, generic status
 *   emerald  — positive: pass verdict, plan-pro, plan-team, connected
 *   amber    — review_recommended, trialing, "worth a look"
 *   red      — violation, past_due, error
 *   stone    — muted; "no value", placeholder, disabled
 *   blue     — info; rarely used; only when emerald is taken
 *
 * Tone (uppercase or sentence-case) is the caller's choice — pass
 * the text however you want it. The rest of the visual treatment is
 * fixed.
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
    "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-900/50 dark:text-stone-300",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  amber:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  red:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300",
  stone:
    "border-stone-200 bg-white text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400",
  blue:
    "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
};

// Two sizes — sm is the default (text-xs); xs is for the dense-diagram
// case where the surrounding type is text-[10px]. Adding more sizes
// invites drift; if a third size starts to feel necessary, it's
// usually a sign that the surrounding layout wants attention instead.
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
