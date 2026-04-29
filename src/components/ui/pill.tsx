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

const toneClasses: Record<PillTone, string> = {
  neutral:
    "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-900/50 dark:text-stone-300",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  amber:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  red:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  stone:
    "border-stone-200 bg-white text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400",
  blue:
    "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
};

const baseClasses =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium";

export function pillStyles(tone: PillTone = "neutral", className = ""): string {
  return [baseClasses, toneClasses[tone], className].filter(Boolean).join(" ");
}

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={pillStyles(tone, className)}>{children}</span>;
}
