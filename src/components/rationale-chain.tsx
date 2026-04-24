/**
 * "Why this verdict?" — the rationale-chain component.
 *
 * Human-eval build plan Session 21. Renders a compact summary of the
 * verdict with an expandable tree of pipeline hops, each showing:
 * the step, the output, the confidence signal, the rule versions
 * consulted, and any typed ambiguity flag. A one-click feedback path
 * (attached to the moment-detection hop) posts to
 * `/api/feedback/rationale` with `correction_type = situation_ambiguity`.
 *
 * This is the web-app implementation. The Figma plugin mirrors the
 * same UX in vanilla JS inside `figma-plugin/ui.html`; the CLI prints
 * a plaintext version behind `--explain`; the MCP server surfaces
 * `rationale_chain` on `evaluate_copy`. They share the same data
 * contract but each renders appropriate to its surface.
 *
 * Deep links to the /model page on docs.contentrx.io — standards to
 * `/model/standards/<id>`, moments to `/model/moments/<id>`. This
 * satisfies Session 21's "links from rationale nodes to corresponding
 * /model page entries" spec item.
 */

"use client";

import { useState } from "react";
import type { EvaluationResult, RationaleHop } from "@/lib/evaluate";

export const DOCS_BASE_URL = "https://docs.contentrx.io";

export interface RationaleChainProps {
  /** CheckResult from /api/check (envelope's `result` key). */
  result: EvaluationResult;
  /** sha256 of the user's input text — posted to the feedback endpoint. */
  textHash: string;
  /** Which client is surfacing this — tagged on feedback rows for admin drill-down. */
  source: "plugin" | "cli" | "action" | "dashboard" | "mcp";
  /**
   * When set, the feedback call is routed here. Default is
   * `/api/feedback/rationale`. Figma plugin + CLI override with
   * absolute URLs; in-app surfaces use the default relative path.
   */
  feedbackUrl?: string;
}

export function RationaleChain({
  result,
  textHash,
  source,
  feedbackUrl = "/api/feedback/rationale",
}: RationaleChainProps) {
  const [open, setOpen] = useState(false);
  const chain = result.rationale_chain ?? [];

  return (
    <section
      className="rounded-md border border-neutral-200 bg-neutral-50 text-sm dark:border-neutral-800 dark:bg-neutral-950"
      data-testid="rationale-chain"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-2 text-left"
        aria-expanded={open}
        aria-controls="rationale-chain-body"
      >
        <span className="font-medium">Why this verdict?</span>
        <span className="font-mono text-xs text-neutral-500">
          {open ? "−" : "+"} {chain.length} {chain.length === 1 ? "hop" : "hops"}
        </span>
      </button>

      {open && (
        <div id="rationale-chain-body" className="space-y-3 px-4 pb-4">
          <VerdictSummary result={result} />
          {chain.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No rationale chain on this response — the engine likely
              bypassed the pipeline (e.g. a direct unit-test call).
            </p>
          ) : (
            <ol className="space-y-2 border-l border-neutral-200 pl-4 dark:border-neutral-800">
              {chain.map((hop, idx) => (
                <HopRow
                  key={`${hop.step}-${idx}`}
                  hop={hop}
                  moment={result.moment ?? null}
                  textHash={textHash}
                  source={source}
                  feedbackUrl={feedbackUrl}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function VerdictSummary({ result }: { result: EvaluationResult }) {
  const verdict = result.verdict ?? result.overall_verdict;
  const moment = result.moment;
  const review = result.review_reason ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`rounded-full px-2 py-0.5 font-mono uppercase tracking-wide ${
          verdict === "pass"
            ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
            : verdict === "review_recommended"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        }`}
      >
        {verdict}
      </span>
      {moment && (
        <span className="text-neutral-600 dark:text-neutral-400">
          moment:{" "}
          <a
            href={`${DOCS_BASE_URL}/model/moments/${moment}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline underline-offset-2"
          >
            {moment}
          </a>
        </span>
      )}
      {review && (
        <span className="text-neutral-600 dark:text-neutral-400">
          review_reason: <span className="font-mono">{review}</span>
        </span>
      )}
    </div>
  );
}

function HopRow({
  hop,
  moment,
  textHash,
  source,
  feedbackUrl,
}: {
  hop: RationaleHop;
  moment: string | null;
  textHash: string;
  source: "plugin" | "cli" | "action" | "dashboard" | "mcp";
  feedbackUrl: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-md border border-neutral-200 bg-white p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono font-semibold">{hop.step}</span>
          {hop.confidence !== null && (
            <ConfidencePill value={hop.confidence} />
          )}
          {hop.ambiguity_flag && (
            <span className="rounded-full border border-amber-400 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {hop.ambiguity_flag}
            </span>
          )}
        </span>
        <span className="font-mono text-neutral-500">
          {expanded ? "−" : "+"}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <KeyValueBlock label="inputs" value={hop.inputs} />
          <KeyValueBlock label="output" value={hop.output} />
          {Object.keys(hop.rule_versions).length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                rule versions
              </p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {Object.entries(hop.rule_versions).map(([id, version]) => (
                  <li key={id}>
                    <a
                      href={`${DOCS_BASE_URL}/model/standards/${id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-neutral-300 px-1.5 py-0.5 font-mono text-[10px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      {id} v{version}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hop.step === "detect_moment" && moment && (
            <MomentFeedbackButton
              textHash={textHash}
              source={source}
              feedbackUrl={feedbackUrl}
              moment={moment}
            />
          )}
        </div>
      )}
    </li>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.8
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      : value >= 0.6
        ? "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return (
    <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${tone}`}>
      {pct}%
    </span>
  );
}

function KeyValueBlock({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown>;
}) {
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {entries.map(([k, v]) => (
          <DlRow key={k} k={k} v={v} />
        ))}
      </dl>
    </div>
  );
}

function DlRow({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt className="text-neutral-500">{k}</dt>
      <dd className="truncate text-neutral-700 dark:text-neutral-300">
        {stringify(v)}
      </dd>
    </>
  );
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserializable]";
  }
}

function MomentFeedbackButton({
  textHash,
  source,
  feedbackUrl,
  moment,
}: {
  textHash: string;
  source: "plugin" | "cli" | "action" | "dashboard" | "mcp";
  feedbackUrl: string;
  moment: string;
}) {
  const [state, setState] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");

  async function submit() {
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
          source,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
        Thanks — routed to the review queue as{" "}
        <span className="font-mono">situation_ambiguity</span>.
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="text-[11px] text-red-700 dark:text-red-400">
        Couldn&apos;t log feedback. Try again later.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={submit}
      disabled={state === "submitting"}
      className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      {state === "submitting" ? "Sending…" : `Not ${moment}?`}
    </button>
  );
}
