/**
 * Wordmark — the ContentRX brand mark with two render modes.
 *
 * Static variant (default, used in <SiteHeader> and <SiteFooter>):
 *   - Mixed-weight typography: "Content" at font-semibold, "RX" at
 *     font-bold in the affirm-text accent color. The 100-weight gap
 *     is intentional; "Content" is the noun, "RX" is the signature.
 *     Bumped from font-medium → font-semibold 2026-05-10 alongside
 *     the marketing h1 weight bump (#477) to keep the wordmark
 *     visually present against the new h1 weight.
 *   - Tiny circular mark before the text — "RX" in a soft-bordered
 *     pill. Reads as a brand signature without depending on a
 *     custom illustration.
 *
 * Animated variant (used in the landing hero only):
 *   - Stroke-draws the circle mark on mount.
 *   - Reveals the "Content" letters left-to-right with a small
 *     stagger, then "RX" pops in scaled.
 *   - One-shot animation. `prefers-reduced-motion` skips it.
 *
 * The accent color comes from a single token (--color-accent-primary
 * via accent-affirm-text). One change to the token recolors the
 * wordmark everywhere it appears.
 *
 * Why "RX" lands in the accent color: the cheapest possible visual
 * signature. Customers say "ContentRX" and the eye learns to expect
 * the two-tone treatment — that becomes the brand. No custom asset
 * required.
 */

"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

type WordmarkSize = "sm" | "md" | "lg" | "xl";

type WordmarkProps = {
  /** Visual scale. `sm` is for the global header; `xl` is for hero
   * placements. */
  size?: WordmarkSize;
  /** When true, runs the one-shot stroke-draw + letter-reveal on
   * mount. Default false (static). Animation respects
   * prefers-reduced-motion automatically. */
  animate?: boolean;
  /** When true, wraps the mark in a Link to home. Default true.
   * Pass false when embedding inside another anchor. */
  link?: boolean;
  className?: string;
};

const sizeClasses: Record<WordmarkSize, {
  text: string;
  mark: string;
  markText: string;
  gap: string;
}> = {
  sm: {
    text: "text-base font-semibold tracking-tight",
    mark: "h-5 w-5",
    markText: "text-[9px] font-bold tracking-tight",
    gap: "gap-1.5",
  },
  md: {
    text: "text-xl font-semibold tracking-tight",
    mark: "h-6 w-6",
    markText: "text-[10px] font-bold tracking-tight",
    gap: "gap-2",
  },
  lg: {
    text: "text-3xl font-semibold tracking-tight",
    mark: "h-9 w-9",
    markText: "text-sm font-bold tracking-tight",
    gap: "gap-2.5",
  },
  xl: {
    text: "text-5xl font-semibold tracking-tight sm:text-6xl",
    mark: "h-12 w-12 sm:h-14 sm:w-14",
    markText: "text-lg font-bold tracking-tight sm:text-xl",
    gap: "gap-3 sm:gap-4",
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
  // the stroke-draw.
  const shouldAnimate = animate && !reduce;

  const content = (
    <span
      className={`inline-flex items-center ${cls.gap} ${className}`.trim()}
      aria-label="ContentRX"
    >
      <Mark
        sizeCls={cls.mark}
        markTextCls={cls.markText}
        animate={shouldAnimate}
      />
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
  markTextCls,
  animate,
}: {
  sizeCls: string;
  markTextCls: string;
  animate: boolean;
}) {
  // The mark is a circle with "RX" inside — accent-colored stroke,
  // accent-colored text. When animating, the circle stroke draws
  // itself in over ~600ms and the text fades in just after.
  return (
    <motion.span
      // Mark alignment: relies on `items-center` on the parent flex
      // (see `content` in <Wordmark>) to put the mark's visual center
      // on the same horizontal line as the wordmark's letterform
      // center. Earlier drafts used `items-baseline` + a +0.08em
      // nudge, but baseline-alignment finds a real baseline on the
      // text and falls back to the bounding-box bottom on the mark
      // (because flex doesn't know circles aren't text). The result
      // was the mark sitting ~0.45em higher than the wordmark's
      // optical center — pronounced at xl size where the mark and
      // text are nearly the same height.
      className={`relative inline-flex shrink-0 items-center justify-center ${sizeCls}`}
      initial={animate ? { opacity: 0, scale: 0.8 } : false}
      animate={animate ? { opacity: 1, scale: 1 } : undefined}
      transition={animate ? { duration: 0.4, delay: 0 } : undefined}
    >
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        className="absolute inset-0 h-full w-full"
      >
        <motion.circle
          cx="20"
          cy="20"
          r="18"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="text-accent-affirm-text"
          initial={animate ? { pathLength: 0 } : false}
          animate={animate ? { pathLength: 1 } : undefined}
          transition={animate ? { duration: 0.7, ease: "easeOut" } : undefined}
        />
      </svg>
      <motion.span
        className={`relative z-10 text-accent-affirm-text ${markTextCls}`}
        initial={animate ? { opacity: 0 } : false}
        animate={animate ? { opacity: 1 } : undefined}
        transition={
          animate ? { duration: 0.3, delay: 0.5 } : undefined
        }
      >
        RX
      </motion.span>
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
  // duration is ~400ms, kept under the mark's stroke-draw so the
  // whole reveal completes around 1s.
  if (!animate) {
    return (
      <span className={`text-strong ${textCls}`} aria-hidden>
        Content<span className="text-accent-affirm-text">RX</span>
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
            delay: 0.2 + i * 0.04,
            ease: "easeOut",
          }}
        >
          {letter}
        </motion.span>
      ))}
      <motion.span
        className="inline-block text-accent-affirm-text"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.6, ease: "easeOut" }}
      >
        RX
      </motion.span>
    </span>
  );
}
