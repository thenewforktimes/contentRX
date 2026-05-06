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

type Integration = {
  name: string;
  /** Where in /install this integration is documented. */
  href: string;
  /** Inline SVG glyph. Each glyph is 24×24 with stroke-based shapes
   * and `currentColor` so the parent text class drives the color. */
  glyph: React.ReactNode;
};

const INTEGRATIONS: readonly Integration[] = [
  {
    name: "MCP",
    href: "/install#mcp",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7l9-4 9 4-9 4-9-4z" />
        <path d="M3 12l9 4 9-4" />
        <path d="M3 17l9 4 9-4" />
      </svg>
    ),
  },
  {
    name: "Claude Code",
    href: "/install#mcp",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
      </svg>
    ),
  },
  {
    name: "Cursor",
    href: "/install#mcp",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3l14 9-6 1-3 8-5-18z" />
      </svg>
    ),
  },
  {
    name: "VS Code",
    href: "/install#lsp",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 3l-13 9 13 9V3z" />
        <path d="M6 12l-3-2v4l3-2z" />
      </svg>
    ),
  },
  {
    name: "GitHub",
    href: "/install#action",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19c-4 1-4-2-6-2m12 4v-4a3 3 0 00-1-2c3 0 6-2 6-6a4.5 4.5 0 00-1-3 4 4 0 00-.1-3s-1-.3-3 1.2a10 10 0 00-5 0c-2-1.5-3-1.2-3-1.2A4 4 0 005 6a4.5 4.5 0 00-1 3c0 4 3 6 6 6a3 3 0 00-1 2v4" />
      </svg>
    ),
  },
  {
    name: "Figma",
    href: "/install#figma",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3a3 3 0 100 6h3V3H9z" />
        <path d="M9 9a3 3 0 100 6h3V9H9z" />
        <path d="M9 15a3 3 0 103 3v-3H9z" />
        <path d="M12 3h3a3 3 0 010 6h-3V3z" />
        <circle cx="15" cy="12" r="3" />
      </svg>
    ),
  },
  {
    name: "CLI",
    href: "/install#cli",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="4" width="19" height="16" rx="2" />
        <path d="M6 9l3 3-3 3" />
        <path d="M12 15h6" />
      </svg>
    ),
  },
];

export function IntegrationRow() {
  return (
    <div className="mt-12">
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
                {integration.glyph}
              </span>
              <span className="text-xs font-medium">{integration.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-xs text-quiet">
        Seven surfaces, one model. See the{" "}
        <Link href="/install" className="underline underline-offset-2 hover:text-default">
          install instructions
        </Link>
        .
      </p>
    </div>
  );
}
