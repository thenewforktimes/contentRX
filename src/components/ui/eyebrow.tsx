/**
 * Eyebrow — small uppercase mono label that sits above an H1 or H2.
 *
 * The single most-repeated text pattern on the public surface
 * (~15+ inlined uses pre-extraction). Promotes the
 * `text-xs font-mono uppercase tracking-widest text-stone-500`
 * recipe to a first-class component so future pages don't re-derive
 * it (and the eventual color/spacing tweak is a one-place change).
 */

import type { ReactNode } from "react";

export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400 ${className}`.trim()}
    >
      {children}
    </p>
  );
}
