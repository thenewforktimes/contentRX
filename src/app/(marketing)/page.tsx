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

      {/* Built for your stack — redesigned 2026-05-10. The prior 4-up
          card grid gave the four items equal weight. They aren't. One
          approval is the procurement-friction differentiator that
          closes the deal vs custom-LLM alternatives; Privacy, Security,
          and Integrations are trust-link hooks that route to dedicated
          pages. The new layout gives One approval a hero card and
          demotes the three trust links to a horizontal strip below.
          Different silhouette from the surrounding sections, and the
          procurement story actually lands.

          Words cut ruthlessly per voice rules tightened 2026-05-10
          (short declarative, no em dashes, no semicolons, no colons). */}
      <Section
        eyebrow="Built for your stack"
        title="Easier to adopt. Safer to ship."
      >
        <div className="mt-2 rounded-2xl border border-line bg-raised p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-affirm-text/10 text-xs font-bold text-accent-affirm-text">
              ✓
            </span>
            <p className="text-base font-semibold text-strong sm:text-lg">
              One approval.
            </p>
          </div>
          <p className="mt-3 max-w-2xl text-base text-default">
            $39/month. Five-minute install. Same approval pattern your
            team uses for Slack or Figma. No LLM contract. No
            Anthropic or OpenAI key.
          </p>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          <li className="rounded-lg border border-line bg-raised p-4">
            <p className="text-sm font-semibold text-strong">Privacy.</p>
            <p className="mt-1 text-sm text-default">
              Your subscription is the whole revenue model.{" "}
              <Link
                href="/privacy"
                className="underline underline-offset-2 hover:text-strong"
              >
                Read the position
              </Link>
              .
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-4">
            <p className="text-sm font-semibold text-strong">Security.</p>
            <p className="mt-1 text-sm text-default">
              Hashed at the boundary. PII screened pre-LLM.{" "}
              <Link
                href="/security"
                className="underline underline-offset-2 hover:text-strong"
              >
                Details
              </Link>
              .
            </p>
          </li>
          <li className="rounded-lg border border-line bg-raised p-4">
            <p className="text-sm font-semibold text-strong">
              Integrations.
            </p>
            <p className="mt-1 text-sm text-default">
              Same engine, every surface.{" "}
              <Link
                href="/install"
                className="underline underline-offset-2 hover:text-strong"
              >
                Install instructions
              </Link>
              .
            </p>
          </li>
        </ul>
      </Section>

      {/* Commitments — redesigned 2026-05-10 as a checkmark list.
          The prior 3-card grid read as "another card grid" against
          everything else on the page. The list-with-checkmarks
          treatment carries the same content with a different
          silhouette and tighter spacing.

          Section frame: the items are commitments, not outcome claims.
          The latest measurement (reports/accuracy/latest.json) shows
          self-drift kappa = 0.57 with a wide CI on a small sample;
          system kappa is pending. The card-level frame names what we
          commit to do, not how good we already are. */}
      <Section eyebrow="Commitments" title="What we commit to.">
        <ul className="mt-4 space-y-4 border-y border-line py-6 sm:space-y-6 sm:py-8">
          <li className="flex gap-4">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-affirm-text/10 text-sm font-bold text-accent-affirm-text"
            >
              ✓
            </span>
            <div>
              <p className="text-base font-semibold text-strong">
                Calibrated judgment.
              </p>
              <p className="mt-1 text-sm text-default">
                Kappa with 95% CI. Drift weeks included.{" "}
                <Link
                  href="/accuracy"
                  className="underline underline-offset-2 hover:text-strong"
                >
                  See what we measured
                </Link>
                .
              </p>
            </div>
          </li>
          <li className="flex gap-4">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-affirm-text/10 text-sm font-bold text-accent-affirm-text"
            >
              ✓
            </span>
            <div>
              <p className="text-base font-semibold text-strong">
                Style guides we maintain.
              </p>
              <p className="mt-1 text-sm text-default">
                We hold the standards. We watch the context. You
                ship.
              </p>
            </div>
          </li>
          <li className="flex gap-4">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-affirm-text/10 text-sm font-bold text-accent-affirm-text"
            >
              ✓
            </span>
            <div>
              <p className="text-base font-semibold text-strong">
                Custom rules in context.
              </p>
              <p className="mt-1 text-sm text-default">
                Your team&apos;s rules override ours. No retraining.
                No pipeline changes.
              </p>
            </div>
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
