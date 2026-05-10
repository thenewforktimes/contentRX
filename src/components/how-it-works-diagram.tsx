"use client";

/**
 * HowItWorksDiagram — story-based pipeline animation, v5.
 *
 * v5 (2026-05-03): customer-shaped rewrite. Pipeline-stage labels
 * (Classify / Filter / Review / Verdict) leaked engineer-speak onto
 * a marketing surface — same shape ADR 2026-04-25 forbids for
 * taxonomy names. Replaced with five short imperatives that name
 * the *customer's* arc through the loop:
 *
 *   1. Choose a surface          ← customer action
 *   2. Check your string         ← customer action
 *   3. We do the hard eval work  ← our promise
 *   4. We report and suggest     ← our output
 *   5. You decide                ← customer agency (ADR 2026-04-28)
 *
 * Same v5 pass also: normalized container shape (fixed heights,
 * drop translate-y + shadow on active state — color + content
 * reveal alone do the work); migrated raw emerald-* shades to the
 * affirm tokens so the diagram inherits the teal palette refresh
 * (#331); tightened the loop to ~5.5s with uniform 1s pacing
 * (was 8.5s with variable per-stage durations).
 *
 * v4 (2026-04-29) cut the traveling pill + progress track.
 *
 * Accessibility:
 *   - The whole thing is an ordered list; screen readers walk the
 *     stages in order with their static labels.
 *   - prefers-reduced-motion: animation is disabled (the cycle
 *     stops, all stages render fully revealed).
 *
 * Substrate boundary (ADR 2026-04-25): customer-readable terms
 * only. No taxonomy names, no `standard_id`, no rule version.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Pill } from "@/components/ui/pill";

interface Stage {
  /** Short imperative — one full thought per stage. */
  label: string;
  /** What the stage outputs once active/complete. Single inline element. */
  output: React.ReactNode;
}

const STAGES: ReadonlyArray<Stage> = [
  {
    label: "Choose a surface",
    output: <SurfaceChip />,
  },
  {
    label: "Check your string",
    output: <code className="font-mono text-xs text-default">&quot;Click here&quot;</code>,
  },
  {
    label: "We do the hard eval work",
    output: <ThinkingDots />,
  },
  {
    label: "We report and suggest",
    output: <SuggestionChip />,
  },
  {
    label: "You decide",
    output: <DecisionChip />,
  },
];

/** Uniform 1s per stage; Verdict gets a touch longer to let the eye rest. */
const STAGE_DURATIONS_MS: ReadonlyArray<number> = [
  1000, 1000, 1000, 1000, 1500,
];
const RESET_PAUSE_MS = 500;
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
              {/* Always render the chevron slot so every li reserves the
                  same vertical (or horizontal on mobile) space. Without
                  this placeholder on the last stage, items-stretch lets
                  card 5 grow into the slot the others reserve for the
                  chevron, making it visibly taller. */}
              <Connector
                active={state === "complete"}
                hidden={i === STAGES.length - 1}
              />
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-quiet">
        Each stage compresses what reaches the LLM down to the
        standards that actually apply to your check in your moment.
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
        // Cards stretch to the tallest peer via flex `items-stretch`
        // on the parent, so they stay row-aligned without a fixed
        // pixel height. Top-down content flow with uniform spacing
        // — empty space (if any) sits naturally at the bottom.
        "flex flex-1 flex-col rounded-lg border px-4 py-3",
        "transition-colors duration-500 ease-out",
        "border-line bg-raised",
        "data-[state=active]:border-accent-affirm-border data-[state=active]:bg-accent-affirm-soft",
        "data-[state=complete]:border-accent-affirm-border/60 data-[state=complete]:bg-accent-affirm-soft/40",
      ].join(" ")}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-quiet">
        Stage {index + 1}
      </p>
      {/* Reserve 2 lines of vertical space for the label even when the
          text fits on one ("You decide"). Without this, single-line
          labels collapse the column and the output below them sits
          higher in the card than its peers. 2.5rem = 2 × 14px ×
          leading-snug rounded up. */}
      <p className="mt-1 min-h-10 text-sm font-semibold leading-snug text-strong">
        {stage.label}
      </p>
      <div
        className={[
          // Uniform 12px gap from the label (no mt-auto — that
          // produced variable empty space when label length varied
          // between 1 and 2 lines).
          "mt-3 flex items-center transition-opacity duration-500",
          state === "pending" ? "opacity-0" : "opacity-100",
        ].join(" ")}
        aria-hidden={state === "pending"}
      >
        {stage.output}
      </div>
    </div>
  );
}

function Connector({
  active,
  hidden = false,
}: {
  active: boolean;
  /** Reserve the layout space but render nothing — used on the last
      stage so the row stays uniform without a trailing chevron. */
  hidden?: boolean;
}) {
  return (
    <div
      data-active={active ? "true" : "false"}
      className={[
        "flex shrink-0 items-center justify-center self-center text-line transition-colors duration-500 data-[active=true]:text-accent-affirm sm:self-auto sm:py-1",
        hidden ? "invisible" : "",
      ].join(" ")}
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
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent-primary" />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent-primary [animation-delay:0.2s]" />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent-primary [animation-delay:0.4s]" />
    </span>
  );
}

/** Stage 1 — one of the surfaces a customer can plug into. */
function SurfaceChip() {
  return (
    <Pill tone="neutral" size="xs">
      Dashboard
    </Pill>
  );
}

/**
 * Stage 4 — the engine's suggestion. Plain pill (no mono, no quotes)
 * to match Stage 1's surface chip in width and weight; the amber
 * tone alone signals "engine output, worth a look." Pops in with a
 * small spring when the stage activates.
 */
function SuggestionChip() {
  return (
    <motion.span
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="inline-flex"
    >
      <Pill tone="amber" size="xs">
        View pricing
      </Pill>
    </motion.span>
  );
}

/** Stage 5 — the customer's call. Affirm tone reinforces the agency. */
function DecisionChip() {
  return (
    <Pill tone="emerald" size="xs">
      Apply
    </Pill>
  );
}
