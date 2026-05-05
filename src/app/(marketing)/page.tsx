/**
 * Landing page — 2026-05-05 IA refresh.
 *
 * Robert's brief on this pass: lead the founder credit with the
 * staff-content-designer claim (not the name); promote the One
 * approval value prop out of /about and onto home as part of a new
 * four-card "Built for your stack" section that surfaces Privacy,
 * Security, One approval, and Integrations together; scrub "moments"
 * everywhere customer-facing — `moment` is reserved internal vocab
 * for the human-eval/training layer.
 *
 * Section order:
 *   1. Hero — the brand promise.
 *   2. How it works — animated pipeline carries the explanation.
 *   3. Where it runs — surfaces.
 *   4. Built for your stack — One approval / Privacy / Security /
 *      Integrations as a 2x2 card grid.
 *   5. Built by — Robert Ballard, with the org arc.
 *   6. Why it works — three product-strength cards. Closer.
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
        <p className="mt-6 text-lg text-default">
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
        eyebrow="How it works"
        title="The model around the model."
      >
        <p>
          ContentRX isn&apos;t an LLM with a prompt. It&apos;s a
          content-design pipeline that gives the LLM the context it
          needs to render a real judgment.
        </p>
        <HowItWorksDiagram />
      </Section>

      <Section eyebrow="Where it runs" title="Where you ship copy.">
        <ul className="mt-1 ml-5 list-disc space-y-2">
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
            Per-string verdicts with context banners and rationale
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

      <Section
        eyebrow="Built for your stack"
        title="Easier to buy. Safer to ship."
      >
        <ul className="mt-2 grid gap-4 sm:grid-cols-2 sm:gap-3">
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              One approval.
            </p>
            <p className="mt-2 text-sm text-default">
              Most teams can&apos;t get an AI vendor approved fast
              enough to keep up with how copy is changing. ContentRX
              is a $39 SaaS subscription, not a new LLM relationship
              to negotiate. No Anthropic or OpenAI key required from
              you or your org.
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Privacy.
            </p>
            <p className="mt-2 text-sm text-default">
              We&apos;re a paid tool, not a data product. Customer
              strings transit, get reviewed, and don&apos;t stick
              around.{" "}
              <Link
                href="/privacy"
                className="underline underline-offset-2"
              >
                Read the position
              </Link>
              .
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Security.
            </p>
            <p className="mt-2 text-sm text-default">
              Standard SaaS hygiene, audit-ready posture.{" "}
              <Link
                href="/security"
                className="underline underline-offset-2"
              >
                Details
              </Link>
              .
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Integrations.
            </p>
            <p className="mt-2 text-sm text-default">
              Wired into the surfaces above: MCP, CLI, GitHub Action,
              LSP, Figma.{" "}
              <Link
                href="/install"
                className="underline underline-offset-2"
              >
                Install instructions
              </Link>
              .
            </p>
          </li>
        </ul>
      </Section>

      <Section eyebrow="Built by" title="Someone who has been in the room.">
        <p>
          ContentRX was built by a staff content designer. Robert
          Ballard, with a career arc through Intuit, Meta, Opendoor,
          and PayPal today. The context, the weights, and the
          standards all carry a single designer&apos;s judgment calls,
          attributed and published. Read the{" "}
          <Link href="/about" className="underline underline-offset-2">
            about-the-model
          </Link>
          {" "}page for the longer story.
        </p>
      </Section>

      <Section eyebrow="Why it works" title="What ContentRX is great at.">
        <ul className="mt-2 grid gap-4 sm:grid-cols-3 sm:gap-3">
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Calibrated judgment.
            </p>
            <p className="mt-2 text-sm text-default">
              Content design discretion measured against a held-out
              golden set. Published kappa with a 95% confidence
              interval.{" "}
              <Link
                href="/accuracy"
                className="underline underline-offset-2"
              >
                See the numbers
              </Link>
              .
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Style guides we maintain.
            </p>
            <p className="mt-2 text-sm text-default">
              Stop chasing voice docs and ruleset PDFs. ContentRX
              holds the standards, watches the context, and applies
              them where you&apos;re shipping copy.
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Custom rules in context.
            </p>
            <p className="mt-2 text-sm text-default">
              Adjust ContentRX&apos;s recommendations with your
              team&apos;s own rules. No retraining, no pipeline
              changes, no waiting on a release.
            </p>
          </li>
        </ul>
      </Section>
    </main>
  );
}
