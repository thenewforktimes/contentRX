/**
 * Surface icons — shared SVG glyphs for the IntegrationRow chips and
 * the SurfacesGrid cards on the landing page.
 *
 * Design rationale (lifted from integration-row.tsx, where these
 * originally lived inline):
 *   - Hand-rolled minimal SVGs (1-2 simple shapes each), not the
 *     vendor's actual brand mark. Reasons: licensing simplicity,
 *     visual consistency across surfaces (vendor marks have wildly
 *     different weights and proportions), and the row reads as
 *     "ContentRX's design language" rather than a vendor parade.
 *   - All glyphs share the same stroke-width and stroke-cap so the
 *     surface set has one visual rhythm.
 *   - `currentColor` on every stroke so the parent text class drives
 *     the color — works in dark + light mode without per-icon dark:
 *     variants.
 *
 * Each icon is a 24x24 viewBox stroke-only SVG. Callers control size
 * via `className` (typical: `h-5 w-5` for chips, `h-8 w-8` for cards).
 */

type IconProps = { className?: string };

const baseSvgProps = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function McpIcon({ className }: IconProps = {}) {
  return (
    <svg className={className} {...baseSvgProps}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  );
}

export function ClaudeCodeIcon({ className }: IconProps = {}) {
  return (
    <svg className={className} {...baseSvgProps}>
      <path d="M12 3l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
    </svg>
  );
}

export function CursorIcon({ className }: IconProps = {}) {
  return (
    <svg className={className} {...baseSvgProps}>
      <path d="M5 3l14 9-6 1-3 8-5-18z" />
    </svg>
  );
}

export function VsCodeIcon({ className }: IconProps = {}) {
  return (
    <svg className={className} {...baseSvgProps}>
      <path d="M19 3l-13 9 13 9V3z" />
      <path d="M6 12l-3-2v4l3-2z" />
    </svg>
  );
}

export function GitHubIcon({ className }: IconProps = {}) {
  return (
    <svg className={className} {...baseSvgProps}>
      <path d="M9 19c-4 1-4-2-6-2m12 4v-4a3 3 0 00-1-2c3 0 6-2 6-6a4.5 4.5 0 00-1-3 4 4 0 00-.1-3s-1-.3-3 1.2a10 10 0 00-5 0c-2-1.5-3-1.2-3-1.2A4 4 0 005 6a4.5 4.5 0 00-1 3c0 4 3 6 6 6a3 3 0 00-1 2v4" />
    </svg>
  );
}

export function CliIcon({ className }: IconProps = {}) {
  return (
    <svg className={className} {...baseSvgProps}>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M6 9l3 3-3 3" />
      <path d="M12 15h6" />
    </svg>
  );
}

/**
 * Paste-mode icon — new for the SurfacesGrid card grid (2026-05-09).
 * The dashboard's paste-mode surface doesn't appear in the
 * IntegrationRow chip teaser (the chips lead with editor / IDE /
 * design-tool surfaces) but it does deserve a card in the
 * SurfacesGrid alongside the install paths. The glyph is a clipboard
 * with three text lines — paste-shaped without needing the literal
 * paste-arrow that's tied to the OS clipboard.
 */
export function PasteModeIcon({ className }: IconProps = {}) {
  return (
    <svg className={className} {...baseSvgProps}>
      {/* Clipboard outline */}
      <rect x="5" y="4" width="14" height="17" rx="2" />
      {/* Clipboard's tab */}
      <rect x="9" y="2" width="6" height="3" rx="0.5" />
      {/* Three text lines */}
      <path d="M9 11h6" />
      <path d="M9 14h6" />
      <path d="M9 17h4" />
    </svg>
  );
}
