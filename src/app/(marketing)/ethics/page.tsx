/**
 * /ethics — ContentRX's three load-bearing commitments.
 *
 * 2026-05-11 rewrite per Robo's audit:
 *   - Drop "I" framing across the page in favor of the brand voice
 *     ("ContentRX does not [...]"). The page makes a brand-level
 *     position. First-person presupposed the reader cared who Robert
 *     was, doesn't scale past the first hire, and weakens the
 *     declarative pattern.
 *   - Drop "Sources I have rights to use" (Commitment 4). The section
 *     was the weakest on the page (rewritten three times in two days,
 *     repeatedly trimmed, currently 2 sentences and saying nothing
 *     concrete). Buyers reading /ethics want "what happens to MY
 *     stuff," not "where did your model learn from." Fair use covers
 *     the engine inputs and there's no legal disclosure requirement.
 *   - Tighten Privacy + Security to remove voice-rule violations
 *     (a colon in Privacy, a semicolon in Security).
 *   - Rewrite Customer-not-product bullets to the user's declarative
 *     pattern ("ContentRX does not sell your strings. ContentRX does
 *     not repackage [...]"). Drops the "I won't cross these lines"
 *     framing.
 *
 * Three commitments:
 *   1. Privacy
 *   2. Security
 *   3. Customer, not product
 *
 * Voice: short declarative sentences, no em dashes, no semicolons,
 * no colons. Brand voice (ContentRX as subject), not first-person.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Ethics. ContentRX",
  description:
    "How ContentRX handles your work. Three commitments. Privacy. Security. Customer, not product.",
};

export default function EthicsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="Ethics"
        title="How ContentRX handles your work"
        lede={
          <p className="text-sm text-quiet">
            Three commitments hold the rest of the product together.
            They&apos;re short on purpose. The deep policy lives at{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              /privacy
            </Link>{" "}
            and{" "}
            <Link href="/security" className="underline underline-offset-2">
              /security
            </Link>
            . This page is the position those policies sit under.
          </p>
        }
      />

      <Section
        number="1"
        title="Privacy"
        summary="Your text is reviewed, returned, and gone. The hash is what ContentRX keeps."
      >
        <p>
          Send a check to ContentRX. The engine evaluates it. The
          verdict comes back. The plaintext doesn&apos;t persist.
          ContentRX retains a sha256 hash, the verdict, the severity,
          the content type, and the surface that called. That&apos;s
          the entire list. ContentRX cannot reconstruct your writing
          from what&apos;s kept.
        </p>
        <p className="mt-3">
          A pre-screen on every public route refuses obvious
          credentials and PII. Credit card numbers. SSNs. Stripe,
          OpenAI, Anthropic, and GitHub keys. AWS access keys. None
          reach the engine, Anthropic, or the error logs. Sentry
          events have request bodies and auth headers stripped before
          send.
        </p>
        <p className="mt-3">
          The full policy, including the subprocessor list, lives at{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          .
        </p>
      </Section>

      <Section
        number="2"
        title="Security"
        summary="Standard SaaS hygiene, audit-ready posture."
      >
        <p>
          TLS in transit. Credentials hashed at rest. Audit logs on
          admin-tier surfaces. The trust boundary is the web app, the
          engine, and the subprocessors listed on{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          . Everything outside is the public internet.
        </p>
        <p className="mt-3">
          SOC 2 Type II is in progress. Until then,{" "}
          <Link href="/security" className="underline underline-offset-2">
            /security
          </Link>
          {" "}publishes what ContentRX does today and answers
          specific posture questions in writing. Found a
          vulnerability? The same page has the coordinated-disclosure
          path.
        </p>
      </Section>

      <Section
        number="3"
        title="Customer, not product"
        summary="ContentRX makes money by charging for a tool. Not by selling, repackaging, or modeling the work you check."
      >
        <p>
          ContentRX makes money from subscriptions. Free exists so
          you can try the product. Paid tiers exist because the
          engine costs real money to run and calibration takes real
          time. There&apos;s no second shoe to drop.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            ContentRX does not sell your checks. Not hashed. Not
            anonymised. Not to data brokers, advertisers, or anyone
            else. There is no third-party broker contract. There
            will not be one.
          </li>
          <li>
            ContentRX does not repackage your check history into a
            profile of you, your team, or your industry. Your
            dashboard shows your activity to you. No aggregate
            intent-signal product gets sold on top.
          </li>
          <li>
            ContentRX does not train a model on your content. Yours,
            ours, Anthropic&apos;s, anyone&apos;s. A customer check
            joins the calibration corpus only when you share it via
            Flag for Review. One path. One consent modal per check.
            Available to every paying customer. Revoke any time from
            the dashboard. The checks you have shared live at{" "}
            <Link
              href="/dashboard/shared"
              className="underline underline-offset-2"
            >
              /dashboard/shared
            </Link>
            .
          </li>
          <li>
            ContentRX does not run an engagement-metrics or
            behavioural-modelling layer on how you use the product.
            ContentRX tracks monthly check counts (because billing)
            and crash reports (because bugs). Nothing else.
          </li>
        </ul>
        <p className="mt-3">
          If any of this ever changes, ContentRX publishes a
          superseding ADR before any new collection starts. Existing
          customers are notified by email. The version of this
          commitment that&apos;s live is always the one at /ethics.
          If there&apos;s no superseding ADR linked from this page,
          the rules above are the rules.
        </p>
      </Section>

      <footer className="mt-16 text-xs text-quiet">
        <p>
          Last updated 2026-05-11. Source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/src/app/(marketing)/ethics/page.tsx"
            className="underline underline-offset-2"
          >
            GitHub
          </a>
          .
        </p>
      </footer>
    </main>
  );
}

function Section({
  number,
  title,
  summary,
  children,
}: {
  number: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-line pt-8 scroll-mt-16 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
        Commitment {number}
      </p>
      <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm italic text-quiet">{summary}</p>
      <div className="mt-4 text-sm text-default">{children}</div>
    </section>
  );
}
