/**
 * Landing page — 2026-05-10 design refresh.
 *
 * The 2026-05-10 pass changes the lower-half rhythm (everything below
 * SurfacesGrid). The prior pass shipped four sections of bordered
 * cards in a row; even with the dot-grid panel on How-it-works, the
 * eye saw "card grid, card grid, card grid" and the user's primary
 * value props (time, money, consistency, long-form) weren't
 * surfaced anywhere on the page.
 *
 * The refresh:
 *
 *   - **Outcomes** — new 4-up editorial section between SurfacesGrid
 *     and the agent. No card chrome, vertical rules between columns
 *     at lg+. Names the four outcomes a skeptical engineering team
 *     scans for first (Time / Money / Consistency / Long-form). The
 *     page now leads its lower half with what ships changes.
 *   - **Weekly review agent** — moved into a panel section with a
 *     stylized digest mock alongside the three sub-claim cards.
 *     Two-column at lg+. Reads as a section-level beat, not another
 *     card grid. Same panel idiom How-it-works uses.
 *   - **Built for your stack** — kept, but the accent-affirm
 *     treatment came off "One approval" (which the new Outcomes
 *     section's Money card now leads on). Reserves the accent for
 *     the agent's "0 checks per run" so emphasis doesn't get
 *     diluted twice in close proximity.
 *   - **AuthorBlock** — moved to the page foot and switched to the
 *     compact byline variant. The earlier hero-up treatment
 *     overweighted the founder-credit against the load-bearing
 *     value props; the byline still does the moat work, just at
 *     editorial-foot register instead of hero-card register.
 *
 * Voice and copy unchanged from the prior pass except where the
 * new sections introduce strings; those follow docs/copy-vocabulary.md
 * (calm, named, concrete, no em dashes).
 *
 * Section order:
 *   1. Hero — wordmark + brand promise + verdict mock
 *   2. Integration row — surfaces under the fold, immediately
 *   3. How it works — animated pipeline, with dot-grid bg
 *   4. Where it runs — 6 surface cards (SurfacesGrid)
 *   5. Outcomes — Time / Money / Consistency / Long-form
 *   6. Weekly review agent — panelled, with digest mock
 *   7. Built for your stack — One approval / Privacy / Security /
 *      Integrations as a 2x2 grid
 *   8. Commitments — three product-strength cards
 *   9. Author byline — compact editorial closer
 */

import type { Metadata } from "next";
import Link from "next/link";
import { AgentSection } from "@/components/agent-section";
import { AuthorBlock } from "@/components/author-block";
import { HeroVerdictMock } from "@/components/hero-verdict-mock";
import { HowItWorksDiagram } from "@/components/how-it-works-diagram";
import { IntegrationRow } from "@/components/integration-row";
import { OutcomesGrid } from "@/components/outcomes-grid";
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

      {/* How it works — same animated diagram, with a subtle dot-
          grid backdrop to break the otherwise-flat section flow. The
          radial-gradient is one of two repeating visual punctuation
          marks on the page (the other is the agent section panel). */}
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

      {/* Where it runs — 6 surface cards (the integration row is
          the teaser; this is the index). 2026-05-09 design pass. */}
      <SurfacesGrid />

      {/* Outcomes — 4-up editorial value-prop section.
          New 2026-05-10. Time / Money / Consistency / Long-form —
          the four outcomes a skeptical engineering team scans for
          first. Editorial layout (no card chrome) gives the section
          a different silhouette from the surrounding card grids. */}
      <OutcomesGrid />

      {/* Weekly review agent — panelled section with the digest mock
          and three sub-claim cards. Replaces the 3-card grid that
          shipped 2026-05-09; the panel + mock combination lets the
          agentic value prop land harder than three flat cards did.
          The "0 checks per run" sub-claim keeps its accent-affirm
          treatment as the load-bearing differentiator. */}
      <AgentSection />

      <Section
        eyebrow="Built for your stack"
        title="Easier to adopt. Safer to ship."
      >
        {/* Card geometry is uniform across all four cards — the prior
            pass put accent-affirm on "One approval" but the agent
            section now owns that treatment for the page. Two
            accent-affirm grids in a row diluted both. The procurement
            angle still leads the grid (first card slot). */}
        <ul className="mt-2 grid gap-4 sm:grid-cols-2 sm:gap-3">
          <li className="rounded-lg border border-line bg-raised p-5">
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

      {/* Author byline — compact editorial closer. Moved to the page
          foot 2026-05-10 so the load-bearing value props lead the
          page; the named author still does the moat work but at
          byline-register, not hero-card register. */}
      <div className="mt-20">
        <AuthorBlock />
      </div>
    </main>
  );
}
