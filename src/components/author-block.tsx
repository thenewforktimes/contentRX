/**
 * AuthorBlock — the named-author byline used on /about and /accuracy.
 *
 * Pre-2026-05-11 this had two render modes (compact + card); the
 * compact variant lived on the landing page. The landing dropped
 * the byline 2026-05-11 (the 6-cell quadrant grid carries the page
 * now), leaving only the card variant in active use on /about
 * (where the byline IS the section) and /accuracy (the methodology
 * binds tightly to the named author). The compact path was removed.
 *
 * No portrait by design — the brand isn't trading on Robert's face,
 * it's trading on the verifiable career arc and the public
 * accountability surfaces (/accuracy, /calibration, /ethics) the
 * model holds itself to.
 *
 * Career-arc data lives in CAREER_ARC; the page test pins the four
 * orgs (Intuit, Meta, Opendoor, PayPal).
 */

import Link from "next/link";

const CAREER_ARC: readonly { name: string; current?: boolean }[] = [
  { name: "Intuit" },
  { name: "Meta" },
  { name: "Opendoor" },
  { name: "PayPal", current: true },
] as const;

export function AuthorBlock() {
  return (
    <aside className="rounded-2xl border border-line bg-raised p-6 sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
        <Monogram />
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
            Built by
          </p>
          <p className="mt-1 text-lg font-semibold text-strong">
            Robert Ballard
          </p>
          <p className="mt-1 text-sm text-default">
            Staff content designer. The context, the weights, and the
            standards all carry a single designer&apos;s judgment
            calls, attributed and published.
          </p>
          <Timeline arc={CAREER_ARC} />
          <p className="mt-4 text-xs text-quiet">
            Read the longer story on the{" "}
            <Link
              href="/about"
              className="underline underline-offset-2 hover:text-default"
            >
              about-the-model
            </Link>{" "}
            page.
          </p>
        </div>
      </div>
    </aside>
  );
}

function Monogram() {
  return (
    <div
      aria-hidden
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-accent-affirm-border bg-accent-affirm-soft text-accent-affirm-text"
    >
      <span className="text-xl font-bold tracking-tight">RB</span>
    </div>
  );
}

function Timeline({
  arc,
}: {
  arc: readonly { name: string; current?: boolean }[];
}) {
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {arc.map((stop, i) => (
        <li key={stop.name} className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span
              className={
                stop.current
                  ? "h-2 w-2 rounded-full bg-accent-affirm-text"
                  : "h-2 w-2 rounded-full border border-accent-affirm-border"
              }
              aria-hidden
            />
            <span
              className={
                stop.current
                  ? "font-semibold text-strong"
                  : "text-default"
              }
            >
              {stop.name}
            </span>
            {stop.current && (
              <span className="text-xs text-quiet">(today)</span>
            )}
          </span>
          {i < arc.length - 1 && (
            <span aria-hidden className="text-quiet">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
