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
 * says "copy is in Robo's voice" — Robo will edit; this version
 * exists to ship the commitments, not the prose.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ethics — ContentRX",
  description:
    "How ContentRX collects, attributes, and uses external signal — five public commitments, plus the opt-out path.",
};

const OPT_OUT_EMAIL = "hello@contentrx.io";
const OPT_OUT_SUBJECT = "[OPTOUT] <source name>";

export default function EthicsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          ContentRX ethical framework
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          How I collect, attribute, and use external signal
        </h1>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          ContentRX learns from public sources — design systems, style
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
          crawl timestamp, the license, and how the source contributed
          — moment weights, standard influences, examples corpus, or
          training signal. Hidden contributions would be indistinguishable
          from theft; the page is the accountability surface.
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
          from a public source, the source is named inline — with a
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
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
            contentrx-research-bot
          </code>{" "}
          with a contact URL in the user-agent string. It honors
          robots.txt. It rate-limits requests so no host sees ContentRX
          as a spike. Projects that ask to be excluded are excluded —
          and signal already derived from them is removed from
          subsequent training.
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
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">
            {OPT_OUT_SUBJECT}
          </code>
          . I confirm receipt within a week and land the removal in the
          following release cycle. If you haven&apos;t heard back within
          seven days, email again — something went wrong with the
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
            Permissive licenses — MIT, Apache 2.0, BSD, CC-BY — are
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
            The override dataset — what informs future rule calibration
            — carries no user identity. Only the actor&apos;s
            role-bucket (designer / engineer / PM / other) rides along
            for signal weighting.
          </li>
        </ul>
      </Section>

      <section className="mt-12 rounded-lg border border-neutral-300 bg-neutral-50 p-6 text-sm dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-base font-semibold">How to opt out</h2>
        <p className="mt-2 text-neutral-700 dark:text-neutral-300">
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
        <p className="mt-3 text-neutral-700 dark:text-neutral-300">
          The commitment on my side: confirm receipt within a week,
          stop fresh crawls in the next cycle, and best-effort remove
          already-derived signal in the release that follows.
        </p>
      </section>

      <footer className="mt-16 text-xs text-neutral-500">
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
    <section className="mt-8 border-t border-neutral-200 pt-8 first:border-t-0 first:pt-0 dark:border-neutral-800">
      <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
        Commitment {number}
      </p>
      <h2 className="mt-2 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm italic text-neutral-600 dark:text-neutral-400">
        {summary}
      </p>
      <div className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
        {children}
      </div>
    </section>
  );
}
