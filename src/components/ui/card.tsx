/**
 * Card — codifies the two card treatments the codebase already uses
 * implicitly:
 *
 *   - default:  raised surface + default border. Most cards.
 *   - emphasis: overlay surface + strong border. Callout / opt-out
 *     boxes that should sit visually one level above default cards.
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

export type CardVariant = "default" | "emphasis";
export type CardPadding = "sm" | "md" | "lg";

const variantClasses: Record<CardVariant, string> = {
  default: "border-line bg-raised",
  emphasis: "border-line-strong bg-overlay",
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
      className={`rounded-lg border ${variantClasses[variant]} ${paddingClasses[padding]} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
