"use client";

/**
 * HowItWorksDiagram — story-based pipeline animation, v3.
 *
 * v3 changes (2026-04-29):
 *   - Variable per-stage timing. The setup stages (Your string,
 *     Classify, Filter) tick fast at 1s each; Review pauses at 2s
 *     to suggest the LLM is working; Verdict lingers at 2.5s so
 *     the payoff has time to read before the loop resets.
 *   - Traveling pill on desktop. A small emerald marker rides a
 *     horizontal track at the top of the diagram, filling the
 *     trail behind it as it advances. Hidden on mobile where the
 *     stages stack vertically and the marker would be redundant.
 *   - Framer Motion drives the pill + trail + verdict-card pop.
 *     Stage cards still use Tailwind data-state transitions
 *     (simpler, no over-engineering for fade-in/out).
 *
 * Loop shape: 5 stages with variable durations + 1 reset tick.
 *   tick 0 (1.0s): "Your string"
 *   tick 1 (1.0s): "Classify" → button label
 *   tick 2 (1.0s): "Filter" → standards narrowed
 *   tick 3 (2.0s): "Review" → thinking dots
 *   tick 4 (2.5s): "Verdict" → suggestion + severity + confidence
 *   tick 5 (1.0s): reset (all pending, pill off-screen)
 * Total ~8.5s loop. The setup-fast / payoff-slow shape was
 * Robert's call: the diagram now telegraphs the work that goes
 * into the verdict.
 *
 * Accessibility:
 *   - The whole thing is an ordered list; screen readers walk the
 *     stages in order with their static labels + captions.
 *   - prefers-reduced-motion: animation is disabled (the cycle
 *     stops, the pill is hidden, all stages render fully revealed).
 *
 * Substrate boundary (ADR 2026-04-25): customer-readable terms
 * only. No taxonomy names, no `standard_id`, no rule version.
 */

import { AnimatePresence, motion } from "framer-motion";
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
      <PillTrack
        activeStage={activeStage}
        stageCount={STAGES.length}
        reduceMotion={reduceMotion}
      />
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

/**
 * PillTrack — horizontal progress track at the top of the diagram
 * with a traveling pill marker. Desktop only; on mobile the
 * stage stack reads top-to-bottom and a horizontal pill is
 * redundant.
 *
 * Position math: 5 stages, evenly spaced. Stage i sits at the
 * (i + 0.5) / N portion of the track. The pill targets that
 * position when stage i is active.
 */
function PillTrack({
  activeStage,
  stageCount,
  reduceMotion,
}: {
  activeStage: number;
  stageCount: number;
  reduceMotion: boolean;
}) {
  const isResetState = activeStage === -1;
  const positionPct = isResetState
    ? 0
    : ((activeStage + 0.5) / stageCount) * 100;

  if (reduceMotion) return null;

  return (
    <div className="relative mb-3 hidden h-1.5 w-full sm:block" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-stone-200 dark:bg-stone-800" />
      {/* trail fills as the pill advances */}
      <motion.div
        className="absolute left-0 top-0 h-full rounded-full bg-emerald-500"
        animate={{ width: `${positionPct}%` }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      />
      {/* leading pill marker */}
      <AnimatePresence>
        {!isResetState && (
          <motion.div
            key="pill"
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{
              left: `${positionPct}%`,
              opacity: 1,
              scale: 1,
            }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{
              left: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.2 },
              scale: { duration: 0.2 },
            }}
          />
        )}
      </AnimatePresence>
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
