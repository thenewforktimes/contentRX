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
 * there (and re-verify contrast ratios).
 *
 * Email design choice: emails always use the LIGHT palette (Kindle
 * Paperwhite — warm cream canvas, ink-warm-black text) regardless of
 * recipient OS preference, because most email clients (Gmail web,
 * Outlook desktop) don't reliably support dark-mode media queries
 * inside the email shell. A consistent light email reads predictably;
 * a dark email that breaks on Outlook reads broken.
 */

export const tokens = {
  /**
   * Light palette — the only palette emails should use.
   * Kindle Paperwhite: warm cream canvas, ink-warm-black text,
   * pure-white "page" cards stacked on the cream.
   */
  light: {
    surface: {
      // Light cream — lifted from #f5efe0 on 2026-05-11 so the
      // Spring Teal affirm slot has room to pop. Sunken shifted
      // proportionally to maintain the canvas/sunken delta.
      canvas: "#faf5e6",
      raised: "#ffffff",
      sunken: "#f0e9d6",
      overlay: "#ffffff",
      // `page` — writing-surface elevation. Kindle-screen off-white
      // (very faint warm tilt against near-pure-white). Same hex in
      // dark mode below: the off-white value is universal so the
      // writing surface always reads as a calm reading screen,
      // regardless of surrounding chrome.
      page: "#fafaf5",
      // `pageOn` — paired ink-text color for content on `page`.
      // Dark in both modes (the bg is always near-white).
      pageOn: "#1c1a17",
    },
    text: {
      strong: "#1c1a17",
      default: "#3d3833",
      quiet: "#574e3f",
    },
    border: {
      default: "#888070",
      strong: "#7e7565",
    },
    accent: {
      primary: {
        solid: "#4338ca",
        onSolid: "#ffffff",
        soft: "#e0e7ff",
        text: "#312e81",
        border: "#6366f1",
      },
      affirm: {
        // Spring Teal — matches globals.css light palette. The brand
        // wordmark RX in marketing emails uses the `text` slot; the
        // upgrade/welcome CTA button uses `solid`. Re-sync this when
        // the light palette in globals.css moves.
        //
        // onSolid is teal-950 (#042f2e) not white — bright teal
        // solids carry dark text, not white, for AA Normal contrast
        // (mirrors dark mode's bright-solid + dark-on-solid recipe).
        solid: "#14b8a6",
        onSolid: "#042f2e",
        soft: "#ccfbf1",
        text: "#0f766e",
        border: "#2dd4bf",
      },
      caution: {
        solid: "#ca8a04",
        onSolid: "#ffffff",
        soft: "#fef3c7",
        text: "#854d0e",
        border: "#eab308",
      },
      concern: {
        solid: "#dc2626",
        onSolid: "#ffffff",
        soft: "#fee2e2",
        text: "#991b1b",
        border: "#ef4444",
      },
      info: {
        solid: "#7c3aed",
        onSolid: "#ffffff",
        soft: "#ede9fe",
        text: "#4c1d95",
        border: "#8b5cf6",
      },
    },
  },

  /**
   * Dark palette — the canonical web experience. Not used in email.
   * Deep blue-violet canvas with warm cream-white text and a five-
   * accent palette: orange (primary), violet (info), green (affirm),
   * yellow (caution), red (concern). The cool canvas + warm accents
   * pattern gives the eye natural surface-vs-signal separation.
   */
  dark: {
    surface: {
      canvas: "#14142b",
      raised: "#22224a",
      sunken: "#0d0d1f",
      overlay: "#2a2b50",
      // `page` — same Kindle-screen off-white as the light palette.
      // Reads as a lit reading screen in a dim room — the textarea
      // becomes the brightest object on screen, which is the
      // affordance.
      page: "#fafaf5",
      // `pageOn` — paired ink-text color for content on `page`.
      // Dark in both modes (the bg is always near-white).
      pageOn: "#1c1a17",
    },
    text: {
      strong: "#eef0f5",
      default: "#c4c8d0",
      quiet: "#a0a4b0",
    },
    border: {
      default: "#646494",
      strong: "#7070b4",
    },
    accent: {
      primary: {
        solid: "#fb923c",
        onSolid: "#1c0f04",
        soft: "#2d1810",
        text: "#fdba74",
        border: "#c2410c",
      },
      affirm: {
        solid: "#4ade80",
        onSolid: "#052e16",
        soft: "#14201e",
        text: "#86efac",
        border: "#22c55e",
      },
      caution: {
        solid: "#facc15",
        onSolid: "#2d2406",
        soft: "#2a2410",
        text: "#fde047",
        border: "#ca8a04",
      },
      concern: {
        solid: "#f87171",
        onSolid: "#2c0a0a",
        soft: "#2c0e0e",
        text: "#fca5a5",
        border: "#dc2626",
      },
      info: {
        solid: "#a78bfa",
        onSolid: "#1e1142",
        soft: "#1e1942",
        text: "#c4b5fd",
        border: "#7c3aed",
      },
    },
  },
} as const;

export type AccentRole = "primary" | "affirm" | "caution" | "concern" | "info";
