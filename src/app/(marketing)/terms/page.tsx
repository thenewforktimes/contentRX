/**
 * /terms — ContentRX Terms of Service.
 *
 * Phase A stub (2026-05-11): structural skeleton with placeholder copy.
 * Phase B replaces each section body with the attorney-approved final
 * text after Robo's legal review this week.
 *
 * Single-page strategy: this page absorbs everything that other SaaS
 * sites split across /aup, /refunds, /cookies, /dpa, /subprocessors.
 * Cookie + subprocessor content lives on /privacy; the rest folds in
 * here. Footer surfaces only Terms + Privacy under Legal (the Ditto
 * pattern).
 *
 * Voice (when copy arrives): short declarative sentences, no em
 * dashes, no semicolons, no colons in body sentences. Brand voice
 * (ContentRX as subject), not first-person. Matches /ethics + /privacy.
 *
 * Open questions tracked in the plan file
 * (~/.claude/plans/some-of-what-we-parallel-island.md):
 *   1. DBA disclosure exact wording
 *   2. Flag-for-Review carve-out final text (must mirror to
 *      flag-for-review modal + /dashboard/shared)
 *   3. AI output disclaimer placement (inline vs ToS-only)
 *   4. Refund policy specifics (pro-rata, grace period?)
 *   5. Pre-renewal reminder cadence (monthly cycles?)
 *   6. Governing law / venue (CA default)
 *   7. Stripe statement descriptor + footer copy alignment
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Terms of Service. ContentRX",
  description:
    "How ContentRX works as a paid service. Subscription terms, acceptable use, AI output disclaimers, and the Flag-for-Review opt-in carve-out.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="Terms of Service"
        title="How ContentRX works as a paid service"
        lede={
          <p className="text-sm text-quiet">
            These terms govern your use of ContentRX. The privacy
            commitments live at{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              /privacy
            </Link>
            . The position those policies sit under lives at{" "}
            <Link href="/ethics" className="underline underline-offset-2">
              /ethics
            </Link>
            . This page is the contract.
          </p>
        }
        meta={
          <>
            Effective date pending. Last updated pending. This page
            is a structural stub. Final attorney-reviewed text
            arrives later this week.
          </>
        }
      />

      <Section number="1" title="Subscription Agreement">
        <p>
          Placeholder. Attorney text: commercial terms (plan + price +
          interval + seats), term + termination, payment, refund
          posture, automatic renewal, the Stripe Customer Portal as
          the cancellation path.
        </p>
      </Section>

      <Section number="2" title="Acceptable Use">
        <p>
          Placeholder. Attorney text: prohibited uses, no model
          extraction or use of outputs to train competitive AI
          services, no scraping, no abuse, suspension and termination
          rights.
        </p>
      </Section>

      <Section number="3" title="AI output disclaimers + ownership">
        <p>
          Placeholder. Attorney text: you own your inputs and the
          review outputs ContentRX generates for them. ContentRX owns
          the Service, the engine, and the taxonomy. Outputs are
          provided AS IS. The Service is not legal, regulatory,
          accessibility-compliance, or professional advice. You are
          responsible for human review before relying on any output.
        </p>
      </Section>

      <Section number="4" title="Flag for Review opt-in">
        <p>
          Placeholder. Attorney text will land here. The most
          ContentRX-specific clause. Your checks join the calibration
          corpus only when you affirmatively flag them via the Flag
          for Review feature. One flag per check, with a consent
          modal naming what gets stored. Revoke any time. Final
          wording mirrors across the consent modal, this section,
          and the /dashboard/shared page.
        </p>
      </Section>

      <Section number="5" title="No training on your content">
        <p>
          Placeholder. Attorney text will land here. ContentRX does
          not use your checks to train, fine-tune, or otherwise
          develop our or any third party&apos;s machine learning
          models. The only exception is the per-check opt-in via
          Flag for Review described in Section 4.
        </p>
      </Section>

      <Section number="6" title="Refunds and cancellation">
        <p>
          Placeholder. Attorney text: cancel anytime via the Stripe
          Customer Portal. Access continues through the end of your
          paid period. No prorated refunds. Industry-standard for
          SaaS at this price point. Stripe-compliant.
        </p>
      </Section>

      <Section number="7" title="Warranty disclaimer + liability cap">
        <p>
          Placeholder. Attorney text: AS-IS warranty disclaimer,
          consequential-damages exclusion, liability cap at fees paid
          in prior 12 months.
        </p>
      </Section>

      <Section number="8" title="Privacy and subprocessors">
        <p>
          The privacy commitments live at{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          . That page covers what ContentRX collects, what gets
          retained, and which subprocessors receive customer data.
          The subprocessor change-notice policy is published there
          as well. This page does not duplicate that content.
        </p>
      </Section>

      <Section number="9" title="Changes to these terms">
        <p>
          Placeholder. Attorney text: how ContentRX notifies of
          material changes (email + dashboard banner), notice
          window, continued use as acceptance.
        </p>
      </Section>

      <Section number="10" title="Governing law and venue">
        <p>
          Placeholder. Attorney text: governing law (default
          California pending attorney call) and venue.
        </p>
      </Section>

      <Section number="11" title="About this service">
        <p>
          Placeholder. ContentRX is operated by Abstract Nonsense LLC
          (DBA disclosure wording pending attorney confirmation).
          Contact:{" "}
          <a
            href="mailto:hello@contentrx.io"
            className="underline underline-offset-2"
          >
            hello@contentrx.io
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-line pt-8 scroll-mt-16 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
        Section {number}
      </p>
      <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      <div className="mt-4 text-sm text-default">{children}</div>
    </section>
  );
}
