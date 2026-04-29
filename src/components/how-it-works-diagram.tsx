"use client";

/**
 * HowItWorksDiagram — story-based pipeline animation, v4.
 *
 * v4 (2026-04-29): cut the traveling pill + progress track.
 * Robert's call: the cards transitioning to emerald carry the
 * story; the horizontal pill was extending past the visible work
 * and reading as redundant. The cards do the work.
 *
 * v3 kept: variable per-stage timing (1s setup, 2s Review,
 * 2.5s Verdict), framer-motion-driven verdict-card spring,
 * Tailwind data-state transitions on the cards.
 *
 * Loop shape: 5 stages with variable durations + 1 reset tick.
 *   tick 0 (1.0s): "Your string"
 *   tick 1 (1.0s): "Classify" → button label
 *   tick 2 (1.0s): "Filter" → standards narrowed
 *   tick 3 (2.0s): "Review" → thinking dots
 *   tick 4 (2.5s): "Verdict" → suggestion + severity + confidence
 *   tick 5 (1.0s): reset (all pending)
 * Total ~8.5s loop.
 *
 * Accessibility:
 *   - The whole thing is an ordered list; screen readers walk the
 *     stages in order with their static labels + captions.
 *   - prefers-reduced-motion: animation is disabled (the cycle
 *     stops, all stages render fully revealed).
 *
 * Substrate boundary (ADR 2026-04-25): customer-readable terms
 * only. No taxonomy names, no `standard_id`, no rule version.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Stage {
  /** Short stage label. */
  label: string;
  /** One-line description below the label, always visible. */
  caption: string;
  /** What the stage outputs once active/complete. */
  output: React.ReactNode;
}

const STAGES: ReadonlyArray<Stage> = [
  {
    label: "Your string",
    caption: "What gets shipped",
    output: <code className="font-mono text-xs">&quot;Click here&quot;</code>,
  },
  {
    label: "Classify",
    caption: "Recognise the moment",
    output: <span className="text-xs">button label</span>,
  },
  {
    label: "Filter",
    caption: "Narrow the standards",
    output: <span className="text-xs">standards narrowed</span>,
  },
  {
    label: "Review",
    caption: "Apply the judgment",
    output: <ThinkingDots />,
  },
  {
    label: "Verdict",
    caption: "Issue, suggestion, severity",
    output: <VerdictCard />,
  },
];

/** Setup stages tick fast; Review + Verdict linger so the payoff reads. */
const STAGE_DURATIONS_MS: ReadonlyArray<number> = [
  1000, 1000, 1000, 2000, 2500,
];
const RESET_PAUSE_MS = 1000;
const RESET_TICK = STAGE_DURATIONS_MS.length;

type StageState = "pending" | "active" | "complete";

export function HowItWorksDiagram() {
  const [activeTick, setActiveTick] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = (current: number) => {
      if (cancelled) return;
      setActiveTick(current);
      const duration =
        current === RESET_TICK
          ? RESET_PAUSE_MS
          : STAGE_DURATIONS_MS[current];
      timeoutId = setTimeout(() => {
        const next = (current + 1) % (RESET_TICK + 1);
        tick(next);
      }, duration);
    };

    tick(0);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [reduceMotion]);

  const isResetState = activeTick === RESET_TICK;
  const activeStage = isResetState ? -1 : activeTick;

  return (
    <div className="my-8" aria-label="ContentRX evaluation pipeline">
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-2">
        {STAGES.map((stage, i) => {
          const state: StageState = reduceMotion
            ? "complete"
            : activeStage === -1
              ? "pending"
              : i < activeStage
                ? "complete"
                : i === activeStage
                  ? "active"
                  : "pending";
          return (
            <li
              key={stage.label}
              className="flex flex-1 items-stretch gap-2 sm:flex-col sm:items-stretch"
            >
              <StageCard stage={stage} index={i} state={state} />
              {i < STAGES.length - 1 && (
                <Connector active={state === "complete"} />
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-stone-500 dark:text-stone-400">
        Each stage compresses what reaches the LLM down to the
        standards that actually apply to your string in your moment.
        That&apos;s the model around the model.
      </p>
    </div>
  );
}

function StageCard({
  stage,
  index,
  state,
}: {
  stage: Stage;
  index: number;
  state: StageState;
}) {
  return (
    <div
      data-state={state}
      className={[
        "flex flex-1 flex-col rounded-lg border px-4 py-3",
        "transition-all duration-500 ease-out",
        "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950",
        "data-[state=active]:-translate-y-0.5 data-[state=active]:border-emerald-500 data-[state=active]:bg-emerald-50 data-[state=active]:shadow-sm data-[state=active]:dark:border-emerald-500 data-[state=active]:dark:bg-emerald-950/40",
        "data-[state=complete]:border-emerald-200 data-[state=complete]:bg-emerald-50/50 data-[state=complete]:dark:border-emerald-900 data-[state=complete]:dark:bg-emerald-950/20",
      ].join(" ")}
    >
      <p className="text-[10px] font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400">
        Stage {index + 1}
      </p>
      <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">
        {stage.label}
      </p>
      <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
        {stage.caption}
      </p>
      <div
        className={[
          "mt-3 min-h-[2.25rem] transition-opacity duration-500",
          state === "pending"
            ? "opacity-0"
            : "opacity-100 text-stone-700 dark:text-stone-200",
        ].join(" ")}
        aria-hidden={state === "pending"}
      >
        {stage.output}
      </div>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div
      data-active={active ? "true" : "false"}
      className="flex shrink-0 items-center justify-center self-center text-stone-300 transition-colors duration-500 data-[active=true]:text-emerald-500 dark:text-stone-700 data-[active=true]:dark:text-emerald-400 sm:self-auto sm:py-1"
      aria-hidden
    >
      <svg
        viewBox="0 0 12 12"
        className="h-3 w-3 rotate-90 sm:rotate-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 2 L8 6 L4 10" />
      </svg>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-end gap-1" aria-label="Reviewing">
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-emerald-500 [animation-delay:0.2s]" />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-emerald-500 [animation-delay:0.4s]" />
    </span>
  );
}

/**
 * VerdictCard — the payoff. Pops in with a small spring when the
 * Verdict stage activates. Framer Motion's `key` reset on
 * activation triggers the entrance animation each loop.
 */
function VerdictCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      className="space-y-1 text-[11px] leading-tight"
    >
      <p>
        <span className="font-mono text-stone-500 dark:text-stone-400">
          suggestion:
        </span>{" "}
        <span className="font-medium text-stone-900 dark:text-stone-100">
          &ldquo;View pricing&rdquo;
        </span>
      </p>
      <div className="flex gap-1">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          high
        </span>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          0.96
        </span>
      </div>
    </motion.div>
  );
}
