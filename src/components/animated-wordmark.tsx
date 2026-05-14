"use client";

/**
 * AnimatedWordmark — the one-shot entrance animation variant of
 * <Wordmark>. Use this on placements where the mark is the visual
 * anchor (currently: the marketing homepage hero). Every other
 * surface (site header, footer, dashboard layout, /admin layout,
 * not-found, global-error) imports the static `Wordmark` from
 * `@/components/wordmark` — which is a Server Component and
 * doesn't ship framer-motion to the client.
 *
 * Animation timeline (~1s total, respects prefers-reduced-motion):
 *   - Pill fades in with a subtle scale (0–400ms).
 *   - "Content" letters reveal sequentially with a slide-up
 *     (300–600ms).
 *   - "RX" fades in last (700–1000ms) so the right half settles
 *     into the lockup as the final beat.
 *
 * Split from the original combined `wordmark.tsx` in Phase 4 of
 * the 2026-05-14 audit. The combined file was `"use client"` so
 * every page rendering the header/footer paid for a client
 * boundary and shipped framer-motion (~50-60 KB gz) regardless of
 * whether the animation actually fired. Now framer-motion only
 * lands in the bundle for routes that import this file.
 */

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { sizeClass, type WordmarkSize } from "@/components/wordmark";

type AnimatedWordmarkProps = {
  /** Visual scale. See `WordmarkSize`. */
  size?: WordmarkSize;
  /** When true, wraps the mark in a Link to home. Default true. */
  link?: boolean;
  /** Force a specific mode regardless of viewer preference. */
  mode?: "light" | "dark";
  className?: string;
};

export function AnimatedWordmark({
  size = "sm",
  link = true,
  mode,
  className = "",
}: AnimatedWordmarkProps) {
  const reduce = useReducedMotion();
  const themeAttr = mode ? { "data-theme": mode } : {};

  // "Content" letters animate in left-to-right. "RX" fades in as the
  // final beat. The pill itself does a subtle scale + opacity entrance
  // so the lockup feels assembled rather than dropped-in.
  const contentLetters = "Content".split("");

  // prefers-reduced-motion: render static markup. We mirror the same
  // markup as the server-safe <Wordmark> so the visual is identical;
  // only the animation drops.
  if (reduce) {
    const staticContent = (
      <span
        {...themeAttr}
        className={`crx-wordmark ${sizeClass[size]} ${className}`.trim()}
        role="img"
        aria-label="ContentRX"
      >
        <span className="left">Content</span>
        <span className="right">RX</span>
      </span>
    );
    if (link) {
      return (
        <Link href="/" aria-label="ContentRX home" className="inline-flex">
          {staticContent}
        </Link>
      );
    }
    return staticContent;
  }

  const animatedContent = (
    <motion.span
      {...themeAttr}
      className={`crx-wordmark ${sizeClass[size]} ${className}`.trim()}
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

  if (link) {
    return (
      <Link href="/" aria-label="ContentRX home" className="inline-flex">
        {animatedContent}
      </Link>
    );
  }
  return animatedContent;
}
