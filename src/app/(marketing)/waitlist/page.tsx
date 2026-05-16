/**
 * /waitlist — landing page for visitors outside ContentRX's allowed
 * regions.
 *
 * The middleware redirects unauthenticated visitors from blocked
 * regions here. The redirect carries a ?region= query param holding
 * the country code (and subdivision code for Canada) so the page can
 * personalise the message.
 *
 * Always-allowed by the middleware. Reachable from any region without
 * authentication.
 *
 * Voice: ContentRX-third-person, no em dashes, no semicolons, no
 * colons in body. Matches /privacy + /terms + /ethics.
 *
 * Scope sketch:
 *   - Currently allowed: United States + U.S. territories + Canadian
 *     provinces other than Quebec.
 *   - Quebec is blocked specifically because Quebec Law 25 has
 *     operational requirements ContentRX has not built coverage for.
 *   - EU / EEA / UK are blocked until an Article 27 representative is
 *     appointed.
 *   - Other regions are blocked by default and open as ContentRX
 *     builds out compliance coverage.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { WaitlistForm } from "./form";

export const metadata: Metadata = {
  title: "Waitlist. ContentRX",
  description:
    "ContentRX is currently available to customers in the United States, U.S. territories, and Canadian provinces other than Quebec. Drop your email to be notified when access opens in your region.",
  // The waitlist page is meant to be reached via geo-block redirect,
  // not surfaced in search. Indexable=false reduces accidental
  // discovery (visitors should hit the marketing site first and only
  // see /waitlist if the geo-block fires).
  robots: { index: false, follow: false },
};

const COUNTRY_NAMES_FALLBACK: Record<string, string> = {
  GB: "the United Kingdom",
  US: "the United States",
};

function humanizeRegion(regionTag: string): string {
  if (!regionTag) return "";

  const [country, subdivision] = regionTag.split("-");
  if (!country) return "";

  // Quebec is the most common blocked region for Canadian traffic and
  // deserves an explicit, non-abbreviated rendering.
  if (country === "CA" && subdivision === "QC") {
    return "Quebec, Canada";
  }

  // Use Intl.DisplayNames where available for a proper country name.
  // Falls back to a hand-curated short list and then the raw code.
  let countryName = COUNTRY_NAMES_FALLBACK[country] ?? country;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    const resolved = dn.of(country);
    if (resolved) countryName = resolved;
  } catch {
    // Older Node runtimes might not have Intl.DisplayNames. Fall back
    // to the hand-curated mapping. Not worth bailing out for.
  }

  return subdivision ? `${subdivision}, ${countryName}` : countryName;
}

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const regionRaw = params.region;
  const regionTag = typeof regionRaw === "string" ? regionRaw : "";
  const regionDisplay = humanizeRegion(regionTag);

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="Waitlist"
        title="ContentRX is opening regions in stages"
        lede={
          <>
            ContentRX is currently available to customers in the United
            States, U.S. territories, and Canadian provinces other than
            Quebec.{" "}
            {regionDisplay ? (
              <>
                It looks like you are visiting from{" "}
                <strong>{regionDisplay}</strong>. Drop your email below
                and ContentRX will tell you when access opens there.
              </>
            ) : (
              <>
                If you found this page, you are visiting from a region
                that has not opened yet. Drop your email below and
                ContentRX will tell you when access opens in your
                region.
              </>
            )}
          </>
        }
        meta={
          <>
            Curious about why a given region is blocked? The reasoning
            lives at{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2"
            >
              /privacy
            </Link>
            {" "}under &ldquo;Regional availability.&rdquo;
          </>
        }
      />

      <WaitlistForm initialRegion={regionTag} />

      <section className="mt-16 border-t border-line pt-8 text-sm text-default">
        <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
          What ContentRX does
        </p>
        <p className="mt-2">
          ContentRX is the opinionated editor for the prose that
          lives in your codebase. It reviews error messages, READMEs,
          API docs, and PR and commit copy against one editorial
          standard. The public credibility surface is{" "}
          <Link
            href="/accuracy"
            className="underline underline-offset-2"
          >
            /accuracy
          </Link>
          . The position behind the privacy commitments is at{" "}
          <Link
            href="/ethics"
            className="underline underline-offset-2"
          >
            /ethics
          </Link>
          .
        </p>
        <p className="mt-3">
          If you are an existing ContentRX customer who happens to be
          travelling and got redirected here by mistake, sign in at{" "}
          <Link
            href="/sign-in"
            className="underline underline-offset-2"
          >
            /sign-in
          </Link>
          . An authenticated session bypasses the regional
          availability check.
        </p>
      </section>
    </main>
  );
}
