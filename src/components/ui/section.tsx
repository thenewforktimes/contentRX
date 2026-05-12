/**
 * Section — eyebrow + heading + body, with the canonical separator
 * border-top spacing pattern. Used as the structural rhythm on
 * landing, install, and about pages.
 *
 * The first section in a stack drops its top border (`first:` reset)
 * so the page header doesn't get a redundant rule above the first
 * H2 block.
 *
 * Uses design tokens (`border-line`, `text-default`) so dark/light
 * mode parity is automatic — no `dark:` variants needed inline.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "./eyebrow";

export function Section({
  eyebrow,
  title,
  id,
  pill,
  children,
}: {
  eyebrow?: string;
  title: string;
  id?: string;
  /** Optional inline Pill that sits next to the H2. Used for
   * status callouts like "Coming soon" (e.g., /install's GitHub
   * Action and Figma plugin sections in 2026-05-11). */
  pill?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="mt-16 border-t border-line pt-10 first:border-t-0 first:pt-0 scroll-mt-16"
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <div
        className={`${eyebrow ? "mt-2 " : ""}flex flex-wrap items-center gap-3`}
      >
        {/* Marketing h2 scales up at sm+ — the Ditto-influenced
            heavier-headlines pattern. Matches the in-line h2s on the
            landing's How-it-works and Outcomes sections so every h2
            inside a <Section> wrapper reads the same. App-internal
            headings use the <Heading> primitive instead, which stays
            flat across breakpoints. */}
        <h2 className="text-2xl font-semibold text-strong sm:text-3xl">{title}</h2>
        {pill}
      </div>
      <div className="mt-4 text-base text-default">
        {children}
      </div>
    </section>
  );
}
