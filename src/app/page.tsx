/**
 * Landing page — human-eval build plan Session 25.
 *
 * Replaces the Session-0 placeholder with positioning copy structured
 * around the two wedges the plan names:
 *
 *   1. Situation-aware review — ContentRX holds the moment context that
 *      engineers and PMs without content-design training can't hold.
 *   2. Judgment calls — senior-content-designer pattern recognition
 *      encoded, not a rule book.
 *
 * Plus a sharp Grammarly/LanguageTool/Alex contrast, the Stripe Radar
 * frame for "the model IS the product," and links to the accountability
 * surface (/accuracy, /sources, /ethics) — the taxonomy itself is
 * private per ADR 2026-04-25; the public surface is the kappa story
 * and the calibration log, not /model.
 *
 * Voice note for Robo: this draft is in my voice. Prose is editable;
 * the structure + the five sections matter for the acceptance
 * criterion. Copy that changes the wedge will also need /about edits.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "ContentRX — the content model for product copy",
  description:
    "Situation-aware review for error states, destructive confirmations, permissions flows, and the other moments where copy stops being decoration and starts being the product.",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <header>
        <Eyebrow>ContentRX</Eyebrow>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          The content model for product copy.
        </h1>
        <p className="mt-6 text-lg text-neutral-700 dark:text-neutral-300">
          Situation-aware review for the moments where copy stops being
          decoration and starts being the product — error states, empty
          states, permissions flows, destructive confirmations, compliance
          disclosures. A senior content designer&apos;s pattern recognition,
          running where product copy is increasingly written:{" "}
          <strong>Claude Code, Cursor, your CLI, and every pull request</strong>
          {" "}— with the Figma plugin alongside for design-time checks.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <Link href="/sign-up" className={buttonStyles({ variant: "primary" })}>
            Try free →
          </Link>
          <Link
            href="/install"
            className={buttonStyles({ variant: "secondary" })}
          >
            Install instructions
          </Link>
          <Link
            href="/pricing"
            className={buttonStyles({ variant: "secondary" })}
          >
            Pricing
          </Link>
          <Link href="/sign-in" className={buttonStyles({ variant: "ghost" })}>
            Sign in →
          </Link>
        </div>
      </header>

      <Section eyebrow="Wedge 1" title="Situation-aware review">
        <p>
          Most UI copy is fine. The stakes are concentrated in a
          handful of moments: an error message that tells the user
          what went wrong and what to do next; a destructive
          confirmation that names the thing being destroyed; a
          permissions button that asks for access instead of
          declaring submission; an empty state that points somewhere
          useful.
        </p>
        <p className="mt-3">
          Engineers and PMs without content-design training can&apos;t
          hold all that context in their heads while they&apos;re
          shipping features. ContentRX holds it for them. It knows
          that the same sentence reads differently in a destructive
          confirmation than on a feature browse page, and applies
          the standards that match the moment it detected.
        </p>
      </Section>

      <Section eyebrow="Wedge 2" title="Judgment calls, not rule books">
        <p>
          A senior content designer looks at an error message and
          sees whether it owns the failure or blames the user.
          That&apos;s not a rule you can look up in a style guide
          — it&apos;s pattern recognition built from years of
          practice. ContentRX encodes that pattern recognition.
          The evaluation chain publishes{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            its own accuracy
          </Link>
          {" "}with confidence intervals and no composite score.
        </p>
      </Section>

      <Section
        eyebrow="Sharp contrast"
        title="Not the layer Grammarly / LanguageTool / Alex already cover"
      >
        <p>
          Those tools check that your sentence is grammatical and
          inclusive. Excellent at what they do. ContentRX checks a
          different thing: that your error message <em>shouldn&apos;t
          be an error message at all</em>; that your destructive
          confirmation names what will be destroyed; that your
          permissions button says <code>Request access</code> and not{" "}
          <code>Submit</code>.
        </p>
        <p className="mt-3">
          You can run both. The layers don&apos;t compete — they stack.
        </p>
      </Section>

      <Section
        eyebrow="The Stripe Radar frame"
        title="The model is the product"
      >
        <p>
          Stripe Radar is a model. Stripe sells the model — the rules
          engineers write on top are secondary; the learned patterns
          from every transaction Stripe has ever seen are the moat.
        </p>
        <p className="mt-3">
          ContentRX is a model. We sell the model.{" "}
          <Link href="/sources" className="underline underline-offset-2">
            Every source that shaped it
          </Link>
          {" "}is named with its license and opt-out path;{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            calibration
          </Link>
          {" "}is reported honestly with 95% CIs and no composite
          headline. The rules you can disable per team;{" "}
          <Link href="/ethics" className="underline underline-offset-2">
            the commitments
          </Link>
          {" "}you can&apos;t.
        </p>
      </Section>

      <Section eyebrow="Surfaces" title="Runs at the generation layer">
        <p>
          Content-standards enforcement is moving upstream.
          Engineers write product copy in the IDE now; PRs carry
          more strings than design files; LLMs draft the first pass
          before a content designer sees it. ContentRX meets that
          reality by leading with the surfaces where copy is
          actually written today, with the Figma plugin alongside
          for design-time checks.
        </p>
        <ul className="mt-4 ml-5 list-disc space-y-2">
          <li>
            <strong>MCP server</strong> — Claude Code, Cursor, and
            any MCP client call <code>evaluate_copy</code>,{" "}
            <code>classify_moment</code>, and the standards catalog
            directly. Inline content review during generation, not
            after.{" "}
            <Link href="/install#mcp" className="underline underline-offset-2">
              Install
            </Link>
            .
          </li>
          <li>
            <strong>CLI</strong> —{" "}
            <code>contentrx &quot;Click here&quot;</code> or{" "}
            <code>--batch strings.txt</code>. <code>--explain</code>{" "}
            prints the full rationale chain. Stdlib-only install.{" "}
            <Link href="/install#cli" className="underline underline-offset-2">
              Install
            </Link>
            .
          </li>
          <li>
            <strong>GitHub Action</strong> — evaluates strings touched
            in a pull request. <code>fail-on: review</code> gates
            the merge on review-recommended verdicts. Drops into
            any repo with a YAML snippet.{" "}
            <Link href="/install#action" className="underline underline-offset-2">
              Install
            </Link>
            .
          </li>
          <li>
            <strong>Figma plugin</strong> — design-time check.
            Scan a frame, per-string verdicts with moment banners
            and rationale chains. Three-button stance per finding
            (Agree / Disagree / Ship anyway). Best for the copy
            that comes in through design, not code.{" "}
            <Link href="/install#figma" className="underline underline-offset-2">
              Install
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section eyebrow="About the voice" title="Built by a content designer">
        <p>
          ContentRX is the content model that Robo — a senior content
          designer — would run on their own work. The moments, the
          weights, and the standards all carry one designer&apos;s
          judgment calls, attributed and published. Read the{" "}
          <Link href="/about" className="underline underline-offset-2">
            about-the-model
          </Link>
          {" "}page for the longer story.
        </p>
      </Section>

      <footer className="mt-16 border-t border-neutral-200 pt-8 text-sm text-neutral-500 dark:border-neutral-800">
        <p>
          The accountability surface:{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>{" "}
          ·{" "}
          <Link href="/pricing" className="underline underline-offset-2">
            /pricing
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
