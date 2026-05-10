/**
 * OutcomesGrid — landing page's value-prop spine.
 *
 * 2026-05-10 quadrant rebuild. The prior editorial 4-up was
 * text-only and read as a Word document next to the visual-rich
 * upper sections (hero verdict mock, animated How-it-works, surface
 * card grid). This pass converts to a 2x2 product-quadrant pattern
 * (modeled on Apple's homepage product cells): each cell has a hero
 * visual filling the bottom 50-60%, sparse copy on top, and lives on
 * the standard `bg-raised` surface.
 *
 * Verb-led labels: "Save time," "Save money," "Stay consistent,"
 * "Long-form review." The 2x2 scan reads as a list of customer
 * outcomes, not category tags.
 *
 * Hero visuals are honest by construction — no ghost UI:
 *   - Save time:    typographic Hours → Seconds with a stopwatch SVG
 *   - Save money:   $39 anchor + horizontal row of real surface icons
 *   - Stay consistent: stylized 5-icon row with a shared flag pill
 *   - Long-form review: mini-snippet pulling a real /writes example
 *     (the product update one). Input excerpt + finding pill +
 *     rewrite excerpt, layered like HeroVerdictMock.
 */

import Link from "next/link";
import {
  CliIcon,
  FigmaIcon,
  GitHubIcon,
  McpIcon,
  VsCodeIcon,
} from "@/components/surface-icons";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";

export function OutcomesGrid() {
  return (
    <section
      id="outcomes"
      className="mt-16 border-t border-line pt-10 scroll-mt-16"
    >
      <Eyebrow>Outcomes</Eyebrow>
      <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
        Why teams pick this.
      </h2>

      <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
        <SaveTimeCell />
        <SaveMoneyCell />
        <StayConsistentCell />
        <LongFormCell />
      </ul>
    </section>
  );
}

/**
 * Cell shell. All four cells share the same geometry: rounded-2xl
 * border on bg-raised, generous padding, eyebrow-headline on top,
 * hero visual filling the bottom. Min-height keeps the row even when
 * the visuals have different intrinsic heights.
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
    <li className="flex min-h-[360px] flex-col rounded-2xl border border-line bg-raised p-8 sm:p-10">
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
          className="mt-6 inline-flex w-fit items-center gap-1 text-sm font-medium text-default underline underline-offset-2 hover:text-strong"
        >
          {cta.label} →
        </Link>
      )}
    </li>
  );
}

function SaveTimeCell() {
  return (
    <Cell
      eyebrow="Save time"
      headline="Reviews in seconds, not hours."
      visual={
        <div className="flex flex-col items-center justify-center gap-4 py-2">
          <StopwatchGlyph />
          <div className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
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
  // The surface-icon row at the bottom carries the "every surface"
  // claim visually so the headline doesn't need to repeat it.
  return (
    <Cell
      eyebrow="Save money"
      headline="One model. Every surface."
      cta={{ href: "/pricing", label: "See pricing" }}
      visual={
        <div className="flex flex-col items-center gap-4 py-2">
          <p className="leading-none">
            <span className="text-6xl font-bold tracking-tight text-accent-affirm-text sm:text-7xl">
              $39
            </span>
            <span className="ml-1 text-base text-default sm:text-lg">
              /month
            </span>
          </p>
          <div className="flex items-center gap-2 opacity-80">
            <McpIcon className="h-5 w-5 text-quiet" />
            <VsCodeIcon className="h-5 w-5 text-quiet" />
            <GitHubIcon className="h-5 w-5 text-quiet" />
            <CliIcon className="h-5 w-5 text-quiet" />
            <FigmaIcon className="h-5 w-5 text-quiet" />
          </div>
        </div>
      }
    />
  );
}

function StayConsistentCell() {
  // Five surface "tiles" all flagging the same string. The shared
  // flag pill at top + the icon row below imply the call lands the
  // same way everywhere. No fake screenshots; just stylized
  // representations of the surfaces.
  const SURFACES = [
    { name: "Figma", Icon: FigmaIcon },
    { name: "LSP", Icon: VsCodeIcon },
    { name: "Action", Icon: GitHubIcon },
    { name: "CLI", Icon: CliIcon },
    { name: "MCP", Icon: McpIcon },
  ];
  return (
    <Cell
      eyebrow="Stay consistent"
      headline="Same call across surfaces."
      visual={
        <div className="flex flex-col items-center gap-5 py-2">
          <div className="flex items-center gap-2">
            <Pill tone="amber" size="xs">
              Action verbs
            </Pill>
            <span className="font-mono text-xs text-quiet">
              &lsquo;Submit&rsquo;
            </span>
          </div>
          <div aria-hidden className="h-3 w-px bg-line" />
          <ul className="flex items-center gap-3">
            {SURFACES.map((s) => (
              <li
                key={s.name}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-canvas text-default"
              >
                <s.Icon className="h-5 w-5" />
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}

function LongFormCell() {
  // Pulled from the /writes product update example. The input excerpt
  // is a real fragment from the example's input text; the finding
  // pill matches one of the example's flags; the rewrite excerpt is
  // a real fragment from the example's rewrite. Honest by source.
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
  // cell next to it.
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
