/**
 * Card — codifies the two card treatments the codebase already uses
 * implicitly:
 *
 *   - default: white bg + neutral-200 border. Most cards.
 *   - emphasis: neutral-50 bg + neutral-300 border. Callout / opt-out
 *     boxes that should sit visually one level above default cards.
 *
 * Use `padding="md"` (default) or `padding="lg"` to match the
 * existing `p-5` vs `p-6` patterns. Pass `className` for one-off
 * spacing overrides.
 */

import type { ReactNode } from "react";

export type CardVariant = "default" | "emphasis";
export type CardPadding = "sm" | "md" | "lg";

const variantClasses: Record<CardVariant, string> = {
  default:
    "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950",
  emphasis:
    "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900",
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
