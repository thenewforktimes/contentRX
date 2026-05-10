/**
 * TrustStrip — inline horizontal link row that closes the lower fold.
 *
 * 2026-05-10 lower-fold rebuild. Replaces the prior 3-card
 * "Privacy / Security / Integrations" row that used to sit under
 * the Built-for-stack section. Those three trust pages plus
 * /accuracy now live as four arrow-links on a single line, with no
 * card chrome. Different silhouette from the surrounding quadrant
 * cells; reads as a single editorial pause before the author
 * byline.
 *
 * Each link is a small arrow-led anchor that funnels to its
 * dedicated page. The labels match the destination page short
 * names so the reader's eye walks across in a clean register.
 */

import Link from "next/link";

const LINKS: readonly { label: string; href: string }[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Security", href: "/security" },
  { label: "Install", href: "/install" },
  { label: "Accuracy", href: "/accuracy" },
] as const;

export function TrustStrip() {
  return (
    <nav
      aria-label="Trust signals"
      className="mt-12 border-t border-line pt-6"
    >
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        {LINKS.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="inline-flex items-center gap-1 text-default underline underline-offset-2 hover:text-strong"
            >
              {l.label} →
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
