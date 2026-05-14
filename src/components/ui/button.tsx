/**
 * Button + buttonStyles — five variants, two sizes, with proper
 * focus-visible rings.
 *
 * Backed by the design tokens defined in `src/app/globals.css`. Filled
 * variants use the inverse pattern (dark text on bright accent bg) in
 * dark mode and the standard pattern (white text on darker accent bg)
 * in light mode — both verified against WCAG 2.1 AAA Large (≥4.5:1)
 * for ≥14px semibold text. Outlined variants (secondary, warning,
 * danger) use accent-soft backgrounds with accent-text foregrounds
 * (≥7:1 AAA Normal).
 *
 * Use `<Button>` for actual `<button>` elements. For Next.js `<Link>`
 * styled like a button, pass `buttonStyles({...})` to `className` —
 * keeps anchor semantics while sharing visual treatment.
 *
 * 2026-05-10 arrow affordance:
 *   <Button arrow>Continue</Button>
 *   <Link className={buttonStyles({ variant: "primary" })}>
 *     Continue <ButtonArrow />
 *   </Link>
 * Renders a trailing `→` that slides 2px right on parent hover (the
 * kinetic affordance Ditto / Linear / Vercel CTAs land on). The
 * `group` class is always in baseClasses, so `<ButtonArrow />` works
 * inside ANY Button or buttonStyles-wrapped Link without ceremony.
 * `aria-hidden` on the arrow keeps screen readers focused on the
 * label text.
 *
 * 2026-05-14 hover-state pass: the filled and soft-outlined variants
 * previously hovered via `opacity-90`. On a bright accent bg sitting on
 * a dark canvas, opacity blends the canvas into the button — producing
 * a ~1.3:1 perceived state change. Invisible as an affordance. Replaced
 * with explicit `bg-accent-{name}-hover` / `bg-accent-{name}-soft-hover`
 * tokens (defined in globals.css). Each hover value is AAA-verified
 * against its on-solid / accent-text text colour.
 *
 *   Dark mode (inverse pattern: bright bg, dark text):
 *     hover LIGHTENS — feels "lit up", text contrast climbs.
 *   Light mode (standard pattern: dark bg, white text):
 *     hover DARKENS — feels "pressed", text contrast climbs.
 *   Light mode (inverse pattern: affirm + caution):
 *     hover LIGHTENS — preserves the dark-on-bright contrast that
 *     would otherwise crater if we went darker.
 *
 * Opacity-based hover is now reserved for the disabled state only,
 * where the contrast loss is the desired signal.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "warning"
  | "danger";

export type ButtonSize = "sm" | "md";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-primary text-accent-primary-on hover:bg-accent-primary-hover",
  secondary:
    "border border-line bg-raised text-default hover:bg-overlay",
  ghost:
    "text-quiet hover:text-strong",
  warning:
    "border border-accent-caution-border bg-accent-caution-soft text-accent-caution-text hover:bg-accent-caution-soft-hover",
  danger:
    "border border-accent-concern-border bg-accent-concern-soft text-accent-concern-text hover:bg-accent-concern-soft-hover",
};

// Sizes now carry an explicit `min-h-[…]` so every button meets WCAG
// 2.5.5 / 2.5.8 touch-target thresholds. `sm` clears the AA 24×24
// floor at 36px; `md` clears the AAA 44×44 floor. Without these,
// `text-xs`/`text-sm` + small padding produced ~24px and ~30px tall
// buttons — fine visually, painful for motor-impaired users on mobile.
const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-[36px] px-3 py-1.5 text-xs",
  md: "min-h-[44px] px-4 py-2 text-sm",
};

// `group` is part of the baseline so `<ButtonArrow />` inside any
// Button (or buttonStyles-wrapped Link) picks up the parent hover
// state without callers needing to add the class themselves.
const baseClasses =
  "group inline-flex items-center justify-center gap-2 rounded-md font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50";

export function buttonStyles(
  opts: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
  } = {},
): string {
  const { variant = "primary", size = "md", className = "" } = opts;
  return [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Trailing `→` affordance that slides 2px right on parent hover.
 * Drop it inside any Button or buttonStyles-wrapped Link to opt into
 * the kinetic CTA treatment. Pure decoration — `aria-hidden` so
 * screen readers stay focused on the label.
 *
 * Usage:
 *   <Button arrow>Continue</Button>          // auto-rendered
 *   <Link ...><span>Continue</span><ButtonArrow /></Link>
 *
 * The animation prefers `motion-safe` — users with
 * `prefers-reduced-motion: reduce` see the arrow but it doesn't
 * translate on hover, matching the WCAG 2.3.3 recommendation.
 */
export function ButtonArrow() {
  return (
    <span
      aria-hidden="true"
      className="inline-block motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
    >
      →
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, append a trailing `→` that slides on hover. The
   *  kinetic CTA treatment lifted from Ditto / Linear / Vercel.
   *  Defaults to false so existing callers stay unchanged. */
  arrow?: boolean;
  children?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  arrow = false,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      {children}
      {arrow && <ButtonArrow />}
    </button>
  );
}
