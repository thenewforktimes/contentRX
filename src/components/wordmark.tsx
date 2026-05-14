/**
 * Wordmark — the ContentRX brand mark (v2, 2026-05-13).
 *
 * The pill capsule IS the wordmark. A single rounded pill with a
 * hairline stroke, vertically split into two color halves: "Content"
 * sits on the dark half, "RX" sits on the bright half. One integrated
 * lockup — no separate mark adjacent to letters.
 *
 * Variant 3l from the Claude Design export, adapted to ContentRX:
 *   - Font swapped from Mulish to Inter (already loaded as a variable
 *     font in src/app/layout.tsx — weight 900 is available without
 *     fetching anything new).
 *   - Tokens live in src/app/globals.css under the --crx-* namespace.
 *     They flip with the app via prefers-color-scheme, matching the
 *     existing dark-default + light-override pattern.
 *   - API preserved from the previous wordmark (size, link, mode,
 *     className) so static callsites continue to work without change.
 *
 * Phase 4 audit fix (2026-05-14) — this file used to be a Client
 * Component (`"use client"`) so it could run the framer-motion
 * entrance animation on the marketing homepage. Every other call
 * site (header, footer, dashboard layout, /admin layout, not-found,
 * global-error) passes the default `animate={false}` — but the
 * `"use client"` boundary meant every page rendering the header/
 * footer paid for a client boundary AND shipped framer-motion to the
 * client. Splitting the file into a Server Component for the static
 * lockup + a sibling `animated-wordmark.tsx` Client Component for the
 * homepage hero drops framer-motion from every other route's bundle.
 *
 * If you want the animated variant, import `AnimatedWordmark` from
 * `@/components/animated-wordmark`. Same prop API minus `animate`
 * (it's always animated; the static `Wordmark` is the not-animated
 * path now).
 *
 * Why the integrated pill (vs. the previous separate mark + letters):
 * the previous version had the pill on the LEFT and the word
 * "ContentRX" rendered as text to the RIGHT — two visual elements
 * adjacent to each other. The new design unifies them: the pill is
 * the word. At favicon size only the pill survives (the square mark
 * in /favicon and the og-image); at hero size the letters carry the
 * lockup. Same identity, every scale.
 */

import Link from "next/link";

export type WordmarkSize = "xs" | "sm" | "md" | "lg" | "xl";

type WordmarkProps = {
  /** Visual scale. `xs` (16px) is for global chrome placements —
   * header, footer, dashboard, admin — where the wordmark is
   * supporting infrastructure. `sm` (24px) is the "compact but
   * bold" slot used by the 404 page where the wordmark IS the
   * visual anchor. `xl` is the marketing hero placement. */
  size?: WordmarkSize;
  /** When true, wraps the mark in a Link to home. Default true. Pass
   * false when embedding inside another anchor (e.g., footer column
   * already inside a layout link). */
  link?: boolean;
  /** Force a specific mode regardless of viewer preference. Used for
   * marketing screenshots, OG images, or any context that renders
   * against a known background. Default: inherits from app theme. */
  mode?: "light" | "dark";
  className?: string;
};

export const sizeClass: Record<WordmarkSize, string> = {
  xs: "crx-wordmark--xs",
  sm: "crx-wordmark--sm",
  md: "crx-wordmark--md",
  lg: "crx-wordmark--lg",
  xl: "crx-wordmark--xl",
};

export function Wordmark({
  size = "sm",
  link = true,
  mode,
  className = "",
}: WordmarkProps) {
  const themeAttr = mode ? { "data-theme": mode } : {};

  const content = (
    <span
      {...themeAttr}
      className={`crx-wordmark ${sizeClass[size]} ${className}`.trim()}
      role="img"
      aria-label="ContentRX"
    >
      {/*
       * Inner spans are decorative — the outer role="img" + aria-label
       * is what screen readers announce. Without aria-hidden, some
       * SRs will double-read ("ContentRX" then "Content RX").
       * Matches the pattern in animated-wordmark.tsx.
       */}
      <span className="left" aria-hidden="true">Content</span>
      <span className="right" aria-hidden="true">RX</span>
    </span>
  );

  if (link) {
    return (
      <Link
        href="/"
        aria-label="ContentRX home"
        // The wordmark is the first tab stop on every layout (header
        // chrome). Without a design-system focus ring the browser
        // default outline is inconsistent across canvas / raised
        // surfaces — keyboard users couldn't reliably tell they were
        // focused. `rounded` matches the pill shape so the ring traces
        // the lockup instead of a hard rectangle. WCAG 2.4.7.
        className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        {content}
      </Link>
    );
  }
  return content;
}
