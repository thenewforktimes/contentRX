/**
 * /security — public vulnerability disclosure policy.
 *
 * Pairs with `public/.well-known/security.txt` (RFC 9116) — that's the
 * machine-readable form security researchers point their tooling at;
 * this page is the human one with the full policy in plain English.
 *
 * Voice note: matter-of-fact. Researchers reading this want to know
 * (a) where to send a report, (b) what's in scope, (c) whether
 * they'll be sued for poking around. Answer all three on the first
 * scroll.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Section } from "@/components/ui/section";

const SECURITY_EMAIL = "security@contentrx.io";

export const metadata: Metadata = {
  title: "Security — ContentRX",
  description:
    "How to report a vulnerability in ContentRX. Coordinated disclosure, safe-harbor for good-faith research, response within 5 business days.",
};

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <header className="mb-12">
        <Eyebrow>Security</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold">
          Reporting a vulnerability
        </h1>
        <p className="mt-4 text-lg text-neutral-700 dark:text-neutral-300">
          If you&apos;ve found something that looks like a security issue
          in ContentRX, please tell us before you tell anyone else.
          We&apos;ll work with you on a fix and a coordinated disclosure
          timeline.
        </p>
      </header>

      <Section title="How to report">
        <p>
          Email{" "}
          <a
            href={`mailto:${SECURITY_EMAIL}`}
            className="underline underline-offset-2"
          >
            <code>{SECURITY_EMAIL}</code>
          </a>
          . Include enough detail to reproduce — affected URL or
          surface, request shape, what you expected vs. what happened.
          A proof-of-concept is welcome but not required.
        </p>
        <p className="mt-3">
          We&apos;ll acknowledge receipt within{" "}
          <strong>2 business days</strong> and aim for a substantive
          response (triage, severity assessment, expected fix
          timeline) within <strong>5 business days</strong>. Critical
          issues skip the queue.
        </p>
      </Section>

      <Section title="Scope">
        <p>The following surfaces are in scope for disclosure:</p>
        <ul className="mt-3 ml-5 list-disc space-y-1.5">
          <li>
            The web app at <code>contentrx.io</code> and its API
            endpoints (<code>/api/*</code>)
          </li>
          <li>
            The Figma plugin distributed via the Figma plugin store
          </li>
          <li>
            The PyPI packages <code>contentrx-mcp</code>,{" "}
            <code>contentrx-lsp</code>, and <code>contentrx-cli</code>
          </li>
          <li>
            The GitHub Action distributed from{" "}
            <a
              href="https://github.com/thenewforktimes/contentRX"
              className="underline underline-offset-2"
            >
              the contentRX repository
            </a>
          </li>
        </ul>
        <p className="mt-4">Out of scope:</p>
        <ul className="mt-3 ml-5 list-disc space-y-1.5">
          <li>
            Third-party services we depend on (Stripe, Clerk, Supabase,
            Anthropic, Vercel, etc.) — please report those to the
            respective vendors&apos; programs.
          </li>
          <li>
            Issues that require physical access to a target&apos;s
            device.
          </li>
          <li>
            Reports that boil down to &ldquo;the rate limit is
            X req/min, that&apos;s configurable&rdquo; — we welcome
            tuning suggestions but those aren&apos;t vulnerabilities.
          </li>
          <li>
            Theoretical issues without a working proof-of-concept
            (e.g., outdated-library reports without an exploitable
            path).
          </li>
        </ul>
      </Section>

      <Section title="Safe harbor">
        <p>
          We will not pursue legal action against, or report to law
          enforcement, security researchers who:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-1.5">
          <li>
            Make a good-faith effort to avoid privacy violations,
            destruction of data, and degradation of service to other
            users.
          </li>
          <li>
            Only test against accounts they own or have explicit
            permission to test.
          </li>
          <li>
            Stop testing and submit a report as soon as a vulnerability
            is identified.
          </li>
          <li>
            Don&apos;t exfiltrate, retain, or share data they encounter
            during testing.
          </li>
          <li>
            Give us a reasonable window to fix before public
            disclosure (we typically agree on 90 days).
          </li>
        </ul>
        <p className="mt-3">
          If you&apos;re unsure whether something is in scope or
          whether a test is OK, ask first — we&apos;ll respond with a
          plain answer.
        </p>
      </Section>

      <Section title="What we don&apos;t offer">
        <p>
          We don&apos;t currently run a paid bug-bounty program. We do
          credit researchers in our changelog when they request it,
          and we&apos;re happy to provide a written acknowledgment for
          your portfolio. If a bounty matters more than that, please
          look at programs from companies set up to run them at scale
          — we&apos;re a small team and disclosure quality matters
          more to us than payout volume.
        </p>
      </Section>

      <Section title="Other ways to reach us">
        <p>
          For non-security issues, the{" "}
          <Link
            href="https://github.com/thenewforktimes/contentRX/issues"
            className="underline underline-offset-2"
          >
            GitHub issue tracker
          </Link>{" "}
          is the right place. For privacy or data-handling questions,
          see the{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy policy
          </Link>{" "}
          or email <code>privacy@contentrx.io</code>.
        </p>
        <p className="mt-3">
          The machine-readable version of this policy lives at{" "}
          <code>/.well-known/security.txt</code> per RFC 9116.
        </p>
      </Section>
    </main>
  );
}
