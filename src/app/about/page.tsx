/**
 * /about — "about the model" page featuring Robo's content-design
 * background.
 *
 * Human-eval build plan Session 25. The voice matters here more than
 * anywhere else on the site — this is the "why trust the moments"
 * page. The structure is:
 *
 *   1. Who wrote the model and what they'd put on their own work.
 *   2. What a content designer sees that a generic linter can't.
 *   3. Why the model is public and how it stays honest.
 *
 * Voice note for Robo: these sentences are in my voice. Every paragraph
 * here is edit-in-place safe — no routes, no data. Personal details
 * are bracketed placeholders (e.g. `{years of shipping copy}`) so the
 * test fails if the page ships with them unfilled.
 */

import type { Metadata } from "next";
import Link from "next/link";

/**
 * Placeholder string for Robo's bio — intentionally bracketed so the
 * copy-pin test in `src/app/page.test.ts` fails if this ships
 * unedited. Replace with 1–3 sentences in Robo's voice. Keep the
 * leading `{bio:` and trailing `}` for the test to recognise it as
 * intentional rather than accidental.
 */
const PLACEHOLDER_BIO =
  "{bio: years shipping product copy, notable teams or companies, anything Robo wants surfaced here — brackets make this block fail the copy-pin test until edited}";

export const metadata: Metadata = {
  title: "About the model — ContentRX",
  description:
    "The content model behind ContentRX — who wrote it, what it's calibrated against, and why moment-aware review isn't the job Grammarly is doing.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <header className="mb-12">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          About the model
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          What a content designer sees
        </h1>
        <p className="mt-4 text-lg text-neutral-700 dark:text-neutral-300">
          ContentRX is the content model that a working senior content
          designer would run on their own UI copy. The 47 standards,
          the 13 moments, the weighting system that says &ldquo;in a
          destructive confirmation, emphasize the consequence; in a
          first-encounter, relax the tone&rdquo; — all of it carries
          one designer&apos;s judgment calls, attributed and published.
        </p>
      </header>

      <Section title="Who wrote the model">
        <p>
          Robo — a senior content designer. {PLACEHOLDER_BIO} The pattern
          recognition that gets built over a career of that work is what
          the model encodes. The rules you can look up in a style guide
          are one input; the judgment calls about{" "}
          <em>whether a modal needed to exist at all</em> are a different
          input, and they&apos;re what the model is really for.
        </p>
        <p className="mt-3">
          None of the moments or weights are inventions. Every one of
          them is a distillation of a live review where a content
          designer said &ldquo;that button shouldn&apos;t say{" "}
          <code>Submit</code>, it should say what happens next.&rdquo;
          The{" "}
          <Link href="/sources" className="underline underline-offset-2">
            /sources
          </Link>
          {" "}page lists every style guide and OSS repo the model
          leaned on; the{" "}
          <Link href="/model/changelog" className="underline underline-offset-2">
            changelog
          </Link>
          {" "}shows every revision as it happens.
        </p>
      </Section>

      <Section title="What a content designer sees">
        <p>
          Take an error message that reads:{" "}
          <q>An unexpected error occurred.</q>
        </p>
        <p className="mt-3">
          A grammar linter reads this as a fine sentence. A content
          designer reads it and asks three things:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>Does it own the failure?</strong> &ldquo;An
            unexpected error&rdquo; is passive about something the system
            did. <q>We couldn&apos;t load your dashboard.</q> names the
            actor and names the specific failure.
          </li>
          <li>
            <strong>Does it blame the user?</strong> &ldquo;Invalid
            input&rdquo; tells the user they did something wrong.{" "}
            <q>We didn&apos;t recognize that email format.</q> describes
            the state without assigning fault.
          </li>
          <li>
            <strong>Does it point somewhere?</strong> An error without a
            next action is a dead end. <q>Try reloading — if it keeps
            happening, let us know at support@example.com.</q> closes
            the loop.
          </li>
        </ul>
        <p className="mt-3">
          Those three questions aren&apos;t in Grammarly&apos;s job
          description. They are in ContentRX&apos;s. The same three
          questions drive{" "}
          <Link href="/model/standards/VT-05" className="underline underline-offset-2">
            VT-05
          </Link>
          {" "}(voice in error recovery),{" "}
          <Link href="/model/standards/ACT-01" className="underline underline-offset-2">
            ACT-01
          </Link>
          {" "}(specific verbs over generic affirmatives), and{" "}
          <Link href="/model/standards/CLR-01" className="underline underline-offset-2">
            CLR-01
          </Link>
          {" "}(plain language, matched to the audience).
        </p>
      </Section>

      <Section title="Why the model is public">
        <p>
          The moat isn&apos;t the rules. The rules are visible — 47 of
          them, each with a permalink, pass/fail examples, applicable
          content types, and a version history. Anyone can read the
          taxonomy, and anyone can disagree with a specific call.
        </p>
        <p className="mt-3">
          What&apos;s harder to replicate is the{" "}
          <em>weighting</em> — which standards get emphasized in which
          moment, and why. That&apos;s what a content designer builds
          over a career, and it&apos;s what{" "}
          <Link href="/model" className="underline underline-offset-2">
            /model
          </Link>
          {" "}makes browsable. The model gets better every time Robo
          dismisses a verdict as &ldquo;the standard doesn&apos;t apply
          here&rdquo; — the{" "}
          <Link href="/dashboard/overrides" className="underline underline-offset-2">
            override signal
          </Link>
          {" "}feeds back into calibration. And every weekly kappa
          measurement lands on{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          {" "}with its own confidence interval; when measured ceiling
          diverges from the design target, thresholds move with the
          measurement, not with the target.
        </p>
      </Section>

      <Section title="Why this isn't the layer you already have">
        <p>
          Grammarly checks grammar. LanguageTool checks grammar plus
          style. Alex checks inclusive language. They&apos;re all
          excellent at what they do, and running ContentRX on top of
          any of them is expected, not redundant.
        </p>
        <p className="mt-3">
          ContentRX is checking a different thing: that a{" "}
          <em>destructive confirmation names what will be destroyed,
          that a permissions button asks for access instead of declaring
          submission, that an empty state points somewhere.</em> None of
          those are grammatical errors. All of them are content-design
          errors. A different job, a different model.
        </p>
      </Section>

      <Section title="How to disagree with the model">
        <p>
          If you run ContentRX and the verdict is wrong, there are
          three paths:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>Disagree with this finding</strong> — per-violation
            three-button stance captures your override for team-level
            analytics and, at scale, moves the standard&apos;s calibration.
          </li>
          <li>
            <strong>Correct the moment</strong> — if the tool detected{" "}
            <code>destructive_action</code> when you were writing a
            first-encounter, the moment banner has a picker that routes
            your correction into the moment-classifier backlog.
          </li>
          <li>
            <strong>Expand the rationale chain</strong> — every verdict
            ships with its full pipeline, hop by hop, with confidence at
            each step. Upstream misdetection is a one-click feedback
            path; you shouldn&apos;t have to guess which hop went sideways.
          </li>
        </ul>
      </Section>

      <footer className="mt-16 border-t border-neutral-200 pt-8 text-sm text-neutral-500 dark:border-neutral-800">
        <p>
          Keep reading:{" "}
          <Link href="/model" className="underline underline-offset-2">
            /model
          </Link>{" "}
          ·{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>{" "}
          ·{" "}
          <Link href="/sources" className="underline underline-offset-2">
            /sources
          </Link>{" "}
          ·{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            /ethics
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 border-t border-neutral-200 pt-8 first:border-t-0 first:pt-0 dark:border-neutral-800">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-4 space-y-0 text-base text-neutral-700 dark:text-neutral-300">
        {children}
      </div>
    </section>
  );
}
