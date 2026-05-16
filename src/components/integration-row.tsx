/**
 * IntegrationRow — the surfaces ContentRX runs in, rendered as a
 * horizontal row of glyph + label tiles.
 *
 * The customer's eye should walk this row and recognize the tools
 * they already use. That recognition is the trust signal; we don't
 * have customer-logos to show yet (no public design partners), so
 * the integration set IS the proof.
 *
 * Glyph design rationale:
 *   - Hand-rolled minimal SVGs (1-2 simple shapes each), not the
 *     vendor's actual brand mark. Reasons: licensing simplicity,
 *     visual consistency across the row (vendor marks have wildly
 *     different weights and proportions), and the row reads as
 *     "ContentRX's design language" rather than a vendor parade.
 *   - All glyphs share the same line-weight and stroke-cap so the
 *     row has one visual rhythm.
 *   - Color: the glyphs sit in `text-quiet` by default and lift to
 *     `text-strong` on hover. The accent color is reserved for the
 *     wordmark — we don't want the integration row to compete.
 *
 * Layout: a single flex row that wraps on narrow screens. Each tile
 * is the same width so the row reads as a grid even when wrapping.
 */

import Link from "next/link";
import {
  ClaudeCodeIcon,
  CliIcon,
  CursorIcon,
  GitHubIcon,
  McpIcon,
  VsCodeIcon,
} from "@/components/surface-icons";

type Integration = {
  name: string;
  /** Where in /install this integration is documented. */
  href: string;
  /** Glyph component. Each is a 24×24 stroke-based SVG with
   * `currentColor` so the parent text class drives the color. The
   * shared icon set lives in surface-icons.tsx and is reused by
   * SurfacesGrid on the landing page. */
  Glyph: React.ComponentType<{ className?: string }>;
};

const INTEGRATIONS: readonly Integration[] = [
  { name: "MCP", href: "/install#mcp", Glyph: McpIcon },
  { name: "Claude Code", href: "/install#mcp", Glyph: ClaudeCodeIcon },
  { name: "Cursor", href: "/install#mcp", Glyph: CursorIcon },
  { name: "GitHub", href: "/install#action", Glyph: GitHubIcon },
  { name: "CLI", href: "/install#cli", Glyph: CliIcon },
  { name: "VS Code", href: "/install#lsp", Glyph: VsCodeIcon },
];

export function IntegrationRow() {
  return (
    <div className="mt-8">
      <p className="text-center text-xs font-semibold uppercase tracking-widest text-quiet">
        Wired into the surfaces you already ship in
      </p>
      <ul className="mt-6 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-2">
        {INTEGRATIONS.map((integration) => (
          <li key={integration.name} className="flex">
            <Link
              href={integration.href}
              className="group flex w-full items-center gap-2 rounded-md border border-line bg-raised px-3 py-2 text-quiet transition hover:border-line-strong hover:bg-canvas hover:text-strong sm:w-auto"
            >
              <span className="h-5 w-5 shrink-0" aria-hidden>
                <integration.Glyph className="h-5 w-5" />
              </span>
              <span className="text-xs font-medium">{integration.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-xs text-quiet">
        One model, every surface you ship in. See the{" "}
        <Link href="/install" className="underline underline-offset-2 hover:text-default">
          install instructions
        </Link>
        .
      </p>
    </div>
  );
}
