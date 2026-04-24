/**
 * /dashboard/explain client island.
 *
 * Posts to /api/check via fetch, renders the three-state verdict,
 * violations, and the rationale-chain component. Client-side sha256
 * hashes the input text before handing it to the RationaleChain
 * component so the feedback POST doesn't need to re-send the raw text.
 *
 * Human-eval build plan Session 21.
 */

"use client";

import { useState } from "react";
import { RationaleChain } from "@/components/rationale-chain";
import type { EvaluationResult } from "@/lib/evaluate";

type CheckEnvelope = {
  schema_version: string;
  warnings: string[];
  result: EvaluationResult;
  latency_ms: number;
};

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ExplainClient() {
  const [text, setText] = useState(
    "Unable to complete operation. Please contact administrator.",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<CheckEnvelope | null>(null);
  const [textHash, setTextHash] = useState<string>("");

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
      setTextHash(await sha256Hex(text));
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
          <VerdictHeader result={response.result} />
          {response.result.violations.length > 0 && (
            <ul className="space-y-2">
              {response.result.violations.map((v, i) => (
                <li
                  key={`${v.standard_id}-${i}`}
                  className="rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <p className="font-mono text-xs text-neutral-500">
                    {v.standard_id}
                    {v.rule_version ? ` v${v.rule_version}` : null}
                  </p>
                  <p className="mt-1 text-neutral-900 dark:text-neutral-100">
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
          <RationaleChain
            result={response.result}
            textHash={textHash}
            source="dashboard"
          />
          <p className="text-xs text-neutral-500">
            Evaluated in {response.latency_ms} ms.
          </p>
        </section>
      )}
    </div>
  );
}

function VerdictHeader({ result }: { result: EvaluationResult }) {
  const verdict = result.verdict ?? result.overall_verdict;
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
      {result.moment && (
        <span className="text-sm text-neutral-600 dark:text-neutral-400">
          moment <span className="font-mono">{result.moment}</span>
        </span>
      )}
      {result.content_type && (
        <span className="text-sm text-neutral-600 dark:text-neutral-400">
          type <span className="font-mono">{result.content_type}</span>
        </span>
      )}
    </div>
  );
}
