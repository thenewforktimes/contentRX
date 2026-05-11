/**
 * Divider — semantic horizontal rule using the design-token border.
 *
 * Replaces the 50+ inline `border-t border-stone-200 dark:border-stone-800`
 * patterns. Renders as `<hr>` by default (correct semantics for a
 * thematic break between sections). When you want a non-semantic
 * visual divider inside a layout (e.g., separating items in a list
 * row), pass `decorative` to render a span with role="separator"
 * aria-hidden — visual only, screen readers skip it.
 *
 * 2026-05-10 weight variant:
 *   <Divider weight="strong" />
 * Uses `border-line-strong` (2x the visual weight of `border-line`)
 * for major section breaks where the thin default reads as noise.
 * Ditto / Linear / Vercel use heavy section bars as architectural
 * punctuation — this gives us the same affordance via an existing
 * token, no new colors introduced.
 */

type DividerWeight = "default" | "strong";

const weightClasses: Record<DividerWeight, string> = {
  default: "border-t border-line",
  strong: "border-t-2 border-line-strong",
};

export function Divider({
  decorative = false,
  weight = "default",
  className = "",
}: {
  decorative?: boolean;
  /** Visual weight. `default` is the thin divider used inside list
   * rows and section bodies; `strong` is the heavy bar for major
   * section breaks (above an <AuthorBlock>, between the comparison-
   * table header and rows, etc.). */
  weight?: DividerWeight;
  className?: string;
}) {
  const lineClasses = [weightClasses[weight], className]
    .filter(Boolean)
    .join(" ");
  if (decorative) {
    return (
      <span role="separator" aria-hidden className={lineClasses} />
    );
  }
  return <hr className={lineClasses} />;
}
