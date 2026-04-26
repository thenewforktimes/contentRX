/**
 * /dashboard/explain client island.
 *
 * Posts to /api/check via fetch, renders the schema 2.0.0 public
 * envelope: violations carry only `issue`, `suggestion`, `severity`,
 * and `confidence`. Substrate fields (`standard_id`, `rule_version`,
 * `rationale_chain`, `moment`, etc.) are stripped at the API boundary
 * per ADR 2026-04-25 and never reach this component.
 *
 * Founder substrate visibility lives at `/admin` (Phase B), not here.
 *
 * Human-eval build plan Session 21; rewritten for schema 2.0.0
 * (ADR 2026-04-25).
 */

"use client";

import { useState } from "react";
import type { PublicCheckEnvelope } from "@/lib/api-envelope";

type CheckEnvelope = PublicCheckEnvelope & {
  latency_ms: number;
};

export interface ExplainClientProps {
  /**
   * Kept in the props for compatibility with the page-server-component
   * call site; the post-pivot dashboard does not render moment context
   * because `moment` is substrate-only. The page can pass an empty
   * object here.
   */
  momentSummaries?: Record<string, unknown>;
}

export function ExplainClient(_props: ExplainClientProps = {}) {
  // _props is retained in the signature for API compatibility with the
  // page-server-component caller; the post-pivot dashboard does not
  // render moment context (substrate-only) so the prop goes unused.
  void _props;
  const [text, setText] = useState(
    "Unable to complete operation. Please contact administrator.",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<CheckEnvelope | null>(null);

  async function onCheck() {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source: "plugin" }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${body}`);
      }
      const data = (await res.json()) as CheckEnvelope;
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label
          htmlFor="explain-text"
          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          Text to evaluate
        </label>
        <textarea
          id="explain-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
        <button
          type="button"
          onClick={onCheck}
          disabled={loading || text.trim().length === 0}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {response && (
        <section className="space-y-4">
          <VerdictHeader
            verdict={response.verdict}
            reviewReason={response.review_reason}
          />
          {response.violations.length > 0 && (
            <ul className="space-y-2">
              {response.violations.map((v, i) => (
                <li
                  key={i}
                  className="rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <SeverityBadge severity={v.severity} />
                  <p className="mt-2 text-neutral-900 dark:text-neutral-100">
                    {v.issue}
                  </p>
                  {v.suggestion && (
                    <p className="mt-1 text-neutral-700 dark:text-neutral-300">
                      <em>Suggestion:</em> {v.suggestion}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-neutral-500">
            Evaluated in {response.latency_ms} ms.
          </p>
        </section>
      )}
    </div>
  );
}

function VerdictHeader({
  verdict,
  reviewReason,
}: {
  verdict: string;
  reviewReason: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
          verdict === "pass"
            ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
            : verdict === "review_recommended"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        }`}
      >
        {verdict}
      </span>
      {reviewReason && (
        <span className="text-sm text-neutral-600 dark:text-neutral-400">
          {reviewReason.replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === "high"
      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
      : severity === "medium"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {severity}
    </span>
  );
}
