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
import { Eyebrow } from "@/components/ui/eyebrow";
import { Section } from "@/components/ui/section";

/**
 * Placeholder string for Robo's bio — intentionally bracketed so the
 * copy-pin test in `src/app/page.test.ts` fails if this ships
 * unedited. Replace with 1–3 sentences in Robo's voice. Keep the
 * leading `{bio:` and trailing `}` for the test to recognise it as
 * intentional rather than accidental.
 */
const PLACEHOLDER_BIO =
  "{bio: years shipping product copy, notable teams or companies, anything Robo wants surfaced here. Brackets make this block fail the copy-pin test until edited}";

export const metadata: Metadata = {
  title: "About the model. ContentRX",
  description:
    "The content model behind ContentRX. Who wrote it, what it's calibrated against, and why moment-aware review isn't the job Grammarly is doing.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <header className="mb-12">
        <Eyebrow>About the model</Eyebrow>
        <h1 className="mt-3 text-3xl font-semibold">
          What a content designer sees
        </h1>
        <p className="mt-4 text-lg text-neutral-700 dark:text-neutral-300">
          ContentRX is the content model that a working senior content
          designer would run on their own UI copy. The standards,
          the moments, the weighting system that says &ldquo;in a
          destructive confirmation, emphasize the consequence; in an
          onboarding flow, relax the tone.&rdquo; All of it carries
          one designer&apos;s judgment calls, attributed and published.
        </p>
      </header>

      <Section title="Who wrote the model">
        <p>
          Robo, a senior content designer. {PLACEHOLDER_BIO} The pattern
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
          leaned on.
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
            next action is a dead end. <q>Try reloading. If it keeps
            happening, let us know at support@example.com.</q> closes
            the loop.
          </li>
        </ul>
        <p className="mt-3">
          Those three questions aren&apos;t in Grammarly&apos;s job
          description. They are in ContentRX&apos;s. They drive standards
          on voice in error recovery, on specific verbs over generic
          affirmatives, and on plain language matched to the audience.
        </p>
      </Section>

      <Section title="Why the model stays honest">
        <p>
          The hardest part of a content model isn&apos;t the rules. Those
          can be looked up in any style guide. It&apos;s the{" "}
          <em>weighting</em>: which standards matter most in which
          moment, and why. That&apos;s what a content designer builds
          over a career, and it&apos;s what makes the model worth
          calibrating.
        </p>
        <p className="mt-3">
          Every weekly kappa measurement lands on{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          {" "}with its own confidence interval; when measured ceiling
          diverges from the design target, thresholds move with the
          measurement, not with the target. The model gets better every
          time Robo dismisses a verdict as &ldquo;the standard doesn&apos;t
          apply here.&rdquo; The{" "}
          <Link href="/dashboard/overrides" className="underline underline-offset-2">
            override signal
          </Link>
          {" "}feeds back into calibration, and the weekly{" "}
          <Link href="/calibration" className="underline underline-offset-2">
            calibration log
          </Link>
          {" "}publishes the movement.
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

      <Section title="One approval, not three">
        <p>
          Most teams can&apos;t get an AI provider approved fast enough
          to keep up with how product copy is changing. Engineers got
          Cursor. Content designers are still waiting on the
          procurement conversation, the security review, the AI policy
          committee. Six months in, the work has shipped without them.
        </p>
        <p className="mt-3">
          ContentRX is one approval away. A $29-a-month SaaS tool, not
          another LLM relationship to negotiate. No Anthropic or OpenAI
          key required from you or your org. No second vendor agreement.
          The senior content-design judgment your team needs, abstracted
          behind a subscription your team can actually buy.
        </p>
        <p className="mt-3">
          Layoffs hit content design hard. The senior people who knew
          how to mentor are often gone; the writers who remain don&apos;t
          have access to the tools that could partially backfill. This
          is the workaround for the people in that gap, while the work
          itself can&apos;t wait.
        </p>
      </Section>

      <Section title="How to disagree with the model">
        <p>
          Every finding ships with the rationale that produced it: the
          rule that fired, the moment it fired in, and a confidence
          score. If you read all of that and the verdict is still wrong,
          there are two paths:
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-2">
          <li>
            <strong>Disagree with this finding.</strong> Every finding
            has a three-button stance (agree / disagree / ship anyway)
            that captures your override for team-level analytics and,
            at scale, feeds the calibration log.
          </li>
          <li>
            <strong>Correct the moment.</strong> If the tool read your
            string as a destructive confirmation when you were writing
            a first-encounter, the moment banner has a picker that
            routes the correction back into calibration.
          </li>
        </ul>
        <p className="mt-4">
          Both paths land in the same place: the weekly{" "}
          <Link href="/calibration" className="underline underline-offset-2">
            calibration log
          </Link>
          {" "}where the movement gets reported in the open.
        </p>
      </Section>

      <footer className="mt-16 border-t border-neutral-200 pt-8 text-sm text-neutral-500 dark:border-neutral-800">
        <p>
          Keep reading:{" "}
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
