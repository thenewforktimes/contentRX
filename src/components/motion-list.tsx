"use client";

/**
 * MotionList — staggered fade-up entrance for a vertical column
 * of sections. The first place we reach for when a page benefits
 * from a subtle "the surface assembled" feel rather than a hard
 * paint.
 *
 * Usage:
 *   <MotionList className="flex flex-col gap-6">
 *     <SectionA />
 *     <SectionB />
 *     <SectionC />
 *   </MotionList>
 *
 * Each direct child is wrapped in a motion.div with a staggered
 * delay (60ms between siblings). Server Components can be passed
 * as children — the wrapper is a Client Component, but the
 * children render as opaque nodes (Server-Component compatibility
 * preserved).
 *
 * Accessibility: respects prefers-reduced-motion via
 * useReducedMotion (Framer Motion's built-in hook). With reduce
 * on, items render at their final state with no animation.
 */

import { motion, useReducedMotion } from "framer-motion";
import { Children, type ReactNode } from "react";

interface MotionListProps {
  children: ReactNode;
  className?: string;
  /** Delay between sibling entrances. Defaults to 60ms — slow
   *  enough to read as a stagger, fast enough not to feel sleepy. */
  staggerMs?: number;
}

export function MotionList({
  children,
  className,
  staggerMs = 60,
}: MotionListProps) {
  const reduceMotion = useReducedMotion();

  const stagger = (reduceMotion ? 0 : staggerMs) / 1000;
  const duration = reduceMotion ? 0 : 0.3;

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger } },
      }}
    >
      {Children.map(children, (child, i) => (
        <motion.div
          key={i}
          variants={{
            hidden: { opacity: 0, y: reduceMotion ? 0 : 6 },
            visible: {
              opacity: 1,
              y: 0,
              transition: { duration, ease: [0.4, 0, 0.2, 1] },
            },
          }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
