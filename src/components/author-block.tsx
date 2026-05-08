/**
 * AuthorBlock — the "named author" trust signal that competitors
 * can't easily replicate.
 *
 * ContentRX has a single human attached to it: Robert Ballard, staff
 * content designer. That's a moat against Vercel-grade AI tools that
 * are studiously anonymous in their marketing. The author block
 * surfaces this fact without theatre: a small monogram, a one-line
 * credential, and a thin career-arc timeline. Reads like an editorial
 * byline, not a "team page."
 *
 * No portrait by design — the brand isn't trading on Robert's face,
 * it's trading on the verifiable career arc. The monogram is the
 * stand-in: cheap to render, distinctive in tone, doesn't fabricate.
 *
 * The timeline uses the same accent color as the wordmark to tie
 * the author block visually to the brand mark in the hero. One
 * accent color, used three times across the hero block (wordmark,
 * primary CTA, timeline arc) — that's the chromatic discipline.
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
            <Link href="/about" className="underline underline-offset-2 hover:text-default">
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
  // "RB" inside a soft-bordered square. Same visual posture as a
  // serif-publication author byline — the kind newspapers use when
  // they don't have a headshot. Matches the wordmark's geometric
  // approach (text inside a shape, accent-colored).
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
  // Horizontal arc — companies as nodes, separated by a thin
  // dash. The current role gets a filled accent dot; prior roles
  // get a hollow circle. Reads as a worked-in timeline without
  // dragging in a date column the customer doesn't need to read.
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
