/**
 * Input / Textarea / Select — token-based form primitives.
 *
 * Replaces the ~30 inline `border border-stone-300 bg-white ...
 * dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 focus:...`
 * patterns scattered across the dashboard. Every form across the app
 * gets the same border, focus ring, and disabled treatment from one
 * place.
 *
 * Each primitive is a thin wrapper around its native element so all
 * standard HTML attributes (name, value, onChange, required, pattern,
 * etc.) flow through unchanged. The only thing the primitive owns is
 * the visual treatment.
 *
 * Focus ring uses --ring-focus (amber-400 in dark, amber-700 in light)
 * — both pass WCAG 1.4.11 (3:1 vs adjacent) verified in #308.
 */

import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const inputBase =
  "w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-strong placeholder:text-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[inputBase, className].filter(Boolean).join(" ")}
    />
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={[inputBase, "leading-relaxed", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[inputBase, className].filter(Boolean).join(" ")}
    >
      {children}
    </select>
  );
}
