/**
 * Section — eyebrow + heading + body, with the canonical separator
 * border-top spacing pattern. Used as the structural rhythm on
 * landing, install, and about pages.
 *
 * The first section in a stack drops its top border (`first:` reset)
 * so the page header doesn't get a redundant rule above the first
 * H2 block.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "./eyebrow";

export function Section({
  eyebrow,
  title,
  id,
  children,
}: {
  eyebrow?: string;
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="mt-16 border-t border-neutral-200 pt-10 first:border-t-0 first:pt-0 scroll-mt-16 dark:border-neutral-800"
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className={`${eyebrow ? "mt-2 " : ""}text-2xl font-semibold`}>
        {title}
      </h2>
      <div className="mt-4 text-base text-neutral-700 dark:text-neutral-300">
        {children}
      </div>
    </section>
  );
}
