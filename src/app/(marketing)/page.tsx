/**
 * Landing page — 2026-04-29 rewrite.
 *
 * Robert's brief (the previous landing's failure modes):
 *   - "Content model for product copy" was narrowing the market
 *     more than it was helping. The brand promise is staff-level
 *     content design review, in every repo.
 *   - The destructive-confirmation / error-message examples were
 *     the kind of thing a style guide would cover, so they didn't
 *     land as differentiators.
 *   - The "judgment calls, not rule books" frame implicitly
 *     disrespected style guides. The real story is that
 *     ContentRX takes the work of managing and enforcing the
 *     rules out of the human's hands, not that the rules don't
 *     matter.
 *   - The Grammarly contrast and Stripe Radar frame were earning
 *     no real estate. Cut.
 *   - "Built by a content designer" needed the org callouts —
 *     Intuit, Meta, Opendoor, PayPal — to anchor the named-expert
 *     positioning.
 *
 * New section order:
 *   1. Hero — the brand promise, in the headline.
 *   2. What it does — situation-aware review framed as "the
 *      style guide you don't have to update."
 *   3. Why it works — the work without the maintenance.
 *   4. How it works — animated five-stage pipeline diagram.
 *      The model around the model is the moat in visual form.
 *   5. Where it runs — surfaces, condensed.
 *   6. Built by — Robert Ballard, with the org arc.
 *
 * Voice: per docs/copy-vocabulary.md. Calm, confident, charming.
 * No em dashes. Names the actor. Doesn't blame the reader. Points
 * at concrete surfaces (PR, IDE, CLI) over abstract value.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HowItWorksDiagram } from "@/components/how-it-works-diagram";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "ContentRX. Staff-level content design review, in every repo",
  description:
    "ContentRX reads the strings you ship with the judgment of a staff content designer. Verdict, suggestion, rationale. In your pull request, your IDE, and your Figma file, before the next review cycle.",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <header>
        <Eyebrow>ContentRX</Eyebrow>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Staff-level content design review in every repo
        </h1>
        <p className="mt-6 text-lg text-stone-700 dark:text-stone-300">
          ContentRX reads the strings you ship with the judgment of a
          staff content designer. Verdict, suggestion, rationale, in
          your pull request, your IDE, and your Figma file. Before the
          next review cycle, before merge.
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

      <Section
        eyebrow="What it does"
        title="A style guide you don't have to update."
      >
        <p>
          Style guides go stale. Voice docs live in a Notion that no
          one can find. The judgment calls about how your product
          should sound are real, and they matter, but they don&apos;t
          show up in the moment you need them. Not at 4pm on Friday
          when you&apos;re typing a button label.
        </p>
        <p className="mt-3">
          ContentRX is the content design voice in the room when you
          don&apos;t have a content designer at the table. It reads
          what you wrote, recognises the moment you&apos;re writing
          for, and applies the standards that match. The same sentence
          reads differently in a destructive confirmation than on a
          marketing page. ContentRX knows which one you&apos;re in.
        </p>
      </Section>

      <Section
        eyebrow="Why it works"
        title="The work without the maintenance."
      >
        <p>
          Style guides exist for good reason. The rules are real:
          don&apos;t blame the user, name the consequence in a
          destructive confirmation, write CTAs as action verbs. None
          of this is news. The problem has never been that the rules
          don&apos;t exist. The problem is keeping them current,
          finding them when you&apos;re shipping, and applying them
          consistently across everyone writing strings. Engineers,
          PMs, content designers, the LLM that just drafted the
          first pass.
        </p>
        <p className="mt-3">
          ContentRX bakes the rules into the workflow. By the time
          you finish typing an error message, ContentRX has read
          every error message in your repo and knows which voice
          you ship in. Every verdict carries a rationale chain so
          you can see the read.
        </p>
        <p className="mt-3">
          And because the model is the product, the model is
          accountable. Measured accuracy lives at{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>
          . Drift gets reported in the weekly{" "}
          <Link
            href="/calibration"
            className="underline underline-offset-2"
          >
            /calibration
          </Link>
          {" "}log.
        </p>
      </Section>

      <Section
        eyebrow="How it works"
        title="The model around the model."
      >
        <p>
          ContentRX isn&apos;t an LLM with a prompt. It&apos;s a
          content-design pipeline that gives the LLM the context it
          needs to render a real judgment. The classifier reads the
          moment. The filter narrows the standards down to the ones
          that apply. The reviewer evaluates against those standards
          with patterns built over years of practice. The validator
          checks the work. The merger compresses everything into a
          single envelope: issue, suggestion, severity, confidence.
        </p>
        <HowItWorksDiagram />
      </Section>

      <Section eyebrow="Where it runs" title="Where you ship copy.">
        <p>
          Content review is moving upstream. PRs carry more strings
          than design files. LLMs draft the first pass before a
          content designer sees it. ContentRX leads with the
          surfaces where copy gets written today.
        </p>
        <ul className="mt-4 ml-5 list-disc space-y-2">
          <li>
            <strong>MCP server</strong> for Claude Code, Cursor, and
            any MCP client. Inline review during generation, not
            after.{" "}
            <Link
              href="/install#mcp"
              className="underline underline-offset-2"
            >
              Install
            </Link>
            .
          </li>
          <li>
            <strong>CLI</strong> for the terminal and CI.{" "}
            <code>contentrx &quot;Click here&quot;</code> or{" "}
            <code>--batch strings.txt</code>. <code>--explain</code>{" "}
            prints the rationale chain. Stdlib-only install.{" "}
            <Link
              href="/install#cli"
              className="underline underline-offset-2"
            >
              Install
            </Link>
            .
          </li>
          <li>
            <strong>GitHub Action</strong> that evaluates strings
            touched in a pull request. <code>fail-on: review</code>{" "}
            gates merge on review-recommended verdicts.{" "}
            <Link
              href="/install#action"
              className="underline underline-offset-2"
            >
              Install
            </Link>
            .
          </li>
          <li>
            <strong>LSP</strong> for VS Code, Zed, and any LSP
            editor. Verdicts as diagnostics, inline.{" "}
            <Link
              href="/install#lsp"
              className="underline underline-offset-2"
            >
              Install
            </Link>
            .
          </li>
          <li>
            <strong>Figma plugin</strong> for design-time review.
            Per-string verdicts with moment banners and rationale
            chains.{" "}
            <Link
              href="/install#figma"
              className="underline underline-offset-2"
            >
              Install
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section eyebrow="Built by" title="Someone who has been in the room.">
        <p>
          Robert Ballard, staff content designer at PayPal. Previously
          Intuit, Meta, and Opendoor. The moments, the weights, and
          the standards all carry a single designer&apos;s judgment
          calls, attributed and published. Read the{" "}
          <Link href="/about" className="underline underline-offset-2">
            about-the-model
          </Link>
          {" "}page for the longer story.
        </p>
      </Section>
    </main>
  );
}
