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
 * AAA across the board (2026-05-14): every text-on-bg ≥7:1; every UI
 * element ≥3:1; every on-solid pairing ≥7:1. Earlier drafts of this
 * file lagged globals.css on the dark palette (raised/sunken/overlay
 * carried older values); resynced as part of the AAA tuning.
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
      canvas: "#faf5e6",
      raised: "#ffffff",
      sunken: "#f0e9d6",
      overlay: "#ffffff",
      page: "#fafaf5",
      pageOn: "#1c1a17",
    },
    text: {
      strong: "#1c1a17",
      default: "#3d3833",
      // quiet darkened from #574e3f (AAA fail on sunken) to #4d4537
      // (AAA pass everywhere). Same warm-ink family.
      quiet: "#4d4537",
    },
    border: {
      default: "#888070",
      strong: "#7e7565",
    },
    disabled: {
      // Neutral muted surface for disabled controls. The visual identity
      // shifts from "primary, faded" (opacity-50) to "grayed out, can't
      // press". Contrast intentionally low; WCAG 1.4.3 carves out
      // disabled UI from the minimum.
      surface: "#e0d8c5",
      text: "#80776a",
      border: "#c4baa8",
    },
    accent: {
      primary: {
        solid: "#4338ca",
        onSolid: "#ffffff",
        soft: "#e0e7ff",
        text: "#312e81",
        border: "#6366f1",
        // Hover-state pair (added 2026-05-14). Standard pattern (dark
        // bg, white text) — hover darkens. 9.40:1 AAA Normal.
        solidHover: "#3730a3",
        softHover: "#c7d2fe",
      },
      affirm: {
        // Spring Teal — AAA-tuned 2026-05-14. solid moved from #14b8a6
        // to brighter #2dd4bf so dark-on-bright on-solid hits AAA.
        // text darkened to #0c4844 for AAA on canvas. border darkened
        // to #0d9488 for UI 1.4.11 (3:1) — was 1.71:1 before.
        solid: "#2dd4bf",
        onSolid: "#042f2e",
        soft: "#ccfbf1",
        text: "#0c4844",
        border: "#0d9488",
        // Inverse pattern (bright teal bg, dark teal text) — hover
        // LIGHTENS to preserve contrast. 11.25:1 AAA Normal.
        solidHover: "#5eead4",
        softHover: "#99f6e4",
      },
      caution: {
        // onSolid flipped from white to black — was 2.95:1 (AA Normal
        // FAIL, the only such failure in the whole palette). Black-on-
        // gold is 7.12:1 AAA. Universal "warning stripe" pattern.
        // text darkened to #6b3d00 for AAA. border darkened to
        // #a16207 for UI 1.4.11.
        solid: "#ca8a04",
        onSolid: "#000000",
        soft: "#fef3c7",
        text: "#6b3d00",
        border: "#a16207",
        // Inverse pattern (gold bg, black text) — hover LIGHTENS to
        // preserve contrast. 11.08:1 AAA Normal.
        solidHover: "#eab308",
        softHover: "#fde68a",
      },
      concern: {
        // solid darkened from #dc2626 (6.03:1 AAA fail) to #ad1f1f
        // (7.14:1 AAA pass).
        solid: "#ad1f1f",
        onSolid: "#ffffff",
        soft: "#fee2e2",
        text: "#991b1b",
        border: "#ef4444",
        // Standard pattern (dark red bg, white text) — hover darkens.
        // 9.74:1 AAA Normal.
        solidHover: "#7f1d1d",
        softHover: "#fecaca",
      },
      info: {
        // solid darkened from #7c3aed (5.41:1 AAA fail) to #5b21b6
        // (9.13:1 AAA pass).
        solid: "#5b21b6",
        onSolid: "#ffffff",
        soft: "#ede9fe",
        text: "#4c1d95",
        border: "#8b5cf6",
        // Standard pattern (dark violet bg, white text) — hover
        // darkens. 11.10:1 AAA Normal.
        solidHover: "#4c1d95",
        softHover: "#ddd6fe",
      },
    },
  },

  /**
   * Dark palette — the canonical web experience. Not used in email
   * (kept in sync for any future surface that needs both modes).
   * AAA-tuned 2026-05-14.
   */
  dark: {
    surface: {
      canvas: "#14142b",
      // raised + overlay darkened from the previous values so
      // text-quiet clears 7:1 on every surface including modals.
      raised: "#1f1f44",
      sunken: "#0a0a1a",
      overlay: "#1f1f50",
      page: "#fafaf5",
      pageOn: "#1c1a17",
    },
    text: {
      strong: "#eef0f5",
      default: "#c4c8d0",
      // quiet brightened from #a0a4b0 to #c4c8d4 for AAA on raised
      // and overlay.
      quiet: "#c4c8d4",
    },
    border: {
      // default brightened from #646494 (UI 1.4.11 fail on raised) to
      // #7575a8 (3.47:1 pass).
      default: "#7575a8",
      strong: "#7070b4",
    },
    disabled: {
      // Neutral muted surface for disabled controls. Dark-mode pairing.
      surface: "#2c2c52",
      text: "#6464a8",
      border: "#404072",
    },
    accent: {
      primary: {
        solid: "#fb923c",
        onSolid: "#1c0f04",
        soft: "#2d1810",
        text: "#fdba74",
        // border bumped from #c2410c (2.32:1 vs canvas) to #d97706
        // (3.64:1 pass).
        border: "#d97706",
        // Inverse pattern (bright bg, dark text) — hover LIGHTENS so
        // the button "lights up" and contrast climbs. 9.82:1 AAA Normal.
        solidHover: "#fdba74",
        softHover: "#3d2014",
      },
      affirm: {
        solid: "#4ade80",
        onSolid: "#052e16",
        soft: "#14201e",
        text: "#86efac",
        border: "#22c55e",
        solidHover: "#86efac",
        softHover: "#1a2c28",
      },
      caution: {
        solid: "#facc15",
        onSolid: "#2d2406",
        soft: "#2a2410",
        text: "#fde047",
        border: "#ca8a04",
        solidHover: "#fde047",
        softHover: "#3a3216",
      },
      concern: {
        solid: "#f87171",
        // onSolid darkened from #2c0a0a (6.70:1 AAA fail) to #1a0606
        // (7.25:1 AAA pass).
        onSolid: "#1a0606",
        soft: "#2c0e0e",
        text: "#fca5a5",
        // border bumped from #dc2626 (2.74:1 vs canvas) to #ef4444
        // (3.76:1 pass).
        border: "#ef4444",
        solidHover: "#fca5a5",
        softHover: "#3a1414",
      },
      info: {
        solid: "#a78bfa",
        // onSolid darkened from #1e1142 (6.18:1 AAA fail) to #080414
        // (7.49:1 AAA pass).
        onSolid: "#080414",
        soft: "#1e1942",
        text: "#c4b5fd",
        // border bumped from #7c3aed (2.59:1 vs canvas) to #8b5cf6
        // (3.68:1 pass).
        border: "#8b5cf6",
        solidHover: "#c4b5fd",
        softHover: "#2a2358",
      },
    },
  },
} as const;

export type AccentRole = "primary" | "affirm" | "caution" | "concern" | "info";
