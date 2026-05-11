/**
 * Card — codifies the three card treatments the codebase uses:
 *
 *   - default:  raised surface + default border. Most cards.
 *   - emphasis: overlay surface + strong border. Callout / opt-out
 *               boxes that should sit visually one level above
 *               default cards.
 *   - accent:   double-weight border in the affirm accent + a soft
 *               tinted background + drop shadow (light mode) so the
 *               recommended tier physically lifts above the siblings.
 *               The Ditto-style "this is the choice" treatment. Used
 *               on the landing's "One approval" card and the Pro
 *               tier on /pricing. Reserve for one card per grid —
 *               two accents in the same grid kills the emphasis.
 *
 *               Note on dark mode: drop shadows on dark canvases are
 *               nearly invisible. The accent border + tinted bg
 *               carry the hierarchy on dark; the shadow is a light-
 *               mode bonus that doesn't have to render to do its job.
 *
 * Backed by the design tokens in `src/app/globals.css` so cards
 * automatically follow the canonical dark-mode treatment without
 * each caller re-deriving stone-{50, 200, 800, 950} pairs.
 *
 * Use `padding="md"` (default) or `padding="lg"` to match the
 * existing `p-5` vs `p-6` patterns. Pass `className` for one-off
 * spacing overrides.
 */

import type { ReactNode } from "react";

export type CardVariant = "default" | "emphasis" | "accent";
export type CardPadding = "sm" | "md" | "lg";

const variantClasses: Record<CardVariant, string> = {
  default: "border border-line bg-raised",
  emphasis: "border border-line-strong bg-overlay",
  accent:
    "border-2 border-accent-affirm-border bg-accent-affirm-soft/30 shadow-xl",
};

const paddingClasses: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  variant = "default",
  padding = "md",
  className = "",
  children,
}: {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg ${variantClasses[variant]} ${paddingClasses[padding]} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
