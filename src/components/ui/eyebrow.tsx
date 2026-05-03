/**
 * Eyebrow — small uppercase mono label that sits above an H1 or H2.
 *
 * The single most-repeated text pattern on the public surface
 * (~15+ inlined uses pre-extraction). Promotes the
 * `text-xs font-mono uppercase tracking-widest text-quiet`
 * recipe to a first-class component so future pages don't re-derive
 * it (and the eventual color/spacing tweak is a one-place change).
 *
 * Uses `text-quiet` (≥7:1 AAA Normal contrast in both modes) — readable
 * but visually subordinate to the H1/H2 it labels.
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
      className={`text-xs font-mono uppercase tracking-widest text-quiet ${className}`.trim()}
    >
      {children}
    </p>
  );
}
