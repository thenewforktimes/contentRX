/**
 * Landing page — 2026-05-06 design refresh.
 *
 * The big shift from the prior pass: this page now reads as a
 * product page, not a policy document. Specifically:
 *
 *   - Wider canvas. max-w-6xl (1152px) on the landing only; other
 *     marketing pages (privacy/ethics/etc.) keep the narrower
 *     reading column.
 *   - Layered hero. 2-column at md+: animated wordmark + headline +
 *     CTAs on the left, decorative HeroVerdictMock (3-card stack)
 *     on the right.
 *   - Trust signal. IntegrationRow shows the seven surfaces
 *     ContentRX runs in — own the integration breadth as the proof
 *     point that's currently honest (no customer logos to show yet).
 *   - Author up. The "Built by Robert Ballard" block moves above
 *     the feature sections — it's the moat against anonymous AI
 *     tooling, treat it like an editorial byline rather than a
 *     buried about-page link.
 *   - Visual rhythm. The "How it works" section gets a subtle dot-
 *     grid radial-gradient background to break the otherwise-flat
 *     section flow; the "One approval" card on "Built for your
 *     stack" gets an accent-affirm border treatment to distinguish
 *     the differentiator from the supporting cards.
 *   - CTA discipline. Hero CTAs trim to two (Try free + See how it
 *     works); Pricing and Sign-in already live in the global header.
 *
 * Voice and copy unchanged from the prior pass — calm, named,
 * concrete (per docs/copy-vocabulary.md). The visual restructure
 * lets the existing copy land harder.
 *
 * Section order:
 *   1. Hero — wordmark + brand promise + verdict mock
 *   2. Integration row — surfaces under the fold, immediately
 *   3. Built by — named author + career arc (moat)
 *   4. How it works — animated pipeline, with dot-grid bg
 *   5. Where it runs — surface detail (the integration row is the
 *      teaser; this is the index)
 *   6. Built for your stack — One approval / Privacy / Security /
 *      Integrations as a 2x2 grid, with the One-approval card
 *      visually emphasized
 *   7. Why it works — three product-strength cards
 */

import type { Metadata } from "next";
import Link from "next/link";
import { AuthorBlock } from "@/components/author-block";
import { HeroVerdictMock } from "@/components/hero-verdict-mock";
import { HowItWorksDiagram } from "@/components/how-it-works-diagram";
import { IntegrationRow } from "@/components/integration-row";
import { SurfacesGrid } from "@/components/surfaces-grid";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Section } from "@/components/ui/section";
import { Wordmark } from "@/components/wordmark";

export const metadata: Metadata = {
  title: "ContentRX. Staff-level content design review, in every repo",
  description:
    "ContentRX reviews your strings and long-form writing and gives you suggestions and rationale. Before your next PR, before merge.",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      {/* Hero — 2-column at md+. The animated wordmark replaces the
          plain Eyebrow that used to label the headline; treats the
          brand presence as the page's first kinetic moment. */}
      <header className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-16">
        <div>
          <Wordmark size="xl" animate link={false} />
          <h1 className="mt-8 text-4xl font-semibold tracking-tight text-strong sm:text-5xl lg:text-6xl">
            Staff-level content design review in every repo
          </h1>
          <p className="mt-6 text-lg text-default sm:text-xl">
            ContentRX reviews your strings and long-form writing and
            gives you suggestions and rationale. Before your next PR,
            before merge.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
            <Link href="/sign-up" className={buttonStyles({ variant: "primary" })}>
              Try free →
            </Link>
            <Link
              href="#how-it-works"
              className={buttonStyles({ variant: "secondary" })}
            >
              See how it works
            </Link>
            <span className="ml-1 text-xs text-quiet">
              Free plan, 10 checks/month. No card.
            </span>
          </div>
        </div>
        <div className="relative">
          <HeroVerdictMock />
        </div>
      </header>

      <IntegrationRow />

      {/* Author up. The named-byline block sits high so the moat
          lands before the feature copy.
          2026-05-09: the UseCaseToggle that briefly sat between
          IntegrationRow and AuthorBlock got cut. /writes is the
          dedicated long-form proof page; the IntegrationRow chips
          already prove breadth-of-surface; the toggle was a third
          breadth-statement that hurt the page's pacing. */}
      <div className="mt-20">
        <AuthorBlock />
      </div>

      {/* How it works — same animated diagram, now with a subtle dot-
          grid backdrop to break the otherwise-flat section flow. The
          radial-gradient is one of two repeating visual punctuation
          marks on the page (the other is the integration row). */}
      <section
        id="how-it-works"
        className="mt-20 rounded-3xl border border-line bg-raised/40 p-8 sm:p-12"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-line) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
          The model around the model.
        </h2>
        <p className="mt-4 max-w-2xl text-base text-default">
          ContentRX isn&apos;t an LLM with a prompt. It&apos;s a
          content-design pipeline that gives the LLM the context it
          needs to render a real judgment.
        </p>
        <div className="mt-6">
          <HowItWorksDiagram />
        </div>
      </section>

      {/* Where it runs — a 2x3 card grid replacing the prior bullet
          list (2026-05-09 design pass). The bullet list read as docs
          directly under the heavy dot-grid panel of How-it-works;
          the card grid carries the same content with a marketing
          register that earns its place. Surface order matches the
          chip-nav order on /install. */}
      <SurfacesGrid />

      {/* Weekly review agent. Section-level value prop for the
          read-only drift-catcher Phase G shipped this week. Three
          sub-claim cards: Read-only (safety), Deterministic (math),
          0 checks per run (the differentiation, accent-affirm card
          treatment matching the One-approval lead in Built-for-
          stack below). The "Try the preview" link funnels visitors
          to /dashboard/agent's Run-preview-now button — even free
          users can preview the digest. */}
      <Section
        eyebrow="Weekly review agent"
        title="Drift, caught every Monday."
      >
        <p className="mt-2 max-w-2xl text-base text-default">
          ContentRX groups your team&apos;s flag history by pattern
          and opens a draft pull request every Monday with the
          patterns worth pulling into your next review. Deterministic.
          Read-only. The kind of recurring-pattern review your senior
          reviewer would have caught, on a cadence that doesn&apos;t
          depend on anyone scheduling it.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3 sm:gap-3">
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Read-only.
            </p>
            <p className="mt-2 text-sm text-default">
              The agent never edits your strings. Every run lands as
              a draft pull request you can close, keep, or follow up
              on inside your normal workflow.
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Deterministic.
            </p>
            <p className="mt-2 text-sm text-default">
              Patterns surface from rule-based clustering, not LLM
              guessing. Same input, same digest. Same output
              reproducible across runs.
            </p>
          </li>
          <li className="rounded-lg border-2 border-accent-affirm-border bg-accent-affirm-soft/30 p-5">
            <p className="text-sm font-semibold text-strong">
              0 checks per run.
            </p>
            <p className="mt-2 text-sm text-default">
              The digest is rendered from your team&apos;s existing
              flag history. Zero LLM calls per run. Folded into the
              Team plan.{" "}
              <Link
                href="/dashboard/agent"
                className="underline underline-offset-2"
              >
                Try the preview
              </Link>
              .
            </p>
          </li>
        </ul>
      </Section>

      <Section
        eyebrow="Built for your stack"
        title="Easier to adopt. Safer to ship."
      >
        <ul className="mt-2 grid gap-4 sm:grid-cols-2 sm:gap-3">
          {/* "One approval" gets the accent-affirm treatment — it's
              the differentiator that closes the deal vs custom-LLM
              alternatives. The other three cards stay neutral so this
              one reads as the lead. */}
          <li className="rounded-lg border-2 border-accent-affirm-border bg-accent-affirm-soft/30 p-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-affirm-text/10 text-[10px] font-bold text-accent-affirm-text">
                ✓
              </span>
              <p className="text-sm font-semibold text-strong">
                One approval.
              </p>
            </div>
            <p className="mt-2 text-sm text-default">
              Same approval pattern your team uses for Slack or
              Figma. $39/month, five-minute install. No new LLM
              contract, no Anthropic or OpenAI key needed.
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Privacy.
            </p>
            <p className="mt-2 text-sm text-default">
              Your subscription is the whole revenue model. We
              don&apos;t sell, repackage, or train on your content.{" "}
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
              Text gets hashed at the boundary. PII is screened
              before any LLM call. Cancelled accounts pseudonymize
              after ninety days. The full posture is documented.{" "}
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
              We meet content where it&apos;s being written. MCP for
              Claude Code, CLI for the terminal, GitHub Action for
              pull requests, LSP for editors, the Figma plugin for
              design-time. Same engine on every surface.{" "}
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

      {/*
        Section frame: the cards are commitments, not outcome claims.
        The earlier copy ("Why it works" + "What ContentRX is great
        at") implied the system has already proven itself — but the
        latest measurement (reports/accuracy/latest.json) shows
        self-drift κ = 0.57 with a wide CI on a small sample, and the
        system kappa is still pending. Saying "great at" was
        overpromising. The card-level frame now names what we commit
        to do, not how good we already are. Each of the three cards
        re-reads as a commitment when the section frames them that
        way: we publish κ with CIs (incl. drift weeks), we hold the
        style guides so you don't, your team's rules override ours.
      */}
      <Section eyebrow="Commitments" title="What we commit to.">
        <ul className="mt-2 grid gap-4 sm:grid-cols-3 sm:gap-3">
          <li className="rounded-lg border border-line bg-raised p-5">
            <p className="text-sm font-semibold text-strong">
              Calibrated judgment.
            </p>
            <p className="mt-2 text-sm text-default">
              Content design discretion benchmarked against a held-out
              golden set. We publish kappa with its 95% confidence
              interval, including the weeks we drift.{" "}
              <Link
                href="/accuracy"
                className="underline underline-offset-2"
              >
                See what we measured
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
              them where you&apos;re shipping content.
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
