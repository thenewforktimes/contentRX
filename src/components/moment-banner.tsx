/**
 * "Moment detected" banner — the first-class UI surface for the
 * moment detection step.
 *
 * Human-eval build plan Session 22. Sits ABOVE the verdict on every
 * verdict-presenting surface so the user sees the detected moment
 * before they see the flags — context first, judgment second.
 *
 * Matches the plan's language: "I noticed this looks like a
 * destructive_action; I'm applying these three standards." The
 * correction flow opens a dropdown of the 13 canonical moments;
 * picking a different one posts to `/api/feedback/rationale` with
 *   hop_step = "detect_moment"
 *   correction_type = "situation_ambiguity"
 *   original_value = detected moment
 *   corrected_value = user-picked moment
 *
 * This routes into the moment-classifier backlog (per plan) rather
 * than the standards backlog — Session 21's rationale-chain feedback
 * schema already supports this.
 */

"use client";

import { useState } from "react";
import {
  MOMENT_DESCRIPTIONS,
  SITUATION_PROPERTY_BY_MOMENT,
  summarizeMomentBanner,
  type MomentWeightsSummary,
} from "@/lib/moment-metadata";
import { MOMENTS, type Moment } from "@/lib/engine-taxonomy";

export const DOCS_BASE_URL = "https://docs.contentrx.io";

export interface MomentBannerProps {
  /** Detected moment from CheckResult.moment. */
  moment: string;
  /**
   * Precomputed weight counts for every moment. Rendered next to each
   * dropdown option so the user sees "task_execution (4)" while
   * picking. The Server Component that owns this banner builds the
   * map via `getAllMomentWeightsSummaries()` and passes it through.
   */
  summaries: Record<string, MomentWeightsSummary>;
  /** sha256 of the user's text — posted to the feedback endpoint. */
  textHash: string;
  /** Which client is surfacing this. */
  source: "plugin" | "cli" | "action" | "dashboard" | "mcp";
  /** Override for the feedback POST target. Defaults to the relative route. */
  feedbackUrl?: string;
}

type SubmitState = "idle" | "submitting" | "done" | "error";

export function MomentBanner({
  moment,
  summaries,
  textHash,
  source,
  feedbackUrl = "/api/feedback/rationale",
}: MomentBannerProps) {
  const [correcting, setCorrecting] = useState(false);
  const [picked, setPicked] = useState<string>("");
  const [state, setState] = useState<SubmitState>("idle");
  const [savedCorrection, setSavedCorrection] = useState<string | null>(null);

  const summary = summaries[moment] ?? null;
  const subline = summarizeMomentBanner(moment, summary);
  const situation = SITUATION_PROPERTY_BY_MOMENT[moment as Moment];
  const description = MOMENT_DESCRIPTIONS[moment as Moment];

  const dropdownOptions = MOMENTS.filter((m) => m !== moment);

  async function submitCorrection() {
    if (!picked || picked === moment) return;
    setState("submitting");
    try {
      const res = await fetch(feedbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text_hash: textHash,
          hop_step: "detect_moment",
          correction_type: "situation_ambiguity",
          original_value: moment,
          corrected_value: picked,
          source,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSavedCorrection(picked);
      setState("done");
      setCorrecting(false);
    } catch {
      setState("error");
    }
  }

  return (
    <section
      className="rounded-md border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900"
      data-testid="moment-banner"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
          Moment detected
        </p>
        {situation && (
          <span className="rounded-full border border-neutral-400 bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
            {situation}
          </span>
        )}
      </div>
      <p className="mt-1 text-base">
        I noticed this looks like{" "}
        <a
          href={`${DOCS_BASE_URL}/model/moments/${moment}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono font-semibold underline underline-offset-2"
        >
          {moment}
        </a>
        .{" "}
        {description && (
          <span className="text-neutral-600 dark:text-neutral-400">
            {description}
          </span>
        )}
      </p>
      {subline && (
        <p className="mt-1 text-xs text-neutral-500">
          {"I'm applying "}
          <span className="text-neutral-700 dark:text-neutral-300">
            {subline.replace(/^Looks like [^ ]+ — /, "")}
          </span>
        </p>
      )}

      {savedCorrection && state === "done" ? (
        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          Thanks — your correction (
          <span className="font-mono">{savedCorrection}</span>) routed to
          the moment-classifier review queue.
        </p>
      ) : correcting ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="moment-correction" className="text-xs text-neutral-600 dark:text-neutral-400">
            Looks more like
          </label>
          <select
            id="moment-correction"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          >
            <option value="">Pick a moment…</option>
            {dropdownOptions.map((m) => {
              const s = summaries[m];
              const countSuffix = s ? ` (${s.total})` : "";
              return (
                <option key={m} value={m}>
                  {m}
                  {countSuffix}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            disabled={!picked || state === "submitting"}
            onClick={submitCorrection}
            className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {state === "submitting" ? "Sending…" : "Send correction"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCorrecting(false);
              setPicked("");
            }}
            className="text-xs text-neutral-500 underline underline-offset-2"
          >
            Cancel
          </button>
          {state === "error" && (
            <p className="mt-1 w-full text-xs text-red-700 dark:text-red-400">
              Couldn&apos;t send that. Try again later.
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCorrecting(true)}
          className="mt-3 text-xs text-neutral-500 underline underline-offset-2"
        >
          Not {moment}?
        </button>
      )}
    </section>
  );
}
