/**
 * Button + buttonStyles — five variants, two sizes, with proper
 * focus-visible rings.
 *
 * Pre-extraction the codebase had ~5 distinct button styles inlined
 * across pages with no central definition (per the design critique).
 * This file is the single source.
 *
 * Use `<Button>` for actual `<button>` elements. For Next.js `<Link>`
 * styled like a button, pass `buttonStyles({...})` to `className` —
 * keeps anchor semantics while sharing visual treatment.
 */

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "warning"
  | "danger";

export type ButtonSize = "sm" | "md";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black",
  secondary:
    "border border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900",
  ghost:
    "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-50",
  warning:
    "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger:
    "border border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50";

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

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, className })}
      {...props}
    />
  );
}
