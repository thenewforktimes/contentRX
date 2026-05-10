/**
 * AuthorBlock — the "named author" trust signal.
 *
 * ContentRX has a single human attached to it: Robert Ballard, staff
 * content designer. That's a secondary trust signal against
 * studiously-anonymous AI tools, but not the lead pitch — the load-
 * bearing value props (time, cost, consistency, long-form) carry the
 * page. The block sits at the foot of the landing as an editorial
 * byline, not a hero card.
 *
 * Renders in two modes:
 *
 *   - default ("compact"): a single editorial line at the page foot.
 *     Name + role + career arc inline. No monogram, no aside. The
 *     2026-05-10 default. Used by the landing page.
 *
 *   - "card": the older 2-col card with the RB monogram, name, role,
 *     and full timeline. Reserved for surfaces where the byline is
 *     the section (about-page, etc.) — not a competitor with
 *     value-prop copy elsewhere on the page.
 *
 * Career-arc data lives in CAREER_ARC; the page test pins the four
 * orgs (Intuit, Meta, Opendoor, PayPal) so a future re-order or rename
 * has to keep that set intact.
 *
 * No portrait by design — the brand isn't trading on Robert's face,
 * it's trading on the verifiable career arc and the public
 * accountability surfaces (/accuracy, /calibration, /ethics) the
 * model holds itself to.
 */

import Link from "next/link";

const CAREER_ARC: readonly { name: string; current?: boolean }[] = [
  { name: "Intuit" },
  { name: "Meta" },
  { name: "Opendoor" },
  { name: "PayPal", current: true },
] as const;

export function AuthorBlock({
  variant = "compact",
}: {
  variant?: "compact" | "card";
} = {}) {
  if (variant === "card") {
    return <CardVariant />;
  }
  return <CompactVariant />;
}

/**
 * CompactVariant — single editorial line, page-foot treatment.
 *
 * The visual register matches a newspaper byline: small bold name,
 * thin role line, career arc rendered inline as the small-caps
 * lineage that signals "this person has done this work in
 * recognizable rooms" without staking the brand on the face.
 */
function CompactVariant() {
  return (
    <aside className="border-t border-line pt-8 text-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
        Built by
      </p>
      <p className="mt-1 text-base font-semibold text-strong">
        Robert Ballard, staff content designer.
      </p>
      <p className="mt-1 text-default">
        The context, the weights, and the standards all carry one
        designer&apos;s judgment calls, attributed and published.
      </p>
      <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-quiet">
        {CAREER_ARC.map((stop, i) => (
          <li key={stop.name} className="flex items-center gap-2">
            <span
              className={
                stop.current
                  ? "font-semibold text-strong"
                  : "text-default"
              }
            >
              {stop.name}
              {stop.current && (
                <span className="ml-1 text-quiet">(today)</span>
              )}
            </span>
            {i < CAREER_ARC.length - 1 && (
              <span aria-hidden>·</span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-quiet">
        Read the longer story on the{" "}
        <Link
          href="/about"
          className="underline underline-offset-2 hover:text-default"
        >
          about-the-model
        </Link>{" "}
        page.
      </p>
    </aside>
  );
}

/**
 * CardVariant — the prior block, kept for callers (about-page) that
 * want the bigger byline. Same monogram + 2-col layout that landed
 * 2026-05-06.
 */
function CardVariant() {
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
