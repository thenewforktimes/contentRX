/**
 * Design tokens — JS-readable mirror of `src/app/globals.css`.
 *
 * The web app reads tokens via Tailwind classes (`bg-canvas`,
 * `text-strong`, etc.) which compile from CSS custom properties. Email
 * templates can't use Tailwind or CSS variables — Resend renders React
 * to inline-style HTML — so they import the token values from here as
 * literal hex strings.
 *
 * Keep these values in lockstep with `globals.css`. Both files reference
 * the same WCAG-verified palette; if you change a hex here, change it
 * there (and re-verify contrast ratios). The `verify-tokens.test.ts`
 * snapshot keeps them honest.
 *
 * Email design choice: emails always use the LIGHT palette regardless
 * of recipient OS preference, because most email clients (Gmail web,
 * Outlook desktop) don't reliably support dark-mode media queries inside
 * the email shell. A consistent light email reads predictably; a dark
 * email that breaks on Outlook reads broken.
 */

export const tokens = {
  /**
   * Light palette — the only palette emails should use.
   */
  light: {
    surface: {
      canvas: "#faf8f5",
      raised: "#ffffff",
      sunken: "#f0ece6",
      overlay: "#ffffff",
    },
    text: {
      strong: "#1a1715",
      default: "#44403c",
      quiet: "#5c5650",
    },
    border: {
      default: "#e7e5e4",
      strong: "#d6d3d1",
    },
    accent: {
      primary: {
        solid: "#b45309",
        onSolid: "#ffffff",
        soft: "#fef3c7",
        text: "#92400e",
        border: "#b45309",
      },
      affirm: {
        solid: "#4d7c0f",
        onSolid: "#ffffff",
        soft: "#ecfccb",
        text: "#365314",
        border: "#65a30d",
      },
      caution: {
        solid: "#c2410c",
        onSolid: "#ffffff",
        soft: "#fed7aa",
        text: "#7c2d12",
        border: "#ea580c",
      },
      concern: {
        solid: "#be123c",
        onSolid: "#ffffff",
        soft: "#ffe4e6",
        text: "#881337",
        border: "#be123c",
      },
      info: {
        solid: "#0369a1",
        onSolid: "#ffffff",
        soft: "#e0f2fe",
        text: "#075985",
        border: "#0284c7",
      },
    },
  },

  /**
   * Dark palette — the canonical web experience. Not used in email.
   * Exposed here so future surfaces (a possible Storybook, a settings
   * preview swatch grid) can read the dark values directly.
   */
  dark: {
    surface: {
      canvas: "#1a1715",
      raised: "#262220",
      sunken: "#11100e",
      overlay: "#2d2926",
    },
    text: {
      strong: "#fafaf7",
      default: "#e6e1da",
      quiet: "#b3aca2",
    },
    border: {
      default: "#3a342f",
      strong: "#57504a",
    },
    accent: {
      primary: {
        solid: "#fbbf24",
        onSolid: "#451a03",
        soft: "#2a1f12",
        text: "#fcd34d",
        border: "#92400e",
      },
      affirm: {
        solid: "#a3e635",
        onSolid: "#1a2e05",
        soft: "#1a2410",
        text: "#bef264",
        border: "#4d7c0f",
      },
      caution: {
        solid: "#fb923c",
        onSolid: "#431407",
        soft: "#2c1810",
        text: "#fdba74",
        border: "#9a3412",
      },
      concern: {
        solid: "#be123c",
        onSolid: "#fff1f2",
        soft: "#2c0e1a",
        text: "#fecdd3",
        border: "#9f1239",
      },
      info: {
        solid: "#38bdf8",
        onSolid: "#082f49",
        soft: "#0e1c2c",
        text: "#7dd3fc",
        border: "#075985",
      },
    },
  },
} as const;

export type AccentRole = "primary" | "affirm" | "caution" | "concern" | "info";
