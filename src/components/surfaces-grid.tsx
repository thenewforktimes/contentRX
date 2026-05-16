/**
 * SurfacesGrid — the landing page's "Where it runs" detail block,
 * 2026-05-09 redesign.
 *
 * Replaces the bullet-list `<ul>` that previously sat under the
 * animated How-it-works section. The bullet list read as docs, not
 * marketing — flat, low-rhythm, no visual anchor between the heavy
 * dot-grid panel above and the buyer-prop cards below. The card
 * grid carries the same content with a visual register that earns
 * its place in the page.
 *
 * Five cards in a responsive grid (1 col mobile, 2 at sm, 3 at lg).
 * Each card sources its glyph from `surface-icons.tsx` — the same
 * icon set the IntegrationRow chips use, just rendered larger.
 *
 * Card order is the founder's locked canonical surface list
 * (2026-05-16): MCP, GitHub Action, CLI, LSP, Dashboard. The Figma
 * plugin was dropped as a surface entirely on 2026-05-16 because
 * Figma no longer accepts paid plugins in the Community space, so
 * the plugin can never ship. Do not re-add it without a superseding
 * founder decision.
 *
 * Deliberate divergence from /install: this grid leads with MCP per
 * the canonical list, while /install still leads with the no-install
 * Dashboard paste path by conversion-funnel design (pinned by the
 * F5 test in install/page.test.ts). Reordering /install to match is
 * a separate, flagged call.
 *
 * The card surface uses bg-raised + border-line — the default Card
 * primitive treatment — to keep the visual rhythm consistent with
 * Built-for-your-stack and Commitments below.
 */

import Link from "next/link";
import {
  CliIcon,
  GitHubIcon,
  McpIcon,
  PasteModeIcon,
  VsCodeIcon,
} from "@/components/surface-icons";
import { Eyebrow } from "@/components/ui/eyebrow";

type Surface = {
  name: string;
  href: string;
  Glyph: React.ComponentType<{ className?: string }>;
  description: React.ReactNode;
  /** CTA label. "Install" for the install paths, "Sign in and paste"
   * for the dashboard surface (which doesn't have an install). */
  ctaLabel: string;
};

const SURFACES: readonly Surface[] = [
  {
    name: "MCP server",
    href: "/install#mcp",
    Glyph: McpIcon,
    description:
      "Inline review during generation in Claude Code, Cursor, or any MCP client. The flag lands in the same conversation as the writing.",
    ctaLabel: "Install",
  },
  {
    name: "GitHub Action",
    href: "/install#action",
    Glyph: GitHubIcon,
    description: (
      <>
        Evaluates the checks touched in a pull request.{" "}
        <code className="font-mono text-xs">fail-on: review</code>{" "}
        gates merge on findings flagged for review.
      </>
    ),
    ctaLabel: "Install",
  },
  {
    name: "CLI",
    href: "/install#cli",
    Glyph: CliIcon,
    description:
      "Spot-check a string, batch a file, or hook it into pre-commit. One install, zero dependencies.",
    ctaLabel: "Install",
  },
  {
    name: "LSP server",
    href: "/install#lsp",
    Glyph: VsCodeIcon,
    description:
      "Findings as diagnostics in VS Code, Cursor, Zed, or any LSP editor. Right-click to rewrite in place.",
    ctaLabel: "Install",
  },
  {
    name: "Dashboard",
    href: "/dashboard/explain",
    Glyph: PasteModeIcon,
    description:
      "Sign in and paste your writing. Get the document-level diagnostic and a clean rewrite. No install.",
    ctaLabel: "Open the dashboard",
  },
];

export function SurfacesGrid() {
  return (
    <section
      className="mt-20 scroll-mt-16 rounded-3xl border border-accent-info-border/40 bg-accent-info-soft/30 p-8 sm:p-12"
    >
      <Eyebrow>Where it runs</Eyebrow>
      <h2 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">
        Where you ship content.
      </h2>
      <p className="mt-4 max-w-2xl text-base text-default">
        Same engine on every surface. One monthly limit covers them
        all. Pick the surfaces your team lives in.
      </p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SURFACES.map((s) => (
          <li
            key={s.name}
            className="rounded-lg border border-line bg-raised p-5"
          >
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-canvas text-default"
              aria-hidden
            >
              <s.Glyph className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-strong">
              {s.name}
            </h3>
            <p className="mt-2 text-sm text-default">{s.description}</p>
            <Link
              href={s.href}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-default underline underline-offset-2 hover:text-strong"
            >
              {s.ctaLabel} →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
