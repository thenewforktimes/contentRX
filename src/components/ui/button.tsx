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
    "bg-accent-primary text-accent-primary-on hover:opacity-90",
  secondary:
    "border border-line bg-raised text-default hover:bg-overlay",
  ghost:
    "text-quiet hover:text-strong",
  warning:
    "border border-accent-caution-border bg-accent-caution-soft text-accent-caution-text hover:opacity-90",
  danger:
    "border border-accent-concern-border bg-accent-concern-soft text-accent-concern-text hover:opacity-90",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
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
