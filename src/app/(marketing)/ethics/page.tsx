/**
 * /ethics — ContentRX's four load-bearing commitments.
 *
 * 2026-05-05 rewrite per Robert's audit: when the page first shipped
 * (Session 14) ContentRX agreed to a public-facing taxonomy, and the
 * page was structured around external-signal hygiene (transparency,
 * attribution, robots.txt respect, license-awareness, PII avoidance,
 * customer-not-product). The 2026-04-25 private-taxonomy pivot
 * inverted that framing — we don't publish the taxonomy, we don't
 * crawl at scale, and customers paying for a tool care about
 * outcomes, not robots.txt.
 *
 * 2026-05-06 update: /sources retired (ADR 2026-05-06). The
 * transparency-and-opt-out commitment that page anchored folds in
 * here as Commitment 4 with a deep-link target (#no-stolen-content)
 * that the /sources route now 308s into. The slug is preserved so
 * external bookmarks and the /about inline link still resolve.
 *
 * 2026-05-06 (later): renamed Commitment 4 from "No stolen content"
 * to "Sources I have rights to use." The original framing
 * presupposed an accusation no one had made; the new title
 * describes the standard positively (rights to use) rather than
 * denying its inverse (theft). Slug intentionally not renamed —
 * external bookmarks. Four commitments, in this order:
 *   1. Privacy
 *   2. Security
 *   3. Customer, not product
 *   4. Sources I have rights to use
 *
 * Voice: Robert's first-person voice. Calm, direct, plain. No em
 * dashes. Names the actor. Doesn't blame. Points somewhere.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Ethics. ContentRX",
  description:
    "How ContentRX handles your work. Four commitments: Privacy, Security, Customer not product, Sources I have rights to use.",
};

export default function EthicsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="Ethics"
        title="How we handle your work"
        lede={
          <p className="text-sm text-quiet">
            Four commitments hold the rest of the product together.
            They&apos;re short on purpose. The deep policy lives at{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              /privacy
            </Link>{" "}
            and{" "}
            <Link href="/security" className="underline underline-offset-2">
              /security
            </Link>
            ; this page is the position those policies sit under.
          </p>
        }
      />

      <Section
        number="1"
        title="Privacy"
        summary="Your text is reviewed, returned, and gone. The hash is what we keep."
      >
        <p>
          When you send a string to ContentRX for review, the engine
          evaluates it, the verdict comes back, and the plaintext
          doesn&apos;t persist. What we retain in our database is a
          sha256 hash, the verdict, the severity, the content type,
          and which surface called us. That&apos;s the entire list.
          We can&apos;t reconstruct your copy from what we keep.
        </p>
        <p className="mt-3">
          A pre-screen on every public route refuses obvious
          credentials and PII before they reach the engine: credit
          card numbers, SSNs, Stripe / OpenAI / Anthropic / GitHub
          keys, AWS access keys. They never reach the engine, never
          reach Anthropic, never reach the error logs. Sentry events
          have request bodies and auth headers stripped before send.
        </p>
        <p className="mt-3">
          The full policy, including the subprocessor list, is at{" "}
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
          TLS in transit, hashed credentials at rest, audit logs on
          admin-tier surfaces. The web app, the engine, and the
          subprocessors named on{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          {" "}form the trust boundary; everything outside of that is
          the public internet.
        </p>
        <p className="mt-3">
          SOC 2 Type II is the work in progress. Until that&apos;s in
          hand we publish what we do today on{" "}
          <Link href="/security" className="underline underline-offset-2">
            /security
          </Link>
          {" "}and answer specific posture questions in writing. If
          you&apos;ve found a vulnerability, the same page has the
          coordinated-disclosure path.
        </p>
      </Section>

      <Section
        number="3"
        title="Customer, not product"
        summary="ContentRX makes money by charging for a tool. Not by selling, repackaging, or modeling the work you check."
      >
        <p>
          The subscription is the entire revenue model. Free exists
          so you can try the product; paid tiers exist because the
          engine costs real money to run and the calibration work
          takes real time. There&apos;s no second shoe to drop. The
          lines I won&apos;t cross to make up the difference, in
          plain language:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            I don&apos;t sell your strings (hashed, anonymised, or
            otherwise) to data brokers, advertisers, or anyone else.
            There is no third-party broker contract; there will not
            be one.
          </li>
          <li>
            I don&apos;t repackage your check history into a profile
            of you, your team, or your industry that gets marketed
            against you. Your dashboard shows your activity to you;
            no aggregate &ldquo;intent signal&rdquo; product gets
            sold on top.
          </li>
          <li>
            I don&apos;t use your content to train a model (mine,
            Anthropic&apos;s, anyone&apos;s) without your explicit,
            per-entry opt-in. The Team-plan custom-example
            contribution toggle is the only path by which a customer
            string ever joins the calibration corpus. It&apos;s off
            by default, and it&apos;s a per-entry toggle, not a
            one-time account-wide setting.
          </li>
          <li>
            I don&apos;t run an &ldquo;engagement metrics&rdquo; or
            behavioural-modelling layer on how you use ContentRX. We
            track monthly check counts (because billing) and crash
            reports (because bugs). Nothing else.
          </li>
        </ul>
        <p className="mt-3">
          If any of this ever changes, say a future investor pitches
          &ldquo;but think of the data,&rdquo; the policy here gets
          superseded by an ADR I publish before any new collection
          starts, and existing customers are notified by email. The
          version of this commitment that&apos;s live is always the
          one at /ethics. If there&apos;s no superseding ADR linked
          from this page, the rules above are the rules.
        </p>
      </Section>

      <Section
        number="4"
        title="Sources I have rights to use"
        summary="Open-licensed code, fair-use editorial citation, and original work. The three buckets the model learns from."
        id="no-stolen-content"
      >
        <p>
          The model draws from a small set of inputs with clear
          license: published style guides cited as influences, a few
          permissively-licensed open-source repositories, and content
          I write myself. Every input has an MIT license, a fair-use
          standing, or a public-style-guide convention behind it.
        </p>
        <p className="mt-3">
          If you maintain a project I&apos;ve cited and would rather
          I hadn&apos;t, email{" "}
          <a
            href="mailto:hello@contentrx.io?subject=%5BOPTOUT%5D"
            className="underline underline-offset-2"
          >
            hello@contentrx.io
          </a>
          {" "}with subject <code>[OPTOUT]</code> and the project
          name. I&apos;ll remove the influence and confirm.
        </p>
      </Section>

      <footer className="mt-16 text-xs text-quiet">
        <p>
          Last updated 2026-05-06. Source:{" "}
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
  id,
  children,
}: {
  number: string;
  title: string;
  summary: string;
  /** Optional anchor id. When set, the section uses `scroll-mt-16`
   * so deep links (#no-stolen-content) land below the sticky header
   * instead of jamming the heading under it. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="mt-8 border-t border-line pt-8 scroll-mt-16 first:border-t-0 first:pt-0"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
        Commitment {number}
      </p>
      <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm italic text-quiet">{summary}</p>
      <div className="mt-4 text-sm text-default">{children}</div>
    </section>
  );
}
