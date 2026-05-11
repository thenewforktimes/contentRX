/**
 * Landing page — 2026-05-11 final polish pass.
 *
 * Section order:
 *   1. Hero — wordmark + brand promise + verdict mock
 *   2. Integration row — chip strip
 *   3. How it works — animated pipeline panel, dot-grid bg
 *   4. Where it runs — 6 surface cards (SurfacesGrid)
 *   5. Outcomes — 2x3 quadrant grid (six cells, OutcomesGrid):
 *      Save time / Save money / One approval / Weekly review agent /
 *      Receipts / Long-form review
 *
 * Section dividers (`border-t border-line pt-10`) cut from the
 * lower fold 2026-05-11. Each section now has enough visual
 * character (panel, card grid, quadrant cells) that the rules
 * read as chrome. Section spacing (mt-20) handles the rhythm.
 *
 * Author byline cut from the foot 2026-05-11. The named-author
 * block lives on /accuracy and /ethics where it earns its place;
 * home page real estate goes to the value-prop quadrant grid.
 * (/about retired 2026-05-10 — redirect to /ethics.)
 *
 * Cuts across the lower-fold rebuild:
 *   - "Built for your stack" 4-card section
 *   - "Stay consistent" cell (WHERE IT RUNS already lands the story)
 *   - "Style guides we maintain" commitment (disingenuous)
 *   - "Calibrated judgment" commitment (readers don't drill into
 *     kappa from home; /accuracy still reachable via Receipts cell)
 *   - "Custom rules in context" commitment (Team-plan feature; lives
 *     on /pricing)
 *   - Author byline at the foot (above)
 *
 * Voice rules: short declarative, no em dashes, no semicolons, no
 * colons. Verb-led eyebrow labels where the cell content allows.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { HeroVerdictMock } from "@/components/hero-verdict-mock";
import { HowItWorksDiagram } from "@/components/how-it-works-diagram";
import { IntegrationRow } from "@/components/integration-row";
import { OutcomesGrid } from "@/components/outcomes-grid";
import { SurfacesGrid } from "@/components/surfaces-grid";
import { ButtonArrow, buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Wordmark } from "@/components/wordmark";

export const metadata: Metadata = {
  title: "ContentRX. Staff-level content design review, in every repo",
  description:
    "ContentRX reviews your checks and long-form writing and gives you suggestions and rationale. Before your next PR, before merge.",
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
          <h1 className="mt-8 text-5xl font-bold tracking-tight text-strong sm:text-6xl lg:text-7xl">
            Staff-level content design review in every repo
          </h1>
          <p className="mt-6 text-lg text-default sm:text-xl">
            ContentRX reviews your checks and long-form writing and
            gives you suggestions and rationale. Before your next PR,
            before merge.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
            <Link href="/sign-up" className={buttonStyles({ variant: "primary" })}>
              Try free <ButtonArrow />
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

      {/* Outcomes — 2x3 quadrant grid (six cells, identical
          geometry). Rebuilt 2026-05-11 from a 2x2 + extra row +
          inline strip into a single coherent grid section. Cells:
          Save time, Save money, One approval, Weekly review agent,
          Receipts (trust links), Long-form review.

          Six-cell rebuild rationale (Robo's review):
            - Stay consistent cut. WHERE IT RUNS above already lands
              the cross-surface story.
            - One approval moved into the grid (was orphaned in its
              own 2-up row).
            - Agent moved into the grid alongside One approval.
            - Trust links became their own cell (TrustCell, eyebrow
              "Receipts") instead of an inline strip.
            - Long-form review pushed to the last row.
            - Cell padding reduced p-8/10 → p-6/8 and min-h dropped
              so cards stop feeling oversized.

          OutcomesGrid imports AgentSection, OneApprovalCell, and
          TrustCell directly so the grid is self-contained; page.tsx
          now needs only the OutcomesGrid render. */}
      <OutcomesGrid />

      {/* Author byline cut 2026-05-11. The named-author block lived
          here from 2026-05-06 → 2026-05-11 as a moat against the
          studiously-anonymous AI tools. Robo's call: home page real
          estate goes further on the value-prop quadrant grid above.
          The byline still lives on /accuracy via the card variant of
          <AuthorBlock />, where the methodology binds tightly to the
          named author. (/about retired 2026-05-10 → /ethics.) */}
    </main>
  );
}
