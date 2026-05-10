/**
 * /privacy — public privacy policy.
 *
 * Plain language first. Legal scaffolding is the minimum needed for
 * GDPR/CCPA. Voice matches /ethics and /about: ContentRX-third-person,
 * no em dashes, no semicolons, no colons in body sentences, no
 * boilerplate phrases like "your privacy is important to us."
 *
 * Voice note for Robert: this is a starter draft. Have a lawyer review
 * before paid customers land. The sections that materially changed
 * with ADR 2026-05-11 are "What ContentRX collects" (added the
 * shared-strings bucket) and "Your rights" (replaced the calibration
 * opt-out with the Flag-for-Review revocation path).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";

const EFFECTIVE_DATE = "May 10, 2026";
const PRIVACY_EMAIL = "privacy@contentrx.io";

export const metadata: Metadata = {
  title: "Privacy. ContentRX",
  description:
    "What ContentRX collects, how it's used, who else sees it, and how to delete or export it. Plain language. Legal precision where it matters.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="Privacy"
        title="Privacy policy"
        lede={
          <>
            ContentRX is a content-design review tool. To do that job,
            ContentRX has to receive the strings you check, run them
            through the evaluation engine (which uses Anthropic&apos;s
            Claude models), and store enough of a record to bill you
            and to show you your own history. This page lays out what
            flows where, who else sees it, and how to delete or revoke
            it.
          </>
        }
        meta={
          <>
            Effective <time>{EFFECTIVE_DATE}</time>. Material changes
            get a new effective date and a note in the changelog.
          </>
        }
      />

      <Section title="What ContentRX collects">
        <p>Four buckets.</p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>Account data.</strong> When you sign up, the
            authentication provider (Clerk) handles your email,
            password, and session. If you upgrade to a paid plan, the
            billing provider (Stripe) handles your card details.
            ContentRX never sees your password and never stores your
            card number.
          </li>
          <li>
            <strong>Content you submit for review.</strong> Every
            string passed to <code>/api/check</code>,{" "}
            <code>/api/classify</code>, or <code>/api/suggest-fix</code>{" "}
            is forwarded to the evaluation engine and to Anthropic. In
            ContentRX&apos;s own database, only a sha256 hash of the
            text persists. The plaintext is held in memory for the
            request lifecycle and then discarded. ContentRX retains
            metadata for that hash. The verdict, severity, content
            type, file path (if your tool supplied one), and the
            surface that made the request.
          </li>
          <li>
            <strong>Strings you explicitly share via Flag for Review.</strong>
            {" "}When you tap Flag for Review on a finding and confirm
            the consent modal, the plaintext of that string is stored
            for calibration alongside a per-row consent record. Each
            shared string is visible to you at{" "}
            <Link href="/dashboard/shared" className="underline underline-offset-2">
              /dashboard/shared
            </Link>
            . Email{" "}
            <a
              href={`mailto:${PRIVACY_EMAIL}`}
              className="underline underline-offset-2"
            >
              {PRIVACY_EMAIL}
            </a>
            {" "}to revoke a shared string at any time.
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
          ContentRX does <strong>not</strong> collect your IP address
          beyond what is needed for short-window rate limiting, and
          uses no advertising identifiers or third-party tracking pixels.
        </p>
      </Section>

      <Section title="What ContentRX does with it">
        <p>
          Account and billing data keep your account working and send
          you the receipts you would expect.
        </p>
        <p className="mt-3">
          Content strings run the evaluation, return verdicts, and
          (when you have explicitly shared a string via Flag for
          Review) inform the calibration log so the engine gets
          better. The hash stored for unshared strings supports
          dashboard history lookups without keeping the plaintext.
        </p>
        <p className="mt-3">
          Telemetry fixes bugs (Sentry), bills correctly (token
          counts), enforces rate limits (Redis), and tracks which
          public pages people read (Plausible). None of these
          subprocessors receive content strings.
        </p>
        <p className="mt-3">
          ContentRX does not sell your data and does not train any
          model on customer content. The Flag-for-Review consent flow
          is the only path by which a customer string influences the
          calibration corpus.
        </p>
      </Section>

      <Section title="What ContentRX does not do, in plain language">
        <p>
          Subscription is the entire revenue model. ContentRX does not
          make money any other way. The bullets below are the lines
          ContentRX will not cross to make up the difference.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>ContentRX does not sell your strings.</strong>{" "}
            Hashed, anonymised, or otherwise. No data-broker contract,
            no advertiser arrangement.
          </li>
          <li>
            <strong>ContentRX does not repackage your check history
            into a profile</strong> of you, your team, or your industry
            that gets marketed against you.
          </li>
          <li>
            <strong>ContentRX does not use your content to train any
            model</strong> (its own, Anthropic&apos;s, anyone&apos;s).
            Strings you share via Flag for Review feed a hand-curated
            calibration corpus. Nothing else does.
          </li>
          <li>
            <strong>ContentRX does not share your strings with any
            third party</strong> beyond the subprocessors named below.
          </li>
          <li>
            <strong>ContentRX does not run engagement-modelling
            telemetry</strong> on how you use the product. The only
            usage data tracked is check counts (because billing) and
            crash reports (because bugs).
          </li>
        </ul>
        <p className="mt-4">
          The engineering layer behind that. Every public route that
          takes a string runs a pre-screen that refuses obvious
          credentials and PII (credit card numbers, SSNs, AWS, Stripe,
          OpenAI, Anthropic, GitHub keys) before they can reach
          Anthropic, the error logs, or anyone&apos;s eyes. Sentry
          events have request bodies and auth headers stripped before
          send. The long-form version of this commitment, with the
          rationale and the &ldquo;what changes if ContentRX ever
          changes its mind&rdquo; path, lives at{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          {" "}(Commitment 3).
        </p>
      </Section>

      <Section title="Who else sees it (subprocessors)">
        <p>
          Running ContentRX requires partners. Each one sees only the
          data it needs for the job ContentRX is paying it to do.
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
              data="Your email address and the message body ContentRX sends to you."
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
          ContentRX updates this list within 30 days of any change. If
          a new subprocessor would meaningfully change what data is
          shared, ContentRX posts about it in advance.
        </p>
      </Section>

      <Section title="Where the data lives">
        <p>
          Application data lives in US-region Supabase Postgres.
          Anthropic processes content in its own infrastructure under
          its standard API policy. Vercel runs functions in regions
          close to your users.
        </p>
        <p className="mt-3">
          If you have a regulatory requirement for EU-region data
          residency or specific retention guarantees from any of the
          subprocessors named above, email{" "}
          <code>{PRIVACY_EMAIL}</code> before signing up. ContentRX
          will be straight with you about whether the requirement can
          be met today.
        </p>
      </Section>

      <Section title="How long ContentRX keeps it">
        <p>
          While your account is active, the data described above
          sticks around for as long as it is useful to you and to
          ContentRX.
        </p>
        <p className="mt-3">
          <strong>Strings you shared via Flag for Review</strong>{" "}
          stay in the calibration corpus until you revoke them. To
          revoke a specific string, email{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">
            {PRIVACY_EMAIL}
          </a>
          {" "}with rough timing and source surface. Your shared-strings
          list at{" "}
          <Link href="/dashboard/shared" className="underline underline-offset-2">
            /dashboard/shared
          </Link>
          {" "}is the canonical record of what ContentRX has on you
          from that consent flow.
        </p>
        <p className="mt-3">
          <strong>To delete your account entirely</strong>, email{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">
            {PRIVACY_EMAIL}
          </a>
          . ContentRX will cancel any active subscription, anonymize
          historical violation hashes and override records (the{" "}
          <code>user_id</code> is set to null so engine calibration
          retains the signal but the link back to you is severed),
          delete any Flag-for-Review shares, clear identifiers on
          your account row, and delete your Clerk login.
        </p>
        <p className="mt-3">
          Some records have legally required retention. Stripe
          receipts run 7 years for tax. Fraud-prevention logs run
          shorter. ContentRX will tell you specifically what stays
          and why when you ask.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Everything below routes through{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">
            {PRIVACY_EMAIL}
          </a>
          . ContentRX responds within 30 days.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>See what ContentRX has on you.</strong> Email the
            address above. ContentRX will respond with the records
            it holds.
          </li>
          <li>
            <strong>Correct it.</strong> Most fields are editable from
            the dashboard. For anything that is not, ask.
          </li>
          <li>
            <strong>Delete your account.</strong> Email the address
            above with subject{" "}
            <code>[DELETE]</code>. ContentRX runs the deletion
            sequence described in &ldquo;How long ContentRX keeps
            it.&rdquo;
          </li>
          <li>
            <strong>Export your data.</strong> Email the address above
            with subject{" "}
            <code>[EXPORT]</code>. ContentRX will respond within 30
            days.
          </li>
          <li>
            <strong>Revoke a string you shared via Flag for Review.</strong>
            {" "}Email the address above with rough timing and source
            surface. ContentRX deletes the row and any record that
            string produced in the calibration log. Your{" "}
            <Link href="/dashboard/shared" className="underline underline-offset-2">
              /dashboard/shared
            </Link>
            {" "}page lists every string ContentRX is holding on this
            path.
          </li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p>
          The only cookie ContentRX sets is the Clerk authentication
          session. Strictly necessary, expires when you sign out.
          Plausible is cookieless. ContentRX does not use third-party
          analytics, ad networks, or tracking pixels. If a regulator
          asks for a cookie banner, the honest answer is &ldquo;not
          needed today, but tell ContentRX and one will land.&rdquo;
        </p>
      </Section>

      <Section title="Children">
        <p>
          ContentRX is a B2B tool. ContentRX does not target it at, or
          knowingly accept accounts from, anyone under 16. If a parent
          or guardian believes their child has signed up, email{" "}
          <code>{PRIVACY_EMAIL}</code> and ContentRX will delete the
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
          GDPR and CCPA requests, DPA inquiries, and subprocessor-list
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
    <tr className="border-b border-line align-top">
      <td className="py-3 pr-4 font-medium text-strong">
        {name}
      </td>
      <td className="py-3 pr-4 text-xs">{purpose}</td>
      <td className="py-3 text-xs">{data}</td>
    </tr>
  );
}
