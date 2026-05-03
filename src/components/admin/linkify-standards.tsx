/**
 * LinkifyStandards — render free-form text with standard IDs turned
 * into Links to the per-standard mission-control page.
 *
 * Substrate standard IDs follow the pattern `[A-Z]{2,4}-\d{1,3}` (e.g.
 * `CLR-01`, `VT-04`, `ACT-12`). Founder-authored copy in the refinement
 * log routinely names rules in the triggering case / architectural
 * consequence / verdict text — those mentions should be navigable to
 * the standard's mission-control panel without forcing the founder to
 * copy/paste into a URL.
 *
 * The component takes a Set of valid standardIds (passed in by the
 * page after loading the substrate library) and only renders matches
 * that EXIST. Spurious matches that look like an ID but aren't (an
 * acronym, a part number) render as plain text — never as a dead
 * link. The substrate library is the authority.
 *
 * Tokens-only styling, no inline className soup.
 */

import Link from "next/link";

const STANDARD_ID_PATTERN = /\b([A-Z]{2,4}-\d{1,3})\b/g;

export function LinkifyStandards({
  text,
  validIds,
}: {
  text: string;
  validIds: ReadonlySet<string>;
}) {
  // Capture-group split: parts alternate between non-match and match.
  // Even indices are surrounding text, odd indices are candidate IDs.
  const parts = text.split(STANDARD_ID_PATTERN);
  return (
    <>
      {parts.map((part, i) => {
        const isCandidateMatch = i % 2 === 1;
        if (isCandidateMatch && validIds.has(part)) {
          return (
            <Link
              key={i}
              href={`/admin/model/standards/${part}`}
              className="font-mono text-accent-info-text underline underline-offset-2 hover:text-strong"
            >
              {part}
            </Link>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
