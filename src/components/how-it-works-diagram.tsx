"use client";

/**
 * HowItWorksDiagram — story-based pipeline animation.
 *
 * v2 (2026-04-29): the animation went from "stages glow in sequence"
 * to "a real example travels through the pipeline." Each stage
 * reveals its output as the active step arrives. By the end of one
 * loop, the viewer has seen ContentRX evaluate one string end-to-end:
 * "Click here" → classified as a button label → standards narrowed →
 * reviewed → verdict card with suggestion + severity + confidence.
 *
 * Why story over pulse: the pulse version was abstract (boxes light
 * up). The story version is concrete (you watch one string get
 * evaluated). Same six-second runtime; the read is dramatically
 * different.
 *
 * Loop shape: 6 ticks at 1.5s each.
 *   - ticks 0–4: each stage activates in turn
 *   - tick 5: all stages reset to pending (brief pause before relooping)
 * Total 9s loop. The pause prevents a hard snap when stage 4
 * (verdict) → stage 0 (input) on the next cycle.
 *
 * Accessibility:
 *   - The whole thing is an ordered list; screen readers walk
 *     the stages in order, including the example output baked into
 *     each stage's static text.
 *   - Animation respects `prefers-reduced-motion`. With reduce on,
 *     the diagram renders fully revealed (all stages "complete") so
 *     readers see the full pipeline at a glance, no motion.
 *
 * Substrate boundary (ADR 2026-04-25): customer-readable terms only.
 * No taxonomy names, no `standard_id`, no rule version. The stages
 * are described in plain language.
 */

import { useEffect, useState } from "react";

interface Stage {
  /** Short stage label. */
  label: string;
  /** One-line description below the label, always visible. */
  caption: string;
  /** What the stage outputs once active/complete. JSX so we can
   *  render mini-pills, dots, etc. */
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

const TICK_MS = 1500;
const TOTAL_TICKS = STAGES.length + 1; // +1 for the pause-before-loop tick

type StageState = "pending" | "active" | "complete";

export function HowItWorksDiagram() {
  const [tick, setTick] = useState(0);
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
    const interval = setInterval(() => {
      setTick((prev) => (prev + 1) % TOTAL_TICKS);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [reduceMotion]);

  // tick 0..4 = active stage = tick. tick 5 = reset, no active stage.
  const activeStage = tick < STAGES.length ? tick : -1;

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
  // Active and complete reveal the output; pending hides it (with
  // height preserved via min-h so the layout doesn't jump).
  return (
    <div
      data-state={state}
      className={[
        "flex flex-1 flex-col rounded-lg border px-4 py-3",
        "transition-all duration-500 ease-out",
        // pending: stone, default
        "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950",
        // active: emerald lift + glow
        "data-[state=active]:-translate-y-0.5 data-[state=active]:border-emerald-500 data-[state=active]:bg-emerald-50 data-[state=active]:shadow-sm data-[state=active]:dark:border-emerald-500 data-[state=active]:dark:bg-emerald-950/40",
        // complete: emerald-tinted, no lift
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

/**
 * Connector — chevron between stages. Animates colour as the
 * preceding stage completes.
 */
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

/**
 * ThinkingDots — three dots that pulse to suggest the reviewer is
 * working. Only animates when the parent stage is in active state;
 * the parent's transition handles fade-in/out for the whole block.
 */
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
 * VerdictCard — the payoff. Shows a real-shaped verdict envelope
 * for the pipeline's example string. The four fields here are the
 * full public envelope: issue, suggestion, severity, confidence.
 */
function VerdictCard() {
  return (
    <div className="space-y-1 text-[11px] leading-tight">
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
    </div>
  );
}
