/**
 * /about — "about the model" page featuring Robert's content-design
 * background.
 *
 * 2026-05-05 rewrite per Robert's audit:
 *   - Drop "Who wrote the model" repeat of the home bio; tighten to a
 *     single section that goes straight to the moat argument
 *     ("Why one designer's judgment"), no company-list repetition.
 *   - Polish "Why the model stays honest" to Robert's voice (plainer,
 *     first-person where natural, drops the dense kappa sentence).
 *   - Drop "Why this isn't the layer you already have" — defensive
 *     positioning; "What a content designer sees" already does the
 *     work by example.
 *   - Drop "One approval, not three" — promoted to the home page as
 *     part of the new "Built for your stack" section.
 *   - Drop "How to disagree" — mechanics belong on dashboard help,
 *     not the trust page.
 *   - Sweep "moments" → "context" customer-facing per Robert's call
 *     that `moment` is reserved internal vocab for the human-eval/
 *     training layer.
 *
 * The voice on /about is Robert's first-person voice — this is the
 * trust page, the named-expert moat made explicit.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { AuthorBlock } from "@/components/author-block";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "About the model. ContentRX",
  description:
    "The content model behind ContentRX. Who wrote it, what it's calibrated against, and why context-aware review is a different job than grammar-checking.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <PageHeader
        eyebrow="About the model"
        title="What a content designer sees"
        lede={
          <>
            ContentRX is the content model that a working staff content
            designer would run on his own UI writing. The standards, the
            context, the weighting system that says &ldquo;in a
            destructive confirmation, emphasize the consequence; in an
            onboarding flow, relax the tone.&rdquo; All of it carries
            one designer&apos;s judgment calls, attributed and published.
          </>
        }
      />

      <Section title="What the model actually reads">
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
          Those three questions aren&apos;t in a grammar
          checker&apos;s job description. They are in
          ContentRX&apos;s. They drive standards on voice in error
          recovery, on specific verbs over generic affirmatives, and
          on plain language matched to the audience.
        </p>
      </Section>

      <Section title="Why one designer&rsquo;s judgment">
        <p>
          The rules you can look up in any style guide. The judgment
          calls about <em>whether a modal needed to exist at all</em>{" "}
          get built over a career of reviewing writing, and they&apos;re
          what the model encodes.
        </p>
        <p className="mt-3">
          Every standard, every weight, every override is a
          distillation of a live review where I said{" "}
          <q>that button shouldn&apos;t say <code>Submit</code>, it
          should say what happens next.</q> The{" "}
          <Link
            href="/ethics#no-stolen-content"
            className="underline underline-offset-2"
          >
            influences I lean on
          </Link>
          {" "}sit on /ethics, with the opt-out path. The judgment
          between them is mine.
        </p>
      </Section>

      <Section title="Why the model stays honest">
        <p>
          The hardest part of a content model isn&apos;t the rules.
          Those can be looked up in any style guide. It&apos;s the{" "}
          <em>weighting</em>: which standards matter most in which
          context, and why. That&apos;s what a content designer
          builds over a career, and it&apos;s what makes the model
          worth calibrating.
        </p>
        <p className="mt-3">
          Every Monday the measured accuracy lands on{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          {" "}with its 95% confidence interval. When the measurement
          diverges from the design target, the thresholds move with
          the measurement, not with the target. Every verdict I
          dismiss as &ldquo;the standard doesn&apos;t apply
          here&rdquo; feeds the override signal, and the{" "}
          <Link href="/calibration" className="underline underline-offset-2">
            calibration log
          </Link>
          {" "}publishes the movement, in the open.
        </p>
      </Section>

      <Section title="How customer interactions improve the model">
        <p>
          Every time you flag a verdict as wrong (or accept one that
          almost wasn&apos;t), that signal lands in the refinement
          log I read each week. Patterns get curated by hand, not
          absorbed by a training pipeline.
        </p>
        <p className="mt-3">
          The distinction matters. Training averages everyone&apos;s
          strings into a black box; calibration is one editor reading
          patterns and making judgment calls. The model gets better
          because a content designer is doing the work, not because
          your strings became someone else&apos;s data. You can read
          what changed and why on the{" "}
          <Link href="/calibration" className="underline underline-offset-2">
            weekly log
          </Link>
          .
        </p>
      </Section>

      {/* Named-byline closer. The page is "about the model"; the
          model is one designer's judgment. Closing on the byline
          binds the claim to the named author.

          2026-05-11: AuthorBlock simplified to a single card render
          (compact variant cut after the landing dropped its byline).
          /about and /accuracy are the two surfaces where the byline
          earns its place. */}
      <div className="mt-16">
        <AuthorBlock />
      </div>
    </main>
  );
}
