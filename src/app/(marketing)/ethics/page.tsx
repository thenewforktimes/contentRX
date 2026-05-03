/**
 * /ethics — ContentRX's public ethical framework.
 *
 * Human-eval build plan Session 14. Lists the five commitments that
 * govern how ContentRX collects, attributes, and uses external signal
 * (design systems, style guides, OSS repos). Plus the opt-out path.
 *
 * The page needs to go live BEFORE any external crawling starts at
 * scale (Session 15). Wiring first, populated data later (Session 19
 * fills `/sources`).
 *
 * Copy notes: the voice here is plain + first-person. The plan spec
 * says "copy is in Robert's voice" — Robert will edit; this version
 * exists to ship the commitments, not the prose.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ethics. ContentRX",
  description:
    "How ContentRX collects, attributes, and uses external signal. Five public commitments, plus the opt-out path.",
};

const OPT_OUT_EMAIL = "hello@contentrx.io";
const OPT_OUT_SUBJECT = "[OPTOUT] <source name>";

export default function EthicsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400">
          ContentRX ethical framework
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          How I collect, attribute, and use external signal
        </h1>
        <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">
          ContentRX learns from public sources: design systems, style
          guides, OSS repos that demonstrate content-design craft. Those
          sources deserve clear rules about how their work is used.
          Below are the five commitments I make. If any of them fail in
          practice, file it against{" "}
          <a
            href={`mailto:${OPT_OUT_EMAIL}?subject=${encodeURIComponent("[ETHICS] ")}`}
            className="underline underline-offset-2"
          >
            {OPT_OUT_EMAIL}
          </a>
          .
        </p>
      </header>

      <Section
        number="1"
        title="Transparency"
        summary="You can see every source I've ingested, when it was last crawled, and what it contributed."
      >
        <p>
          The{" "}
          <Link href="/sources" className="underline underline-offset-2">
            /sources page
          </Link>{" "}
          lists every design system, style guide, and OSS repo that has
          informed ContentRX. For each entry you&apos;ll see the last
          crawl timestamp, the license, and how the source contributed:
          moment weights, standard influences, examples corpus, or
          training signal. Hidden contributions would be indistinguishable
          from theft; the page is the accountability surface.
        </p>
        <p className="mt-3">
          Calibration reporting is the other half:{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>{" "}
          shows measured system κ and measured self-drift κ with 95%
          confidence intervals, the design target stated separately, and
          per-standard breakdowns. No composite &ldquo;accuracy score.&rdquo;
        </p>
      </Section>

      <Section
        number="2"
        title="Attribution"
        summary="Examples drawn from public sources are cited with source, commit or URL, and license."
      >
        <p>
          When a ContentRX standard is influenced by a specific design
          system or style guide, the influence is recorded on the
          standard itself. When examples in the docs or product come
          from a public source, the source is named inline, with a
          commit hash or URL when the exact revision matters. Anyone
          can trace a rule back to its lineage.
        </p>
      </Section>

      <Section
        number="3"
        title="Respect"
        summary="robots.txt, rate limits, a named bot, and a real opt-out path."
      >
        <p>
          The external-signal crawler identifies itself as{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-xs dark:bg-stone-900">
            contentrx-research-bot
          </code>{" "}
          with a contact URL in the user-agent string. It honors
          robots.txt. It rate-limits requests so no host sees ContentRX
          as a spike. Projects that ask to be excluded are excluded.
          Signal already derived from them is removed from subsequent
          training.
        </p>
        <p className="mt-3">
          To opt out, email{" "}
          <a
            href={`mailto:${OPT_OUT_EMAIL}?subject=${encodeURIComponent(OPT_OUT_SUBJECT)}`}
            className="underline underline-offset-2"
          >
            {OPT_OUT_EMAIL}
          </a>{" "}
          with subject line{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-xs dark:bg-stone-900">
            {OPT_OUT_SUBJECT}
          </code>
          . I confirm receipt within a week and land the removal in the
          following release cycle. If you haven&apos;t heard back within
          seven days, email again. Something went wrong with the
          routing on my end.
        </p>
      </Section>

      <Section
        number="4"
        title="License-awareness"
        summary="Permissive licenses default-in with attribution. GPL takes case-by-case review. No verbatim reproduction without credit."
      >
        <ul className="ml-5 list-disc space-y-2">
          <li>
            Permissive licenses (MIT, Apache 2.0, BSD, CC-BY) are
            default-in as training signal with attribution on{" "}
            <Link href="/sources" className="underline underline-offset-2">
              /sources
            </Link>
            .
          </li>
          <li>
            GPL code is not ingested as training data without case-by-
            case review. The derivative-work surface on GPL is
            non-trivial and I err on the side of not creating it.
          </li>
          <li>
            Source strings are never reproduced verbatim as product
            output without attribution. If a standard&apos;s example is
            lifted directly from a public source, the source is named
            at the point of use.
          </li>
        </ul>
      </Section>

      <Section
        number="5"
        title="PII avoidance"
        summary="User-submitted strings evaluated ephemerally by default. Stored evaluations are hashed."
      >
        <ul className="ml-5 list-disc space-y-2">
          <li>
            User text submitted to the engine is evaluated and then
            discarded by default. The evaluation result returns; the
            text doesn&apos;t persist.
          </li>
          <li>
            When evaluations ARE stored (logged violations, team
            analytics), the text is replaced with its sha256 hash
            before it touches the database. Raw strings never reach
            disk.
          </li>
          <li>
            The override dataset (what informs future rule calibration)
            carries no user identity. Only the actor&apos;s
            role-bucket (designer / engineer / PM / other) rides along
            for signal weighting. The dataset gets curated by hand
            into refinement candidates, never absorbed by an automated
            training pipeline; see{" "}
            <Link href="/about" className="underline underline-offset-2">
              how customer interactions improve the model
            </Link>{" "}
            for the loop.
          </li>
        </ul>
      </Section>

      <Section
        number="6"
        title="Customer, not product"
        summary="ContentRX makes money by charging for a tool. Not by selling, repackaging, or modeling the work you check."
      >
        <p>
          The subscription is the entire revenue model. Free exists so
          you can try the product; paid tiers exist because the engine
          costs real money to run and the calibration work takes real
          time. There&apos;s no second shoe to drop. The line I
          won&apos;t cross to make up the difference, in plain language:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            I don&apos;t sell your strings (hashed, anonymised, or
            otherwise) to data brokers, advertisers, or anyone else.
            There is no third-party broker contract; there will not be
            one.
          </li>
          <li>
            I don&apos;t repackage your check history into a profile
            of you, your team, or your industry that gets marketed
            against you. Your dashboard shows your activity to you;
            no aggregate &ldquo;intent signal&rdquo; product gets sold
            on top.
          </li>
          <li>
            I don&apos;t use your content to train a model (mine,
            Anthropic&apos;s, anyone&apos;s) without your explicit,
            per-entry opt-in. The Team-plan custom-example contribution
            toggle is the only path by which a customer string ever
            joins the calibration corpus. It&apos;s off by default,
            and it&apos;s a per-entry toggle, not a one-time
            account-wide setting.
          </li>
          <li>
            I don&apos;t share your strings with any third party
            beyond the subprocessors named in the{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              privacy policy
            </Link>
            . Each one has a defined purpose; if I add one, the list
            updates within 30 days and I post about it.
          </li>
          <li>
            I don&apos;t run an &ldquo;engagement metrics&rdquo; or
            behavioural-modelling layer on how you use ContentRX. I
            track monthly check counts (because billing) and crash
            reports (because bugs). Nothing else.
          </li>
        </ul>
        <p className="mt-3">
          The commitment is backed by code, not just policy. Every
          public route that takes a string runs a pre-screen that
          refuses obvious credentials and PII (credit card numbers,
          SSNs, Stripe / OpenAI / Anthropic / GitHub keys, AWS access
          keys). Those values never reach the engine, never reach
          Anthropic, never reach the error logs. Sentry events have
          request bodies and auth headers stripped before send. Vercel
          function logs use a hand-shaped error format that omits
          transitive properties of SDK errors (which sometimes carry
          the request payload). The hardening is in{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-900">
            src/lib/pii-screen.ts
          </code>
          ,{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-900">
            src/lib/sentry-scrub.ts
          </code>
          , and{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11px] dark:bg-stone-900">
            src/lib/safe-error-log.ts
          </code>{" "}
          if you want to verify against the source.
        </p>
        <p className="mt-3">
          If any of this ever changes (say a future investor pitches
          &ldquo;but think of the data&rdquo;) the policy here gets
          superseded by an ADR I publish before any new collection
          starts, and existing customers are notified by email. The
          version of this commitment that&apos;s live is always the
          one at /ethics. If there&apos;s no superseding ADR linked
          from this page, the rules above are the rules.
        </p>
      </Section>

      <section className="mt-12 rounded-lg border border-stone-300 bg-stone-50 p-6 text-sm dark:border-stone-700 dark:bg-stone-900">
        <h2 className="text-base font-semibold">How to opt out</h2>
        <p className="mt-2 text-stone-700 dark:text-stone-300">
          If you maintain a project and don&apos;t want ContentRX to
          train on it, email{" "}
          <a
            href={`mailto:${OPT_OUT_EMAIL}?subject=${encodeURIComponent(OPT_OUT_SUBJECT)}`}
            className="underline underline-offset-2"
          >
            {OPT_OUT_EMAIL}
          </a>{" "}
          with subject <code className="font-mono">{OPT_OUT_SUBJECT}</code>.
          Include the repo URL or style-guide URL you&apos;re speaking
          for. No justification required.
        </p>
        <p className="mt-3 text-stone-700 dark:text-stone-300">
          The commitment on my side: confirm receipt within a week,
          stop fresh crawls in the next cycle, and best-effort remove
          already-derived signal in the release that follows.
        </p>
      </section>

      <footer className="mt-16 text-xs text-stone-500 dark:text-stone-400">
        <p>
          Last updated 2026-04-23. This page lives under the ContentRX
          main site at <code className="font-mono">contentrx.io/ethics</code>
          . Source:{" "}
          <a
            href="https://github.com/thenewforktimes/contentRX/blob/main/src/app/ethics/page.tsx"
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
    <section className="mt-8 border-t border-stone-200 pt-8 first:border-t-0 first:pt-0 dark:border-stone-800">
      <p className="text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400">
        Commitment {number}
      </p>
      <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm italic text-stone-600 dark:text-stone-400">
        {summary}
      </p>
      <div className="mt-4 text-sm text-stone-700 dark:text-stone-300">
        {children}
      </div>
    </section>
  );
}
