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
import { wordDiff, type DiffToken } from "@/lib/text-diff";

type CheckEnvelope = PublicCheckEnvelope & {
  latency_ms: number;
};

export function ExplainClient() {
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
                    <DiffBlock before={text} after={v.suggestion} />
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

/**
 * Inline before/after diff for a violation's suggestion. Two stacked
 * lines with word-level red/green highlighting — same algorithm the
 * Figma plugin, GitHub Action, and LSP code action use, so the same
 * change always reads the same way.
 *
 * `before` is the text the user submitted (the whole input, since
 * the schema 2.0.0 envelope doesn't carry per-violation offsets).
 * `after` is the violation's `suggestion` field.
 */
function DiffBlock({ before, after }: { before: string; after: string }) {
  const tokens = wordDiff(before, after);
  return (
    <div className="mt-2 space-y-1 font-mono text-xs">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="select-none text-neutral-400 dark:text-neutral-600"
        >
          −
        </span>
        <span className="break-words text-neutral-700 dark:text-neutral-300">
          {tokens
            .filter((t) => t.kind === "equal" || t.kind === "removed")
            .map((t, i) => (
              <DiffSpan key={`b-${i}`} token={t} side="before" />
            ))}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="select-none text-neutral-400 dark:text-neutral-600"
        >
          +
        </span>
        <span className="break-words text-neutral-700 dark:text-neutral-300">
          {tokens
            .filter((t) => t.kind === "equal" || t.kind === "added")
            .map((t, i) => (
              <DiffSpan key={`a-${i}`} token={t} side="after" />
            ))}
        </span>
      </div>
    </div>
  );
}

function DiffSpan({
  token,
  side,
}: {
  token: DiffToken;
  side: "before" | "after";
}) {
  if (token.kind === "equal") {
    return <>{token.text}</>;
  }
  if (token.kind === "removed" && side === "before") {
    return (
      <span className="bg-red-100 text-red-900 line-through dark:bg-red-950/60 dark:text-red-300">
        {token.text}
      </span>
    );
  }
  if (token.kind === "added" && side === "after") {
    return (
      <span className="bg-green-100 text-green-900 dark:bg-green-950/60 dark:text-green-300">
        {token.text}
      </span>
    );
  }
  return null;
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
