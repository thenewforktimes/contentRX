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
 *   - API preserved from the previous wordmark (size, animate, link,
 *     className) so every callsite continues to work.
 *
 * Animated variant (used in the landing hero only):
 *   - Pill fades in with a subtle scale (0–400ms).
 *   - "Content" letters reveal sequentially with a slide-up
 *     (300–600ms).
 *   - "RX" fades in last (700–1000ms) so the right half settles
 *     into the lockup as the final beat.
 *   - Total ~1s. prefers-reduced-motion falls back to static.
 *
 * Why the integrated pill (vs. the previous separate mark + letters):
 * the previous version had the pill on the LEFT and the word
 * "ContentRX" rendered as text to the RIGHT — two visual elements
 * adjacent to each other. The new design unifies them: the pill is
 * the word. At favicon size only the pill survives (the square mark
 * in /favicon and the og-image); at hero size the letters carry the
 * lockup. Same identity, every scale.
 */

"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

type WordmarkSize = "xs" | "sm" | "md" | "lg" | "xl";

type WordmarkProps = {
  /** Visual scale. `xs` (16px) is for global chrome placements —
   * header, footer, dashboard, admin — where the wordmark is
   * supporting infrastructure. `sm` (24px) is the "compact but
   * bold" slot used by the 404 page where the wordmark IS the
   * visual anchor. `xl` is the marketing hero placement. */
  size?: WordmarkSize;
  /** When true, runs the one-shot pill-fade + letter-reveal on mount.
   * Default false (static). Respects prefers-reduced-motion. */
  animate?: boolean;
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

const sizeClass: Record<WordmarkSize, string> = {
  xs: "crx-wordmark--xs",
  sm: "crx-wordmark--sm",
  md: "crx-wordmark--md",
  lg: "crx-wordmark--lg",
  xl: "crx-wordmark--xl",
};

export function Wordmark({
  size = "sm",
  animate = false,
  link = true,
  mode,
  className = "",
}: WordmarkProps) {
  const reduce = useReducedMotion();
  const shouldAnimate = animate && !reduce;

  const themeAttr = mode ? { "data-theme": mode } : {};

  const content = shouldAnimate ? (
    <AnimatedLockup
      sizeCls={sizeClass[size]}
      themeAttr={themeAttr}
      className={className}
    />
  ) : (
    <StaticLockup
      sizeCls={sizeClass[size]}
      themeAttr={themeAttr}
      className={className}
    />
  );

  if (link) {
    return (
      <Link href="/" aria-label="ContentRX home" className="inline-flex">
        {content}
      </Link>
    );
  }
  return content;
}

function StaticLockup({
  sizeCls,
  themeAttr,
  className,
}: {
  sizeCls: string;
  themeAttr: { "data-theme"?: "light" | "dark" };
  className: string;
}) {
  return (
    <span
      {...themeAttr}
      className={`crx-wordmark ${sizeCls} ${className}`.trim()}
      role="img"
      aria-label="ContentRX"
    >
      <span className="left">Content</span>
      <span className="right">RX</span>
    </span>
  );
}

function AnimatedLockup({
  sizeCls,
  themeAttr,
  className,
}: {
  sizeCls: string;
  themeAttr: { "data-theme"?: "light" | "dark" };
  className: string;
}) {
  // "Content" letters animate in left-to-right. "RX" fades in as the
  // final beat. The pill itself does a subtle scale + opacity entrance
  // so the lockup feels assembled rather than dropped-in.
  const contentLetters = "Content".split("");
  return (
    <motion.span
      {...themeAttr}
      className={`crx-wordmark ${sizeCls} ${className}`.trim()}
      role="img"
      aria-label="ContentRX"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <span className="left" aria-hidden>
        {contentLetters.map((letter, i) => (
          <motion.span
            key={`${letter}-${i}`}
            className="inline-block"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.25,
              delay: 0.3 + i * 0.04,
              ease: "easeOut",
            }}
          >
            {letter}
          </motion.span>
        ))}
      </span>
      <motion.span
        className="right"
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.7, ease: "easeOut" }}
      >
        RX
      </motion.span>
    </motion.span>
  );
}
