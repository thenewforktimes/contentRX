/**
 * /privacy — public privacy policy.
 *
 * Plain English first; legal scaffolding is the minimum needed for
 * GDPR/CCPA. The voice matches the rest of the public surface — direct,
 * specific, no boilerplate phrases like "your privacy is important
 * to us." If something matters less than the words around it, it
 * doesn't need to be here.
 *
 * Voice note for Robert: this is a starter draft. Have a lawyer review
 * before paid customers land — especially the data-rights section
 * and the subprocessor list (which must match exactly what you've
 * actually contracted with).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Section } from "@/components/ui/section";

const EFFECTIVE_DATE = "April 27, 2026";
const PRIVACY_EMAIL = "privacy@contentrx.io";

export const metadata: Metadata = {
  title: "Privacy. ContentRX",
  description:
    "What ContentRX collects, how it's used, who else sees it, and how to delete or export it. Plain language; legal precision where it matters.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <header className="mb-12">
        <Eyebrow>Privacy</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold">Privacy policy</h1>
        <p className="mt-3 text-sm text-quiet">
          Effective <time>{EFFECTIVE_DATE}</time>. Material changes get
          a new effective date and a note in the changelog.
        </p>
        <p className="mt-4 text-lg text-default">
          ContentRX is a content-design review tool. To do that job,
          we have to receive the strings you check, run them through
          our evaluation engine (which uses Anthropic&apos;s Claude
          models), and store enough of a record to bill you and to
          show you your own history. This page lays out exactly what
          flows where, who else sees it, and how to make us forget you.
        </p>
      </header>

      <Section title="What we collect">
        <p>Three buckets:</p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>Account data.</strong> When you sign up, our
            authentication provider (Clerk) handles your email,
            password, and session. If you upgrade to a paid plan, our
            billing provider (Stripe) handles your card details. We
            never see your password and we never store your card
            number.
          </li>
          <li>
            <strong>Content you submit for review.</strong> Every
            string passed to <code>/api/check</code>,{" "}
            <code>/api/classify</code>, or <code>/api/suggest-fix</code>{" "}
            is forwarded to the evaluation engine and to Anthropic. In
            our own database we store only a sha256 hash of the text,
            never the plaintext. We do retain metadata: the verdict,
            severity, content type, file path (if your tool supplied
            one), and the surface that called us (MCP, LSP, CLI,
            GitHub Action, Figma plugin, web).
          </li>
          <li>
            <strong>Usage and operational telemetry.</strong> Counts
            of checks per month (for billing), API token usage (for
            cost accounting), error reports captured by Sentry,
            anonymous page-view metrics from Plausible (which is
            cookieless and doesn&apos;t track across sites), and rate-
            limit counters in Upstash Redis.
          </li>
        </ul>
        <p className="mt-3">
          We do <strong>not</strong> collect: your IP address beyond
          what&apos;s needed for short-window rate limiting, advertising
          identifiers, third-party tracking pixels, or keystroke-level
          behavior in the editor extensions.
        </p>
      </Section>

      <Section title="What we do with it">
        <p>
          Account and billing data: to keep your account working and
          send you the receipts you&apos;d expect.
        </p>
        <p className="mt-3">
          Content strings: to run the evaluation, return verdicts,
          and (where you&apos;ve given a Team-plan opt-in) inform our
          calibration log so the model gets better. The hash we store
          lets us look up your history and aggregate dashboard
          insights without keeping the raw text.
        </p>
        <p className="mt-3">
          Telemetry: to fix bugs (Sentry), bill correctly (token
          counts), enforce rate limits (Redis), and understand which
          public pages people read (Plausible). None of these
          subprocessors receive content strings.
        </p>
        <p className="mt-3">
          We do not sell your data. We do not use your content to
          train any model, ours or anyone else&apos;s. The Team-plan
          opt-in (off by default; explicit per-entry toggle on{" "}
          <code>custom_example_add</code>) is the only path by which a
          customer string ever influences our calibration corpus, and
          even then it&apos;s anonymised at ingest.
        </p>
      </Section>

      <Section title="What we won&apos;t do, in plain language">
        <p>
          Subscription is the entire revenue model. We don&apos;t make
          money any other way; the things below are the lines we
          won&apos;t cross to make up the difference.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>We don&apos;t sell your strings.</strong> Hashed,
            anonymised, or otherwise. No data-broker contract, no
            advertiser arrangement.
          </li>
          <li>
            <strong>We don&apos;t repackage your check history into
            a profile</strong> of you, your team, or your industry
            that gets marketed against you.
          </li>
          <li>
            <strong>We don&apos;t use your content to train any
            model</strong> (ours, Anthropic&apos;s, anyone&apos;s)
            without your explicit, per-entry opt-in.
          </li>
          <li>
            <strong>We don&apos;t share your strings with any third
            party</strong> beyond the subprocessors named below.
          </li>
          <li>
            <strong>We don&apos;t run engagement-modelling
            telemetry</strong> on how you use ContentRX. We track
            check counts (because billing) and crash reports
            (because bugs). Nothing else.
          </li>
        </ul>
        <p className="mt-4">
          And the engineering layer behind that: every public route
          that takes a string runs a pre-screen that refuses obvious
          credentials and PII (credit card numbers, SSNs, AWS / Stripe
          / OpenAI / GitHub keys) before they can reach Anthropic, our
          error logs, or anyone&apos;s eyes. Sentry events have
          request bodies and auth headers stripped before send. The
          long-form version of this commitment, with the rationale
          and the &ldquo;what changes if we ever change our mind&rdquo;
          path, is at{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          {" "}(commitment 6).
        </p>
      </Section>

      <Section title="Who else sees it (subprocessors)">
        <p>
          Running ContentRX requires partners. Each one sees only the
          data it needs for the job we&apos;re paying it to do.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-quiet">
              <th className="py-2 pr-4">Subprocessor</th>
              <th className="py-2 pr-4">Purpose</th>
              <th className="py-2">Data they see</th>
            </tr>
          </thead>
          <tbody className="text-default">
            <SubprocessorRow
              name="Anthropic"
              purpose="LLM evaluation"
              data="The text strings you submit for review."
            />
            <SubprocessorRow
              name="Stripe"
              purpose="Payments"
              data="Your billing email, card details, subscription history."
            />
            <SubprocessorRow
              name="Clerk"
              purpose="Authentication"
              data="Your account email, password (hashed by Clerk), session tokens."
            />
            <SubprocessorRow
              name="Supabase"
              purpose="Database hosting"
              data="Account metadata, hashed text, verdicts, usage counts."
            />
            <SubprocessorRow
              name="Vercel"
              purpose="Application hosting"
              data="HTTP requests in transit; nothing persisted by them."
            />
            <SubprocessorRow
              name="Resend"
              purpose="Transactional email"
              data="Your email address and the message body we send to you."
            />
            <SubprocessorRow
              name="Sentry"
              purpose="Error tracking"
              data="Stack traces and request metadata when something crashes."
            />
            <SubprocessorRow
              name="Plausible"
              purpose="Analytics"
              data="Anonymous page-view counts. No cookies, no cross-site tracking."
            />
            <SubprocessorRow
              name="Upstash"
              purpose="Rate limiting + dedupe"
              data="Short-lived counters keyed by your user id."
            />
            <SubprocessorRow
              name="Figma"
              purpose="Plugin distribution"
              data="Whatever Figma collects when you install the plugin. See Figma's own privacy policy."
            />
          </tbody>
        </table>
        <p className="mt-4">
          We&apos;ll update this list within 30 days of any change. If a
          new subprocessor would meaningfully change what data we
          share, we&apos;ll post about it in advance.
        </p>
      </Section>

      <Section title="Where the data lives">
        <p>
          Our application data lives in US-region Supabase Postgres.
          Anthropic processes content in its own infrastructure.
          Vercel runs functions in regions close to your users.
        </p>
        <p className="mt-3">
          <strong>Anthropic retention, current state:</strong>{" "}
          Anthropic retains API inputs for up to 30 days under their
          standard policy. We&apos;re negotiating a zero-data-retention
          agreement that would limit retention to the request
          lifecycle. Once that&apos;s in place, this section will
          reflect it. If your compliance program needs ZDR before then,
          email <code>{PRIVACY_EMAIL}</code> and we&apos;ll tell you
          the timeline directly.
        </p>
        <p className="mt-3">
          If you have a regulatory requirement for EU-region data
          residency, email <code>{PRIVACY_EMAIL}</code> before signing
          up. We&apos;ll be straight with you about whether we can
          meet it today.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          While your account is active, we keep the data described
          above for as long as it&apos;s useful to you and to us.
          What happens when you stop being a customer depends on
          which kind of customer you were.
        </p>
        <p className="mt-3">
          <strong>If you&apos;re on a paid plan and you cancel:</strong>{" "}
          your account stays intact for 90 days so you can reactivate
          without losing your team setup. After that grace period we
          run a one-time pseudonymization pass:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>Deleted.</strong> Your team rules, custom
            examples, team-member records, and outstanding team
            invitations. These are the configuration you and your
            team built up over time; once you&apos;ve been gone for 90
            days they&apos;re removed entirely.
          </li>
          <li>
            <strong>Anonymized, not deleted.</strong> Historical
            violation hashes and override records have their{" "}
            <code>user_id</code> set to null. The hashed text and the
            verdicts stay in our database (they fed engine
            calibration during your time as a customer), but the link
            back to you is severed.
          </li>
          <li>
            <strong>Cleared.</strong> Email, API key, and Stripe
            customer ID on your <code>users</code> row are replaced
            with sentinels. The row stays so foreign-key references
            in the anonymized history remain valid.
          </li>
        </ul>
        <p className="mt-3">
          <strong>If you&apos;re on the free plan</strong>, no
          cancellation event ever fires, so the automated 90-day
          pass doesn&apos;t apply. Your account sits idle until you
          explicitly delete it (see &ldquo;Your rights&rdquo; below).
          We may eventually add an inactivity-based cleanup; if we
          do, the policy will say so before it runs.
        </p>
        <p className="mt-3">
          <strong>If you delete on demand</strong>, the same
          pseudonymization runs immediately rather than after 90 days.
          A few records have legally required retention periods
          (Stripe receipts at 7 years for tax purposes and fraud-
          prevention logs), and we&apos;ll tell you specifically which
          when you ask.
        </p>
      </Section>

      <Section title="Your rights">
        <p>If you&apos;re a customer or end-user, you can:</p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>See what we have on you.</strong> Email{" "}
            <code>{PRIVACY_EMAIL}</code> and we&apos;ll send back a
            machine-readable export within 30 days.
          </li>
          <li>
            <strong>Correct it.</strong> Most fields are editable from
            the dashboard. For anything that isn&apos;t, ask us.
          </li>
          <li>
            <strong>Delete it.</strong> Email{" "}
            <code>{PRIVACY_EMAIL}</code> with the subject{" "}
            <code>[DELETE]</code>. We&apos;ll confirm receipt within 2
            business days and complete the deletion within 30. Some
            records (Stripe receipts, fraud-prevention logs) may have
            longer legally required retention; we&apos;ll tell you
            specifically which.
          </li>
          <li>
            <strong>Export it.</strong> Same address; subject line{" "}
            <code>[EXPORT]</code>.
          </li>
          <li>
            <strong>Opt out of calibration contributions.</strong>{" "}
            Already off by default. Verify on the{" "}
            <Link href="/dashboard" className="underline underline-offset-2">
              dashboard
            </Link>{" "}
            or via the MCP <code>custom_example_*</code> tools.
          </li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p>
          The only cookie we set ourselves is the Clerk authentication
          session: strictly necessary, expires when you sign out.
          Plausible is cookieless. We don&apos;t use third-party
          analytics, ad networks, or tracking pixels. If you&apos;re
          seeing a cookie banner request from a regulator, the
          honest answer is &ldquo;we don&apos;t need one, but tell us
          and we&apos;ll add it.&rdquo;
        </p>
      </Section>

      <Section title="Children">
        <p>
          ContentRX is a B2B tool. We don&apos;t target it at, or
          knowingly accept accounts from, anyone under 16. If a parent
          or guardian believes their child has signed up, email{" "}
          <code>{PRIVACY_EMAIL}</code> and we&apos;ll delete the
          account.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          When the policy materially changes, the effective date at
          the top moves and existing customers get an email summary
          of what shifted. Trivial cleanups (typos, link updates) ship
          without a date change.
        </p>
      </Section>

      <Section title="Questions">
        <p>
          Email <code>{PRIVACY_EMAIL}</code>. The same address handles
          GDPR/CCPA requests, DPA inquiries, and subprocessor-list
          questions. For security-specific reports, the{" "}
          <Link href="/security" className="underline underline-offset-2">
            security disclosure policy
          </Link>{" "}
          is the right channel.
        </p>
      </Section>
    </main>
  );
}

function SubprocessorRow({
  name,
  purpose,
  data,
}: {
  name: string;
  purpose: string;
  data: string;
}) {
  return (
    <tr className="border-b border-stone-100 align-top dark:border-stone-900">
      <td className="py-3 pr-4 font-medium text-strong">
        {name}
      </td>
      <td className="py-3 pr-4 text-xs">{purpose}</td>
      <td className="py-3 text-xs">{data}</td>
    </tr>
  );
}
