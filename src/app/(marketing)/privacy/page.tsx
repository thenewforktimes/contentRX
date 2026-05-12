/**
 * /privacy — public privacy policy.
 *
 * Plain language first. Legal scaffolding is the minimum needed for
 * GDPR/CCPA. Voice matches /ethics: ContentRX-third-person,
 * no em dashes, no semicolons, no colons in body sentences, no
 * boilerplate phrases like "your privacy is important to us."
 *
 * Voice note for Robert: this is a starter draft. Have a lawyer review
 * before paid customers land. The sections that materially changed
 * with ADR 2026-05-11 are "What ContentRX collects" (added the
 * shared-strings bucket) and "Your rights" (replaced the calibration
 * opt-out with the Flag-for-Review revocation path).
 *
 * 2026-05-12 update (gap-fill for Termageddon-equivalent coverage,
 * Path A — keep hand-crafted page canonical, add legal-completeness
 * sections in voice rather than embedding generic Termageddon
 * content). Four sections added:
 *   - "CCPA categories, in California terms" (after the four-buckets
 *     section). Translates the four buckets to CPRA category names
 *     and adds the SPI / data-broker disclosures.
 *   - "Sale and share, in CCPA terms" (after "What ContentRX does
 *     not do"). Explicit term-of-art no-sale, no-share statement
 *     with the multi-state law list.
 *   - Four new bullets in "Your rights" (portability, objection,
 *     consent withdrawal, supervisory-authority complaint).
 *   - "Regional availability" (before "Changes"). Documents the
 *     US + Canada-ex-Quebec geo-block, names the privacy officer
 *     for PIPEDA, explains the Quebec-specific block, and reserves
 *     the deferred Article 27 representative slot for future EU/UK
 *     expansion.
 * Existing voice rules apply to every new section. Effective date
 * bumped from May 10 to May 12, 2026.
 *
 * 2026-05-12 second update: scope expanded from US-only to
 * US + Canada-ex-Quebec per founder direction. The original
 * "EU, UK, and other regions" section was renamed "Regional
 * availability" and rewritten to name PIPEDA coverage for English
 * Canada, explain why Quebec is specifically blocked (Law 25
 * operational requirements not yet built), and keep the EU/UK
 * deferred-Article-27 language intact for future use.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";

const EFFECTIVE_DATE = "May 12, 2026";
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
            ContentRX has to receive the checks you run, run them
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
            <strong>Account data</strong>. When you sign up, the
            authentication provider (Clerk) handles your email,
            password, and session. If you upgrade to a paid plan, the
            billing provider (Stripe) handles your card details.
            ContentRX never sees your password and never stores your
            card number.
          </li>
          <li>
            <strong>Content you submit for review</strong>. Every
            check passed to <code>/api/check</code>,{" "}
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
            <strong>Checks you explicitly share via Flag for Review</strong>.
            {" "}When you tap Flag for Review on a finding and confirm
            the consent modal, the plaintext of that check is stored
            for calibration alongside a per-row consent record. Each
            shared check is visible to you at{" "}
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
            {" "}to revoke a shared check at any time.
          </li>
          <li>
            <strong>Usage and operational telemetry</strong>.
            ContentRX counts your checks per month for billing.
            ContentRX tracks API token usage for cost accounting.
            Sentry captures error reports. Plausible collects
            anonymous page-view metrics. Upstash Redis stores
            rate-limit counters.
          </li>
        </ul>
        <p className="mt-3">
          ContentRX does <strong>not</strong> collect your IP address
          beyond what is needed for short-window rate limiting, and
          uses no advertising identifiers or third-party tracking pixels.
        </p>
      </Section>

      <Section title="CCPA categories, in California terms">
        <p>
          California&apos;s privacy law uses a specific vocabulary for
          the categories of personal information a business collects.
          Here is how the four buckets above translate.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>Identifiers</strong>. Account email, hashed user
            id, Clerk session id, and the IP address held only for the
            duration of the rate-limit window.
          </li>
          <li>
            <strong>Commercial information</strong>. This includes
            subscription plan, billing history, and monthly check counts.
          </li>
          <li>
            <strong>Internet or other electronic network activity</strong>.
            {" "}API requests, Sentry error reports, Plausible page-view
            counts.
          </li>
          <li>
            <strong>Inferences</strong>. None. ContentRX does not
            derive demographic, behavioural, or predictive attributes
            from customer activity. See <Link href="/ethics" className="underline underline-offset-2">/ethics</Link> Commitment 3 for the
            engineering layer behind that.
          </li>
        </ul>
        <p className="mt-3">
          ContentRX does not collect <strong>sensitive personal
          information</strong> as CPRA defines the term. That category
          covers precise geolocation, race or ethnicity, religion,
          biometric identifiers, health data, sexual orientation, union
          membership, and immigration status. None of it touches the
          Service. ContentRX collects all personal information directly
          from the consumer. Nothing is purchased from data brokers or
          scraped from third-party sources.
        </p>
      </Section>

      <Section title="What ContentRX does with it">
        <p>
          Account and billing data keep your account working and send
          you the receipts you would expect.
        </p>
        <p className="mt-3">
          Content checks run the evaluation and return verdicts.
          When you have explicitly shared a check via Flag for
          Review, it also informs the calibration log so the engine
          gets better. The hash stored for unshared checks supports
          dashboard history lookups without keeping the plaintext.
        </p>
        <p className="mt-3">
          Telemetry fixes bugs (Sentry), bills correctly (token
          counts), enforces rate limits (Redis), and tracks which
          public pages people read (Plausible). None of these
          subprocessors receive content checks.
        </p>
        <p className="mt-3">
          ContentRX does not sell your data and does not train any
          model on customer content. The Flag-for-Review consent flow
          is the only path by which a customer check influences the
          calibration log.
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
            <strong>ContentRX does not sell your checks</strong>.{" "}
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
            Checks you share via Flag for Review feed a hand-curated
            calibration log. Nothing else does.
          </li>
          <li>
            <strong>ContentRX does not share your checks with any
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
          takes a check runs a pre-screen. The pre-screen refuses
          obvious credentials and PII before they can reach Anthropic,
          the error logs, or anyone&apos;s eyes. The patterns include
          credit card numbers, SSNs, and keys for AWS, Stripe, OpenAI,
          Anthropic, and GitHub. Sentry events have request bodies
          and auth headers stripped before send. The long-form
          version of this commitment lives at{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          {" "}(Commitment 3).
        </p>
      </Section>

      <Section title="Sale and share, in CCPA terms">
        <p>
          California privacy law defines <strong>sale</strong> as
          exchanging personal information for monetary or other
          valuable consideration, and <strong>share</strong> as
          disclosing personal information for cross-context behavioural
          advertising. The other state laws (Virginia, Colorado,
          Connecticut, Utah, Texas, Oregon, Montana, Iowa, Tennessee,
          Indiana, Delaware, New Jersey, New Hampshire, Maryland,
          Minnesota, Rhode Island, and the rest as they come online)
          use definitions that are close enough to treat as equivalent.
        </p>
        <p className="mt-3">
          ContentRX does not sell personal information under any of
          those definitions. ContentRX does not share personal
          information for cross-context behavioural advertising under
          any of those definitions. ContentRX has not done either in
          the past, and the subscription business model means it would
          have nothing to gain by starting.
        </p>
        <p className="mt-3">
          The subprocessors in the table above each see a slice of
          customer data so they can do the specific job ContentRX is
          paying them to do. Those are service-provider relationships
          governed by contract. They are not sales, and they are not
          shares.
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
              data="The text checks you submit for review."
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
          <strong>Checks you shared via Flag for Review</strong> stay
          in the calibration log until you revoke them. Your
          shared-checks list at{" "}
          <Link href="/dashboard/shared" className="underline underline-offset-2">
            /dashboard/shared
          </Link>
          {" "}is the canonical record of what ContentRX has on you
          from that consent flow. Each row has a{" "}
          <span className="font-medium text-strong">Remove this check</span>
          {" "}button that deletes the row and any record it produced
          in the calibration log.
        </p>
        <p className="mt-3">
          <strong>When you delete your account entirely</strong>,
          every row attached to it goes too. ContentRX&apos;s baseline
          is the right and ability to be forgotten, not an
          anonymize-and-keep posture. The sequence:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>Any active subscription is cancelled.</li>
          <li>
            Every check you ran is deleted. Hashes, findings,
            overrides, dismissals, all of it.
          </li>
          <li>Every check you shared via Flag for Review is deleted.</li>
          <li>
            Team rules, team members, team invitations, and any
            agent-run history are deleted.
          </li>
          <li>
            Your account row, API key, Stripe customer link, and
            subscription record are deleted from ContentRX&apos;s
            database.
          </li>
          <li>Your Clerk login is deleted.</li>
        </ul>
        <p className="mt-3">
          Run the delete flow from{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">
            /dashboard/settings
          </Link>
          . Stripe itself retains receipts for tax and fraud
          reasons on its side. That retention is Stripe&apos;s, not
          ContentRX&apos;s.
        </p>
      </Section>

      <Section title="Your rights">
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>See what ContentRX has on you</strong>. The
            dashboard shows your check history, your shared checks,
            and your account record. For a single export of
            everything in one bundle, email{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">
              {PRIVACY_EMAIL}
            </a>
            {" "}with subject <code>[EXPORT]</code>. ContentRX responds
            within 30 days.
          </li>
          <li>
            <strong>Correct it</strong>. Most fields are editable from
            the dashboard. For anything that is not, email the address
            above.
          </li>
          <li>
            <strong>Delete your account</strong>. Run the in-product
            delete flow at{" "}
            <Link href="/dashboard/settings" className="underline underline-offset-2">
              /dashboard/settings
            </Link>
            . Every row attached to your account is deleted.
          </li>
          <li>
            <strong>Revoke a check you shared via Flag for Review</strong>.
            {" "}Open{" "}
            <Link href="/dashboard/shared" className="underline underline-offset-2">
              /dashboard/shared
            </Link>
            {" "}and tap{" "}
            <span className="font-medium text-strong">Remove this check</span>
            {" "}on the row. ContentRX deletes the row and any record
            it produced in the calibration log.
          </li>
          <li>
            <strong>Receive an export in a portable format</strong>.
            Email{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">
              {PRIVACY_EMAIL}
            </a>
            {" "}with subject <code>[EXPORT-PORTABLE]</code>. ContentRX
            delivers a JSON bundle of your account data within 30 days.
            The bundle is structured so another vendor can import it
            without manual cleanup.
          </li>
          <li>
            <strong>Object to specific processing</strong>. For any
            processing ContentRX does outside the strict performance
            of the Service (the most common example is the renewal-reminder
            email, which is required by California&apos;s automatic-renewal
            law and cannot be turned off, and product-update emails,
            which can), email the privacy address with subject{" "}
            <code>[OBJECT]</code> and the kind of processing you want
            stopped.
          </li>
          <li>
            <strong>Withdraw any consent you previously gave</strong>.
            Most relevantly, the Flag-for-Review consent is withdrawable
            per-check at{" "}
            <Link href="/dashboard/shared" className="underline underline-offset-2">
              /dashboard/shared
            </Link>
            . Other consent withdrawals (for example, opting out of
            future product-update emails) go through the privacy
            address. Withdrawing consent does not affect the lawfulness
            of any processing ContentRX did before the withdrawal.
          </li>
          <li>
            <strong>Lodge a complaint with a regulator</strong>. If
            ContentRX has not resolved a concern to your satisfaction,
            the relevant authority is your state attorney general in
            the United States, your data protection authority in the
            European Union or United Kingdom once those markets are
            open, or your provincial commissioner in Canada. ContentRX
            would obviously rather hear from you first and fix the
            underlying issue.
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
          needed today.&rdquo; If that changes, ContentRX will add
          one.
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

      <Section title="Regional availability">
        <p>
          ContentRX is currently available to customers in the United
          States (including U.S. territories) and Canadian provinces
          other than Quebec. Visitors from the European Union, the
          European Economic Area, the United Kingdom, Quebec, and
          other regions see a waitlist page at{" "}
          <Link href="/waitlist" className="underline underline-offset-2">
            /waitlist
          </Link>
          {" "}instead of the signup form.
        </p>
        <p className="mt-3">
          Canadian customers (outside Quebec) are covered by PIPEDA.
          The privacy officer for PIPEDA inquiries is reachable at{" "}
          <code>{PRIVACY_EMAIL}</code>. If you observe a breach
          involving your personal information, ContentRX notifies you
          and the Office of the Privacy Commissioner of Canada per
          PIPEDA when the breach creates a real risk of significant
          harm.
        </p>
        <p className="mt-3">
          Quebec is geo-blocked specifically because Quebec Law 25
          adds requirements (French-language privacy notice, mandatory
          privacy impact assessments for certain automated
          decision-making, in-province privacy officer) that ContentRX
          has not yet built operational coverage for. When that
          coverage is in place, Quebec access will open and this
          section will be updated.
        </p>
        <p className="mt-3">
          When ContentRX opens EU or UK access, an Article 27
          representative will be appointed and named in this section
          before any signups from those regions are accepted. Until
          then, the rights enumerated above are extended voluntarily
          to every visitor regardless of jurisdiction, and the
          subprocessor table is the operating record of who sees what.
          ContentRX runs entirely on US-region infrastructure as of
          this effective date.
        </p>
        <p className="mt-3">
          If you have a regulatory requirement that cannot be met
          under the current setup (EU-region data residency, named
          Article 27 rep, specific BAA-eligible subprocessors,
          French-language Quebec-compliant notice), email{" "}
          <code>{PRIVACY_EMAIL}</code> before signing up. ContentRX
          will be straight with you about whether the requirement can
          be met today or whether you should wait for the next
          expansion.
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
