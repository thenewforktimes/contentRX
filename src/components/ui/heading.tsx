/**
 * Heading — locked type ramp for h1–h4.
 *
 * The codebase used to have ~50 inline `text-{size} font-semibold
 * text-stone-900 dark:text-stone-100` headings with three different
 * size choices for what should have been an H1, two for what should
 * have been an H2, etc. This primitive locks the ramp:
 *
 *   level 1 — page title (text-3xl)
 *   level 2 — major section (text-2xl)
 *   level 3 — subsection (text-lg)
 *   level 4 — small group label (text-sm uppercase tracking)
 *
 * The component renders the matching semantic element (h1/h2/h3/h4)
 * AND applies the matching visual style. They're locked together so a
 * heading can't accidentally render as h2 with h1 styling.
 *
 * For a label-style "section header above a card group" use level 4
 * (small caps); for an editorial "section title above body copy" use
 * level 2; for "page title" use level 1.
 *
 * Eyebrow (the mono uppercase pre-heading) lives in `eyebrow.tsx`
 * because it's structurally above the heading, not a heading itself.
 */

import type { ReactNode } from "react";

export type HeadingLevel = 1 | 2 | 3 | 4;

// Sizes calibrated to the patterns the codebase actually used pre-
// primitive (audited 2026-05-03). The previous draft jumped to
// text-3xl for level 1, which would have made every dashboard panel
// header bigger than the existing convention. Marketing hero
// headings that genuinely want text-3xl can pass className to override.
const levelClasses: Record<HeadingLevel, string> = {
  1: "text-2xl font-semibold tracking-tight text-strong",
  2: "text-xl font-semibold text-strong",
  3: "text-lg font-semibold text-strong",
  4: "text-sm font-semibold uppercase tracking-wide text-quiet",
};

export function Heading({
  level,
  id,
  className = "",
  children,
}: {
  level: HeadingLevel;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
  return (
    <Tag
      id={id}
      className={[levelClasses[level], className].filter(Boolean).join(" ")}
    >
      {children}
    </Tag>
  );
}
