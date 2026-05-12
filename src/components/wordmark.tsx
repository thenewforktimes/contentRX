/**
 * Wordmark — the ContentRX brand mark with two render modes.
 *
 * Static variant (default, used in <SiteHeader> and <SiteFooter>):
 *   - A two-tone pill capsule (Dr. Mario reference) sits to the left
 *     of the wordmark. Left half ink-strong, right half bright teal
 *     (the `--accent-affirm` solid slot). The vertical split echoes
 *     the wordmark's own two-tone treatment: "Content" in ink, "RX"
 *     in teal. The pill is the brand mark; the wordmark is the
 *     brand. Together they read as one identity.
 *   - Mixed-weight typography: "Content" at font-semibold, "RX" at
 *     font-bold in the affirm-text accent color. The 100-weight gap
 *     is intentional; "Content" is the noun, "RX" is the signature.
 *
 * Animated variant (used in the landing hero only):
 *   - The two halves of the pill fade in from the sides and meet in
 *     the middle (left half settles first, right half a beat later)
 *     so the pill reads as a capsule being assembled.
 *   - Reveals the "Content" letters left-to-right with a small
 *     stagger, then "RX" pops in scaled.
 *   - One-shot animation. `prefers-reduced-motion` skips it.
 *
 * Why a pill, not a circle: the circle was generic and visually
 * redundant — the wordmark already said "RX." A pill carries the
 * literal Rx → ContentRX semantic the circle couldn't, and a
 * pill has a real baseline (no optical center vs baseline drift).
 * The two-tone vertical split lets the mark stand alone at favicon
 * size while still echoing the wordmark's color treatment at hero
 * size.
 *
 * Pill geometry: 1.6:1 aspect (close to Dr. Mario without going
 * fully elongated). Vertical 50/50 color split. No stroke, no inner
 * text — pure shape, two fills meeting at the center. Viewbox
 * `0 0 32 20` so the radius math works out to clean integers
 * (height 20 → radius 10 → straight section from x=10 to x=22 →
 * total width 32).
 *
 * Token contract: `fill-strong` for the left half (= --text-strong
 * as a fill) and `fill-accent-affirm` for the right half (= the
 * bright solid slot). Both mapped via @theme inline in globals.css,
 * so a palette change propagates without touching this file.
 */

"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

type WordmarkSize = "sm" | "md" | "lg" | "xl";

type WordmarkProps = {
  /** Visual scale. `sm` is for the global header; `xl` is for hero
   * placements. */
  size?: WordmarkSize;
  /** When true, runs the one-shot capsule-assembly + letter-reveal
   * on mount. Default false (static). Animation respects
   * prefers-reduced-motion automatically. */
  animate?: boolean;
  /** When true, wraps the mark in a Link to home. Default true.
   * Pass false when embedding inside another anchor. */
  link?: boolean;
  className?: string;
};

/**
 * Per-size geometry. `mark` keeps a clean 1.6:1 aspect ratio across
 * every size via arbitrary widths — Tailwind's standard steps don't
 * land on exact 1.6× height, so the arbitrary values keep the pill
 * proportions consistent at every scale instead of letting the
 * pill stretch or flatten from one size to the next.
 */
const sizeClasses: Record<WordmarkSize, {
  text: string;
  mark: string;
  gap: string;
}> = {
  sm: {
    text: "text-base font-semibold tracking-tight",
    mark: "h-5 w-8", // 20×32
    gap: "gap-2",
  },
  md: {
    text: "text-xl font-semibold tracking-tight",
    mark: "h-6 w-[2.4rem]", // 24×38.4
    gap: "gap-2.5",
  },
  lg: {
    text: "text-3xl font-semibold tracking-tight",
    mark: "h-9 w-[3.6rem]", // 36×57.6
    gap: "gap-3",
  },
  xl: {
    text: "text-5xl font-semibold tracking-tight sm:text-6xl",
    mark: "h-12 w-[4.8rem] sm:h-14 sm:w-[5.6rem]", // 48×76.8 → 56×89.6
    gap: "gap-3.5 sm:gap-4",
  },
};

export function Wordmark({
  size = "sm",
  animate = false,
  link = true,
  className = "",
}: WordmarkProps) {
  const reduce = useReducedMotion();
  const cls = sizeClasses[size];

  // When animating, fall back to the static layout if reduced motion
  // is set so the wordmark still looks intentional, just without
  // the capsule-assembly motion.
  const shouldAnimate = animate && !reduce;

  const content = (
    <span
      className={`inline-flex items-center ${cls.gap} ${className}`.trim()}
      aria-label="ContentRX"
    >
      <Mark sizeCls={cls.mark} animate={shouldAnimate} />
      <Letters textCls={cls.text} animate={shouldAnimate} />
    </span>
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

function Mark({
  sizeCls,
  animate,
}: {
  sizeCls: string;
  animate: boolean;
}) {
  // Pill viewBox: 32 wide, 20 tall (1.6:1). Radius 10 at the rounded
  // ends; the straight section runs x=10 → x=22 with the vertical
  // split at x=16 (dead center).
  //
  // Each half is a half-pill path: one rounded end + a flat side
  // meeting the centerline. Two paths, two fills, meeting at x=16
  // with no seam visible because the fills butt edge-to-edge.
  //
  // Left half:  starts at top-center, runs left to where the curve
  //             begins (x=10), arcs around to the bottom of the curve
  //             (x=10, y=20), runs right back to bottom-center, closes.
  // Right half: mirror of the left.
  return (
    <motion.span
      // Mark alignment: relies on `items-center` on the parent flex
      // (see `content` in <Wordmark>) to put the mark's visual center
      // on the same horizontal line as the wordmark's letterform
      // center. The pill's flat top/bottom edges read more cleanly
      // against the wordmark's baseline than the circle's curve did.
      className={`relative inline-flex shrink-0 items-center justify-center ${sizeCls}`}
    >
      <svg
        viewBox="0 0 32 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        className="h-full w-full"
      >
        <motion.path
          d="M 16 0 H 10 A 10 10 0 0 0 10 20 H 16 Z"
          className="fill-strong"
          initial={animate ? { opacity: 0, x: -3 } : false}
          animate={animate ? { opacity: 1, x: 0 } : undefined}
          transition={
            animate
              ? { duration: 0.4, ease: "easeOut", delay: 0 }
              : undefined
          }
        />
        <motion.path
          d="M 16 0 H 22 A 10 10 0 0 1 22 20 H 16 Z"
          className="fill-accent-affirm"
          initial={animate ? { opacity: 0, x: 3 } : false}
          animate={animate ? { opacity: 1, x: 0 } : undefined}
          transition={
            animate
              ? { duration: 0.4, ease: "easeOut", delay: 0.15 }
              : undefined
          }
        />
      </svg>
    </motion.span>
  );
}

function Letters({
  textCls,
  animate,
}: {
  textCls: string;
  animate: boolean;
}) {
  // "Content" is a single span when not animating; when animating,
  // each letter slides + fades in sequentially. The cumulative
  // duration is ~400ms, kept under the pill's full assembly so the
  // whole reveal completes around 1s.
  if (!animate) {
    return (
      <span className={`text-strong ${textCls}`} aria-hidden>
        Content<span className="text-accent-affirm">RX</span>
      </span>
    );
  }
  const letters = "Content".split("");
  return (
    <span className={`text-strong ${textCls}`} aria-hidden>
      {letters.map((letter, i) => (
        <motion.span
          key={`${letter}-${i}`}
          className="inline-block"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.3,
            delay: 0.4 + i * 0.04,
            ease: "easeOut",
          }}
        >
          {letter}
        </motion.span>
      ))}
      <motion.span
        className="inline-block text-accent-affirm"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.75, ease: "easeOut" }}
      >
        RX
      </motion.span>
    </span>
  );
}
