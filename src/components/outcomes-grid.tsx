/**
 * OutcomesGrid — landing page's lower-fold quadrant section.
 *
 * 2026-05-11 six-cell rebuild. Robo's review on the prior pass:
 *   - "Stay consistent" duplicated the WHERE IT RUNS section above
 *     it (cross-surface story already lands there); cut.
 *   - One approval was orphaned in its own 2-up row beneath
 *     OutcomesGrid; move into the grid.
 *   - Agent's 2-up partner moved with it into the grid.
 *   - Trust links became a quadrant cell (TrustCell) instead of an
 *     inline strip.
 *   - Long-form review pushed down to the last row.
 *   - Cells shrunk: dropped min-h, reduced padding p-8/10 → p-6/8
 *     so cards stop feeling oversized vs the rest of the site.
 *
 * The lower fold now reads as one coherent 2x3 grid: six cells,
 * identical geometry, all on bg-raised. The six cells share the
 * same Cell shell (rounded-2xl border + p-6 sm:p-8) so visual
 * consistency holds even when cells live in different files.
 *
 *   Row 1: Save time | Save money
 *   Row 2: One approval | Weekly review agent
 *   Row 3: Receipts | Long-form review
 *
 * Save money: 6 surface icons (was 5; Dashboard paste mode was
 * missing). Icon size bumped h-5 → h-7 to match the visual weight
 * of the IntegrationRow chips at the top of the page.
 */

import Link from "next/link";
import { AgentSection } from "@/components/agent-section";
import { OneApprovalCell } from "@/components/one-approval-cell";
import {
  CliIcon,
  FigmaIcon,
  GitHubIcon,
  McpIcon,
  PasteModeIcon,
  VsCodeIcon,
} from "@/components/surface-icons";
import { TrustCell } from "@/components/trust-cell";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";

export function OutcomesGrid() {
  return (
    <section id="outcomes" className="mt-20 scroll-mt-16">
      <Eyebrow>Outcomes</Eyebrow>
      <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
        Why teams pick ContentRX.
      </h2>

      <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
        <SaveTimeCell />
        <SaveMoneyCell />
        <OneApprovalCell />
        <AgentSection />
        <TrustCell />
        <LongFormCell />
      </ul>
    </section>
  );
}

/**
 * Local cell shell for the three Outcomes-owned cells (Save time,
 * Save money, Long-form review). The Agent / OneApproval / Trust
 * cells live in their own files but use matching geometry by
 * convention (rounded-2xl border bg-raised + p-6 sm:p-8). When
 * the geometry changes here, mirror the change in those three
 * files too.
 */
function Cell({
  eyebrow,
  headline,
  visual,
  cta,
}: {
  eyebrow: string;
  headline: string;
  visual: React.ReactNode;
  cta?: { href: string; label: string };
}) {
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-raised p-6 sm:p-8">
      <Eyebrow>{eyebrow}</Eyebrow>
      <p className="mt-3 text-lg font-semibold text-strong sm:text-xl">
        {headline}
      </p>
      <div className="mt-auto flex flex-col items-stretch pt-8">
        {visual}
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="mt-5 inline-flex w-fit items-center gap-1 text-sm font-medium text-default underline underline-offset-2 hover:text-strong"
        >
          {cta.label} →
        </Link>
      )}
    </li>
  );
}

/**
 * Save time + Save money are paired in the top row of the grid.
 * Their visuals follow an identical scaffold so the row reads as
 * one cohesive system:
 *
 *   - Inner flex container: `flex flex-col items-center gap-4 py-2`
 *     (no `justify-center` divergence between the two cells).
 *   - Top element: a single visual moment (stopwatch glyph in
 *     SaveTime, $39 anchor in SaveMoney) at roughly the same
 *     vertical scale.
 *   - Bottom element: a single text/icon row at the same scale.
 *
 * Sizing calibration (2026-05-11 polish):
 *   - Stopwatch glyph: 48px (unchanged)
 *   - "Hours → Seconds" text: text-3xl sm:text-4xl (was 2xl/3xl)
 *   - "$39" anchor: text-4xl sm:text-5xl (was 5xl/6xl)
 *   - Surface icons: h-7 w-7 (unchanged)
 *
 * Both visuals end up similar in total height and visual weight.
 */
function SaveTimeCell() {
  return (
    <Cell
      eyebrow="Save time"
      headline="Reviews in seconds, not hours."
      visual={
        <div className="flex flex-col items-center gap-4 py-2">
          <StopwatchGlyph />
          <div className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            <span className="text-quiet line-through decoration-2 decoration-quiet/60">
              Hours
            </span>
            <span aria-hidden className="text-quiet">
              →
            </span>
            <span className="text-strong">Seconds</span>
          </div>
        </div>
      }
    />
  );
}

function SaveMoneyCell() {
  // Six surface icons (Dashboard + MCP + LSP + GitHub Action + CLI
  // + Figma plugin) so the row matches SurfacesGrid and
  // IntegrationRow at the top of the page.
  return (
    <Cell
      eyebrow="Save money"
      headline="One model. Every surface."
      cta={{ href: "/pricing", label: "See pricing" }}
      visual={
        <div className="flex flex-col items-center gap-4 py-2">
          <p className="leading-none">
            <span className="text-4xl font-bold tracking-tight text-accent-affirm-text sm:text-5xl">
              $39
            </span>
            <span className="ml-1 text-base text-default sm:text-lg">
              /month
            </span>
          </p>
          <div className="flex items-center gap-3 opacity-80">
            <PasteModeIcon className="h-7 w-7 text-quiet" />
            <McpIcon className="h-7 w-7 text-quiet" />
            <VsCodeIcon className="h-7 w-7 text-quiet" />
            <GitHubIcon className="h-7 w-7 text-quiet" />
            <CliIcon className="h-7 w-7 text-quiet" />
            <FigmaIcon className="h-7 w-7 text-quiet" />
          </div>
        </div>
      }
    />
  );
}

function LongFormCell() {
  // Pulled from the /writes product update example. The input
  // excerpt is a real fragment; the finding pill matches one of
  // the example's flags; the rewrite excerpt is a real fragment
  // from the rewrite. Honest by source.
  return (
    <Cell
      eyebrow="Long-form review"
      headline="The full document read."
      cta={{ href: "/writes", label: "See six examples" }}
      visual={
        <div className="rounded-xl border border-line bg-canvas p-4 shadow-md shadow-canvas/40">
          <p className="font-mono text-[11px] leading-relaxed text-quiet">
            &ldquo;leverages cutting-edge AI to facilitate your
            team&apos;s ability to optimize content workflows...&rdquo;
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Pill tone="amber" size="xs">
              Plain language
            </Pill>
            <span className="text-[11px] text-default">
              Eleven corporate words.
            </span>
          </div>
          <div className="mt-3 rounded-md bg-sunken p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
              Suggested
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-default">
              We shipped advanced moment classification. The dashboard
              picks the register.
            </p>
          </div>
        </div>
      }
    />
  );
}

function StopwatchGlyph() {
  // Hand-rolled minimal SVG. Same line-weight as the surface-icons
  // set so it doesn't visually fight the icon row in the Save money
  // cell.
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent-affirm-text"
      aria-hidden
    >
      <circle cx="24" cy="26" r="14" />
      <path d="M24 26 L24 16" />
      <path d="M24 26 L31 26" />
      <path d="M20 8 L28 8" />
      <path d="M24 8 L24 12" />
    </svg>
  );
}
