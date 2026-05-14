/**
 * /disclaimer — public legal disclaimer page.
 *
 * Two topics covered, both Termageddon-managed based on the
 * questionnaire YES answers:
 *   1. Not-legal-advice disclaimer. Defensive coverage because
 *      ContentRX reviews customer copy that touches compliance-
 *      adjacent topics (refund language, accessibility statements,
 *      privacy-policy microcopy, etc.) and a customer could plausibly
 *      read marketing copy as legal guidance. This disclaimer makes
 *      the position explicit.
 *   2. Testimonials disclaimer. Results-may-vary boilerplate. On by
 *      default for future-proofing against any customer quote, case
 *      study, or social-proof element ContentRX adds later.
 *
 * This is the one legal page where ContentRX accepts generic legal
 * voice in exchange for the auto-update value. The /privacy and
 * /terms pages are hand-crafted in voice. The disclaimer is short
 * enough and low-stakes enough that the trade-off makes sense.
 *
 * Rendering mechanics (rewritten 2026-05-14): SSR-fetch the policy
 * HTML from Termageddon's API at request time, cached via Next.js
 * ISR for one hour, sanitize, and render into the page on first
 * byte. The previous implementation used Termageddon's client-side
 * <Script> embed which took ~20 s to paint in production and left
 * a static "Loading the disclaimer..." string on the page for the
 * full duration — read as broken by visitors. The SSR approach
 * keeps Termageddon's auto-update value while eliminating the
 * client-side load gap entirely. See `src/lib/disclaimer.server.ts`
 * for fetch + sanitize details.
 *
 * Fallback: if the Termageddon fetch fails or returns unparseable
 * HTML, the page renders a graceful "view canonical version" link
 * to the Termageddon-hosted policy. Same failure-mode surface the
 * old embed had, just never the first-paint state.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getDisclaimerContent } from "@/lib/disclaimer.server";

export const metadata: Metadata = {
  title: "Disclaimer. ContentRX",
  description:
    "Two short positions ContentRX takes on what this website is and isn't. Auto-updated by the policy provider when underlying legal language shifts.",
};

export default async function DisclaimerPage() {
  const content = await getDisclaimerContent();

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="Disclaimer"
        title="Disclaimer"
        lede={
          <>
            Two short positions ContentRX takes on what this website
            is and isn&apos;t. The text below is auto-updated by the
            policy provider when the underlying legal language shifts.
            The hand-written privacy and terms pages are at{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2"
            >
              /privacy
            </Link>
            {" "}and{" "}
            <Link
              href="/terms"
              className="underline underline-offset-2"
            >
              /terms
            </Link>
            .
          </>
        }
      />

      {content ? (
        // The Termageddon-sourced HTML is sanitized server-side via
        // src/lib/disclaimer.server.ts before reaching this point. The
        // wrapper's arbitrary-variant Tailwind classes give the
        // injected markup typography that matches the site without
        // having to inject className strings into the upstream HTML.
        <article
          className={[
            "mt-10 text-default",
            "[&_h1]:hidden", // duplicate of PageHeader title
            "[&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-strong",
            "[&_h2]:first:mt-2",
            "[&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-strong",
            "[&_p]:mt-4 [&_p]:leading-relaxed",
            "[&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-strong",
            "[&_ul]:mt-4 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2",
            "[&_ol]:mt-4 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2",
            "[&_strong]:text-strong [&_strong]:font-semibold",
            "[&_em]:italic",
          ].join(" ")}
          // sanitize-html allowlist + transformTags in
          // disclaimer.server.ts strips scripts, styles, event
          // handlers, and any tag/attribute we haven't pre-approved.
          // Safe to inject.
          dangerouslySetInnerHTML={{ __html: content.html }}
        />
      ) : (
        <div className="mt-10 rounded-md border border-line p-4 text-default">
          <p className="text-quiet">
            The disclaimer didn&apos;t load this time.{" "}
            <a
              rel="nofollow noopener noreferrer"
              href={FALLBACK_CANONICAL_URL}
              target="_blank"
              className="underline underline-offset-2 hover:text-strong"
            >
              View the canonical version
            </a>
            , or refresh in a minute. ContentRX caches the policy and
            re-fetches every hour, so a transient failure clears on
            the next refresh.
          </p>
        </div>
      )}
    </main>
  );
}

// Same canonical URL the helper builds; inlined here so the fallback
// branch doesn't depend on the helper's success path. If the policy
// id moves, both this constant and the one in
// `src/lib/disclaimer.server.ts` need to change together.
const FALLBACK_CANONICAL_URL =
  "https://policies.termageddon.com/api/policy/VVhseFZHZEVla3B6VEhwMVQzYzlQUT09";
