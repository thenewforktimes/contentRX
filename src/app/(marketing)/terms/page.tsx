/**
 * /terms — ContentRX Terms of Service.
 *
 * 2026-05-12: Phase B copy lands. The 11 placeholder sections from
 * the 2026-05-11 skeleton are replaced with hand-written content
 * derived from Common Paper Cloud Service Agreement v2.1 (CC BY 4.0)
 * adapted to the ContentRX voice and to the four ContentRX-specific
 * positions that the generic SaaS template does not cover.
 *
 * The four ContentRX-specific positions are:
 *   1. Flag for Review opt-in carve-out (Section 4). The only path
 *      by which Customer Content influences calibration. Per-item,
 *      per-event consent. Twelve-month post-Subscription retention.
 *      Revocation via /dashboard/shared or privacy@contentrx.io.
 *      ("Customer Content" is the capitalised defined term in this
 *      contract. The product-side voice uses "writing" or "content"
 *      and never the developer-API word "string". See the
 *      [checks-not-strings] lint rule for the gate.)
 *   2. No training default (Section 5). Customer Content is not
 *      used to train any model. Plaintext is held only for the
 *      request lifecycle. The sha256 hash plus metadata persists.
 *      The ZDR status of the Anthropic account is tracked honestly
 *      (in progress, not yet confirmed) so the page does not
 *      overclaim.
 *   3. AI inaccuracy disclaimer (Section 3). The Service is not a
 *      substitute for human review, and Output that touches on
 *      regulated subject matter is the output of an AI model, not
 *      the opinion of a licensed professional.
 *   4. Customer ownership of inputs and outputs (Section 3).
 *      ContentRX retains the Service, engine, taxonomy, prompts,
 *      fine-tunes, and aggregated de-identified usage statistics.
 *      Customers retain no rights in those.
 *
 * Single-page strategy: this page absorbs everything that other SaaS
 * sites split across /aup, /refunds, /cookies, /dpa, /subprocessors.
 * Cookie and subprocessor content lives on /privacy. DPA is offered
 * as a downloadable PDF at /legal/dpa.pdf (Common Paper-based
 * starter template, requires legal review for material reliance).
 * Footer surfaces only Terms + Privacy + Disclaimer under Legal.
 *
 * Voice: ContentRX-third-person (not "we"), short declarative
 * sentences, no em dashes, no semicolons in body prose. Legal
 * structure (numbered lists in Sections 2 and 4, the AS-IS warranty
 * disclaimer in Section 7) accepts the unavoidable comma-heavy
 * clause structure that legal precision requires.
 *
 * Outstanding work before paid customers land:
 *   - Attorney review focused on (a) AI clauses in Sections 3 and 5,
 *     (b) IP allocation in Section 3, (c) Flag-for-Review carve-out
 *     in Section 4, (d) entity disclosure in Section 11.
 *   - ContentRX LLC formation in California (replaces the old
 *     "Abstract Nonsense LLC dba ContentRX" plan per 2026-05-12
 *     direction). Section 11 already says "ContentRX LLC" so the
 *     entity formation must precede first paid customer.
 *   - Confirm zero-data-retention status with Anthropic and update
 *     Section 5 paragraph 3 accordingly.
 *   - DPA artifact at /legal/dpa.pdf is a starter template adapted
 *     from Common Paper. Attorney review of the DPA before the
 *     first enterprise customer signs is part of the same lawyer
 *     hour that reviews the AI clauses, IP allocation, and Flag for
 *     Review carve-out.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

const EFFECTIVE_DATE = "May 12, 2026";
const PRIVACY_EMAIL = "privacy@contentrx.io";
const SUPPORT_EMAIL = "hello@contentrx.io";

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
          <>
            These Terms govern your use of ContentRX. The privacy
            commitments live at{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              /privacy
            </Link>
            . The position those policies sit under lives at{" "}
            <Link href="/ethics" className="underline underline-offset-2">
              /ethics
            </Link>
            . This page is the contract.
          </>
        }
        meta={
          <>
            Effective <time>{EFFECTIVE_DATE}</time>. Material changes
            get a new effective date, an email notice at least thirty
            days in advance, and a note in the changelog.
          </>
        }
      />

      <Section number="1" title="Subscription Agreement">
        <p>
          ContentRX is a paid subscription service. When you sign up
          for a paid plan through the dashboard, the plan you choose,
          the price you see, the billing interval, and the seat count
          are the commercial terms of your Subscription. Stripe is
          the payment processor of record. Stripe charges your card
          on each renewal date until you cancel.
        </p>
        <p className="mt-3">
          Your Subscription Term runs from the date of your first
          successful charge to the end of the paid period that charge
          covers. A monthly Subscription renews each month. An annual
          Subscription renews each year. Cancellation stops the next
          renewal. Access continues through the end of the current
          paid period.
        </p>
        <p className="mt-3">
          ContentRX may revise pricing for future renewal periods by
          giving you at least thirty (30) days notice via email and
          in the dashboard. Revised pricing takes effect at your next
          renewal. You can cancel before that renewal if you do not
          accept the revised pricing.
        </p>
      </Section>

      <Section number="2" title="Acceptable Use">
        <p>
          The Service is yours to use for the purpose of reviewing
          your own product writing against the ContentRX evaluation
          engine. The activities listed below are not permitted.
          ContentRX may suspend or terminate accounts that engage in
          them.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            Reverse engineering, decompiling, or attempting to extract
            the model weights, system prompts, or taxonomy that drive
            the evaluation engine.
          </li>
          <li>
            Using ContentRX outputs to train, fine-tune, develop, or
            evaluate any machine learning model that competes with the
            Service.
          </li>
          <li>
            Scraping, rate-circumventing, or automating requests
            outside the documented API surface.
          </li>
          <li>
            Submitting content you do not have the right to submit.
            You represent that content you send to the Service does
            not infringe a third party&apos;s intellectual property
            rights and does not include personal data of any
            individual without that individual&apos;s consent.
          </li>
          <li>
            Submitting content designed to elicit illegal output. This
            includes instructions for violence, self-harm, child
            sexual abuse material, and content that violates the laws
            of your jurisdiction.
          </li>
          <li>
            Using the Service to harass, defame, or harm any
            individual or organisation.
          </li>
          <li>
            Resale, sublicensing, or white-labelling the Service
            without a separate written agreement with ContentRX.
          </li>
        </ul>
        <p className="mt-3">
          ContentRX may suspend access without notice when a security
          or abuse incident requires it. ContentRX restores access
          once the incident is resolved or terminates the account if
          the abuse continues.
        </p>
      </Section>

      <Section number="3" title="AI output disclaimers and ownership">
        <p>
          The Service generates review feedback using artificial
          intelligence and machine learning models. Information
          generated by the Service may be incorrect, incomplete, or
          inappropriate for any specific use. The Service is not a
          substitute for human review. You are responsible for human
          review of any Service Output before relying on it.
        </p>
        <p className="mt-3">
          ContentRX does not provide legal, regulatory,
          accessibility-compliance, or professional advice. Output
          that touches on accessibility (WCAG), plain-language
          compliance, GDPR or CCPA microcopy, refund or cancellation
          language, or any other regulated subject matter is the
          output of an AI model, not the opinion of a licensed
          professional. You should consult appropriate counsel before
          relying on the Service for any regulated content.
        </p>
        <p className="mt-3">
          <strong>Ownership.</strong> You own the content you submit
          (Customer Content) and the review feedback ContentRX
          generates for it (Service Output). You can use Service
          Output however you want, including modifying it, publishing
          it, or feeding it into your own systems.
          ContentRX owns the Service itself, the evaluation engine,
          the taxonomy, the prompts, the model fine-tunes, and the
          aggregated, de-identified usage statistics ContentRX uses
          to measure and improve the Service. You retain no rights in
          those.
        </p>
      </Section>

      <Section number="4" title="Flag for Review opt-in">
        <p>
          The Service includes an optional Flag for Review feature.
          When you affirmatively flag a specific piece of Customer
          Content through the in-product consent flow, you grant
          ContentRX a non-exclusive, worldwide, royalty-free license
          to do the following with that flagged content and the
          associated Service Output.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            Include them in ContentRX&apos;s internal evaluation
            corpus.
          </li>
          <li>
            Use them to calibrate the ContentRX review taxonomy and
            model prompts.
          </li>
          <li>
            Retain them for the duration of your Subscription plus
            twelve (12) months.
          </li>
        </ul>
        <p className="mt-3">
          Flagging is per-item and per-event. Flagging one piece of
          Customer Content does not authorise use of any other
          Customer Content. You represent that flagged content does
          not contain personal data of any individual without that
          individual&apos;s consent and does not contain confidential
          information of any third party.
        </p>
        <p className="mt-3">
          You may revoke flag consent for any individual flagged
          item at any time. The revocation paths are{" "}
          <Link
            href="/dashboard/shared"
            className="underline underline-offset-2"
          >
            /dashboard/shared
          </Link>
          {" "}for self-service or{" "}
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            className="underline underline-offset-2"
          >
            {PRIVACY_EMAIL}
          </a>
          {" "}for assisted removal. ContentRX will use commercially
          reasonable efforts to remove the flagged content from
          active use within thirty (30) days. Aggregated,
          de-identified evaluation results derived prior to revocation
          will persist.
        </p>
        <p className="mt-3">
          The Flag for Review feature is the only mechanism by which
          Customer Content influences the calibration of the Service.
          Customer Content submitted to the Service that is not
          flagged is not retained in plaintext past the request
          lifecycle. See Section 5.
        </p>
      </Section>

      <Section number="5" title="No training on your content">
        <p>
          ContentRX does not use Customer Content to train,
          fine-tune, or otherwise develop ContentRX&apos;s own or any
          third party&apos;s machine learning or artificial
          intelligence models. The only exception is the per-item
          opt-in via Flag for Review described in Section 4.
        </p>
        <p className="mt-3">
          When Customer Content is submitted to the Service through
          any ContentRX endpoint (including /api/check, /api/classify,
          and /api/suggest-fix), the plaintext is held only for the
          duration of the request and is then discarded from
          ContentRX&apos;s systems. The sha256 hash of the submission
          and the associated metadata (verdict, severity, content
          type, calling surface) persist for billing, history, and
          audit. The plaintext does not.
        </p>
        <p className="mt-3">
          The plaintext of every submission of Customer Content is
          transmitted to Anthropic for the duration of the evaluation
          call. Anthropic
          processes the call under the terms of its API service
          agreement with ContentRX. Anthropic&apos;s standard policy
          retains API logs for a short window (currently thirty days)
          for abuse monitoring. ContentRX is in the process of
          confirming zero-data-retention status at the account level.
          The status of that work is recorded at{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          {" "}under &ldquo;Where the data lives&rdquo; and will be
          updated as the work concludes.
        </p>
        <p className="mt-3">
          If you observe behaviour that contradicts this commitment,
          email{" "}
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            className="underline underline-offset-2"
          >
            {PRIVACY_EMAIL}
          </a>
          . ContentRX investigates every such report.
        </p>
      </Section>

      <Section number="6" title="Refunds and cancellation">
        <p>
          You may cancel your Subscription at any time through the
          Stripe Customer Portal at{" "}
          <Link
            href="/dashboard/settings"
            className="underline underline-offset-2"
          >
            /dashboard/settings
          </Link>
          . Cancellation stops the next renewal. Your access continues
          through the end of the current paid period.
        </p>
        <p className="mt-3">
          ContentRX does not issue prorated refunds for cancellations
          made before the end of a paid period. The fee already paid
          covers the access already received. If ContentRX terminates
          your account for material breach of these Terms, you are
          not entitled to a refund of fees already paid.
        </p>
        <p className="mt-3">
          If ContentRX terminates your account for any reason other
          than your breach (a discontinuation of the Service, for
          example), ContentRX refunds the prorated portion of any
          prepaid annual Subscription fee covering the unused portion
          of the Term. Monthly Subscriptions are not eligible for
          prorated refunds.
        </p>
        <p className="mt-3">
          ContentRX sends a renewal reminder email at least fifteen
          (15) days before each automatic renewal date, as required
          by California&apos;s Automatic Renewal Law. The reminder
          names the renewal date, the amount that will be charged,
          and the cancellation path. You can opt out of marketing
          emails. You cannot opt out of the renewal reminder.
        </p>
      </Section>

      <Section number="7" title="Warranty disclaimer and liability cap">
        <p>
          The Service is provided AS IS and AS AVAILABLE. To the
          maximum extent permitted by law, ContentRX disclaims all
          warranties, express or implied, including the warranties of
          merchantability, fitness for a particular purpose,
          non-infringement, and accuracy of any Service Output.
          ContentRX does not warrant that the Service will be
          uninterrupted, error-free, or free of harmful components.
        </p>
        <p className="mt-3">
          To the maximum extent permitted by law, ContentRX&apos;s
          total liability arising from or relating to your use of the
          Service is capped at the fees you paid ContentRX in the
          twelve (12) months immediately preceding the event giving
          rise to the claim. ContentRX is not liable for any indirect,
          incidental, special, consequential, exemplary, or punitive
          damages, including lost profits, lost data, or loss of
          goodwill, even if ContentRX has been advised of the
          possibility of such damages.
        </p>
        <p className="mt-3">
          Some jurisdictions do not allow the disclaimer or
          limitation of certain warranties or damages. In those
          jurisdictions, the disclaimers and limitations above apply
          to the maximum extent permitted by applicable law.
        </p>
      </Section>

      <Section number="8" title="Privacy and subprocessors">
        <p>
          The privacy commitments live at{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          . That page covers what ContentRX collects, what gets
          retained, which subprocessors receive customer data, and
          the rights you have over the data. The subprocessor
          change-notice policy is published there as well. ContentRX
          does not duplicate that content here.
        </p>
        <p className="mt-3">
          For customers who require a signed Data Processing
          Addendum, ContentRX provides a Common Paper-based DPA at{" "}
          <a
            href="/legal/dpa.pdf"
            className="underline underline-offset-2"
          >
            /legal/dpa.pdf
          </a>
          . The DPA incorporates these Terms by reference. Email{" "}
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            className="underline underline-offset-2"
          >
            {PRIVACY_EMAIL}
          </a>
          {" "}with subject <code>[DPA-COUNTERSIGN]</code> to receive
          a counter-signed copy on ContentRX letterhead.
        </p>
      </Section>

      <Section number="9" title="Changes to these Terms">
        <p>
          ContentRX may revise these Terms from time to time. When
          ContentRX makes a material change, the new effective date
          is recorded at the top of this page and notice is sent to
          the email address associated with your account at least
          thirty (30) days before the change takes effect. The notice
          names the sections that changed.
        </p>
        <p className="mt-3">
          Trivial cleanups (typo fixes, link updates, formatting
          adjustments) ship without notice or a date change.
        </p>
        <p className="mt-3">
          Your continued use of the Service after the effective date
          of a material change constitutes acceptance of the revised
          Terms. If you do not accept the revised Terms, cancel your
          Subscription before the effective date and your access
          continues through the end of your current paid period.
        </p>
      </Section>

      <Section number="10" title="Governing law and venue">
        <p>
          These Terms are governed by the laws of the State of
          California, without regard to conflict-of-laws principles.
          Any dispute arising from or relating to these Terms or the
          Service is subject to the exclusive jurisdiction of the
          state and federal courts located in Sacramento County,
          California. You and ContentRX consent to that jurisdiction.
        </p>
        <p className="mt-3">
          Nothing in this section prevents either party from seeking
          injunctive relief for actual or threatened infringement of
          intellectual property, breach of confidentiality, or
          violation of the Acceptable Use Policy in any court of
          competent jurisdiction.
        </p>
      </Section>

      <Section number="11" title="About this service">
        <p>
          ContentRX is a service of ContentRX LLC, a California
          limited liability company. The mailing address for legal
          notices is:
        </p>
        <address className="mt-3 not-italic text-default">
          ContentRX LLC
          <br />
          2520 Venture Oaks Way, Suite 120
          <br />
          Sacramento, CA 95833
          <br />
          United States
        </address>
        <p className="mt-3">
          For privacy and data rights, email{" "}
          <a
            href={`mailto:${PRIVACY_EMAIL}`}
            className="underline underline-offset-2"
          >
            {PRIVACY_EMAIL}
          </a>
          . For general support, customer service, billing questions,
          or anything else not covered by another address on this
          page or at{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          , email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="underline underline-offset-2"
          >
            {SUPPORT_EMAIL}
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
